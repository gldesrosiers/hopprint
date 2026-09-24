#!/usr/bin/env node
// One-off migration of a legacy Hopprint JSON export into Supabase (SYNC_REVERSAL_WORKPLAN.md
// Phase 5 / SY10). Dry run by default — it only reads the file and prints an audit.
//
//   node scripts/migrate.js --file ~/hopprint-migration/hopprint_export.json
//   node scripts/migrate.js --file <export> --user <auth user id> --apply
//   node scripts/migrate.js --user <auth user id> --wipe --apply      (rehearsal cleanup)
//
// Options:
//   --wishlist <file>  also migrate a wish list array (local shape: name/brewery/style/added)
//   --apply            actually write (without it, nothing is sent)
//
// Writing needs the service-role key (bypasses RLS). It is read from
// ~/.config/hopprint/service_role_key (or SUPABASE_SERVICE_ROLE_KEY), is never
// printed, and must never be committed or used client-side (SY10).
//
// Row ids are deterministic (a uuid derived from user id + legacy row), so a
// rerun upserts the same rows instead of duplicating them.

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const script = html.match(/<script>\n([\s\S]*?)<\/script>\s*<\/body>/)[1];
const SUPABASE_URL = script.match(/^const SUPABASE_URL = '([^']+)';/m)[1];
const CHUNK = 500;                                   // SY7(c)

// ── Reuse the app's own shaping so migrated rows match app uploads exactly ──
function extractFunction(name) {
  const start = script.search(new RegExp(`^(?:async\\s+)?function\\s+${name}\\s*\\(`, 'm'));
  const bodyStart = start + script.slice(start).search(/\)\s*\{/);
  let depth = 0;
  for (let i = script.indexOf('{', bodyStart); i < script.length; i++) {
    if (script[i] === '{') depth++;
    else if (script[i] === '}' && --depth === 0) return script.slice(start, i + 1);
  }
  throw new Error(`could not extract ${name} from index.html`);
}
const app = {};
vm.createContext(app);
vm.runInContext(`${extractFunction('shapeCheckInRow')}\n${extractFunction('shapeWishlistRow')}\n${extractFunction('isUuid')}
  this.api = { shapeCheckInRow, shapeWishlistRow, isUuid };`, app);
const { shapeCheckInRow, shapeWishlistRow, isUuid } = app.api;

// ── Args ────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = n => args.includes(`--${n}`);
const opt = n => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const expand = p => (p && p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p);
const file = expand(opt('file'));
const wishFile = expand(opt('wishlist'));
const userId = opt('user');
const APPLY = flag('apply');
const WIPE = flag('wipe');

function fail(msg) { console.error(`✖ ${msg}`); process.exit(1); }

// uuid derived from the user and the legacy row (name + date + old id), formatted as v5.
function stableId(uid, legacy) {
  const h = crypto.createHash('sha1').update(`hopprint-migration|${uid}|${legacy}`).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

// ── Audit (counts only — never prints check-in contents) ────────
function audit(rows) {
  const problems = { blankName: 0, blankDate: 0, badAbv: 0, badRating: 0 };
  const tally = {};
  const bump = (k, v) => { tally[k] = tally[k] || {}; tally[k][v] = (tally[k][v] || 0) + 1; };
  const pairs = new Set();
  let dupPairs = 0;
  rows.forEach(e => {
    if (!String(e.beer_name || '').trim()) problems.blankName++;
    if (!e.created_at) problems.blankDate++;
    if (e.beer_abv !== '' && e.beer_abv != null && !Number.isFinite(parseFloat(e.beer_abv))) problems.badAbv++;
    if (e.rating != null && (typeof e.rating !== 'number' || e.rating < 0 || e.rating > 100)) problems.badRating++;
    bump('source', String(e.source ?? '(missing → import)'));
    bump('rating_mode', String(e.rating_mode ?? '(none)'));
    bump('id', isUuid(e.id) ? 'uuid (kept)' : typeof e.id === 'number' ? 'legacy number (new uuid)' : 'other');
    const k = `${e.beer_name}|${e.created_at}`;
    if (pairs.has(k)) dupPairs++; else pairs.add(k);
  });
  return { rows: rows.length, ...problems, duplicateNameDatePairs: dupPairs, ...tally };
}

function toRows(entries, uid) {
  const out = [], skipped = [];
  entries.forEach((e, i) => {
    const id = isUuid(e.id) ? e.id : stableId(uid, `${e.id}|${e.beer_name}|${e.created_at}`);
    // Rows exported before the app recorded a source all came from Untappd CSV imports.
    const row = shapeCheckInRow({ ...e, id, source: e.source || 'import' }, uid);
    if (row) out.push(row); else skipped.push({ index: i, reason: !e.created_at ? 'no date' : 'no beer name' });
  });
  return { out, skipped };
}

function toWishRows(items, uid) {
  return items.map(w => shapeWishlistRow({ ...w, id: isUuid(w.id) ? w.id : stableId(uid, `wish|${w.name}|${w.added}`) }, uid)).filter(Boolean);
}

// ── Network (service role) ──────────────────────────────────────
function loadKey() {
  const keyFile = path.join(os.homedir(), '.config', 'hopprint', 'service_role_key');
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || (fs.existsSync(keyFile) ? fs.readFileSync(keyFile, 'utf8') : '')).trim();
  if (!key) fail(`no service-role key: create ${keyFile} (chmod 600) or set SUPABASE_SERVICE_ROLE_KEY`);
  let role = '';
  try { role = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role; } catch (e) {}
  if (role !== 'service_role') fail('the key file does not hold a service_role JWT (check you copied the secret key, not the anon key)');
  if (fs.existsSync(keyFile) && (fs.statSync(keyFile).mode & 0o077)) fail(`${keyFile} is readable by others — run: chmod 600 ${keyFile}`);
  return key;
}

async function api(key, method, pathAndQuery, body, extraHeaders = {}) {
  const res = await fetch(`${SUPABASE_URL}${pathAndQuery}`, {
    method,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...extraHeaders },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) fail(`${method} ${pathAndQuery.split('?')[0]} → ${res.status} ${text.slice(0, 300)}`);
  return { res, text };
}

async function countRows(key, table, uid) {
  const { res } = await api(key, 'GET', `/rest/v1/${table}?select=id&user_id=eq.${uid}&limit=1`, undefined, { Prefer: 'count=exact' });
  return Number((res.headers.get('content-range') || '*/0').split('/')[1]);
}

async function upsertAll(key, table, rows) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const batch = rows.slice(i, i + CHUNK);
    await api(key, 'POST', `/rest/v1/${table}?on_conflict=id`, batch, { Prefer: 'resolution=merge-duplicates,return=minimal' });
    console.log(`  ${table}: ${Math.min(i + CHUNK, rows.length)}/${rows.length}`);
  }
}

// ── Main ────────────────────────────────────────────────────────
(async () => {
  if (userId && !isUuid(userId)) fail('--user must be an auth user id (uuid)');
  if (WIPE && file) fail('--wipe and --file are separate runs');
  if (!file && !WIPE) fail('pass --file <export.json> (dry run), or --user <id> --wipe --apply');

  let entries = [], wishes = [];
  if (file) {
    entries = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(entries)) fail('export file is not a JSON array of check-ins');
    console.log('Audit — check-ins:', audit(entries));
  }
  if (wishFile) {
    wishes = JSON.parse(fs.readFileSync(wishFile, 'utf8'));
    console.log('Audit — wish list:', { rows: wishes.length, blankName: wishes.filter(w => !w.name).length });
  }

  if (!userId) { console.log('\nDry run complete (no --user given; nothing sent).'); return; }

  const { out, skipped } = toRows(entries, userId);
  const wishRows = toWishRows(wishes, userId);
  if (file) {
    console.log(`\nPrepared ${out.length} check-in rows, ${wishRows.length} wish list rows; skipped ${skipped.length}.`);
    skipped.forEach(s => console.log(`  skipped row #${s.index}: ${s.reason}`));
    if (new Set(out.map(r => r.id)).size !== out.length) fail('generated ids are not unique — aborting');
  }

  const key = loadKey();
  const { text } = await api(key, 'GET', `/auth/v1/admin/users/${userId}`);
  const target = JSON.parse(text);
  const before = { check_ins: await countRows(key, 'check_ins', userId), wishlist: await countRows(key, 'wishlist', userId) };
  console.log(`\nTarget account: ${target.email} (${userId})`);
  console.log('Rows in Supabase now:', before);

  if (!APPLY) { console.log('\nNot applied (add --apply to write).'); return; }

  if (WIPE) {
    await api(key, 'DELETE', `/rest/v1/check_ins?user_id=eq.${userId}`);
    await api(key, 'DELETE', `/rest/v1/wishlist?user_id=eq.${userId}`);
  } else {
    console.log('\nUpserting…');
    await upsertAll(key, 'check_ins', out);
    if (wishRows.length) await upsertAll(key, 'wishlist', wishRows);
  }
  const after = { check_ins: await countRows(key, 'check_ins', userId), wishlist: await countRows(key, 'wishlist', userId) };
  console.log('Rows in Supabase after:', after);
})().catch(err => fail(err.message));
