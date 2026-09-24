#!/usr/bin/env node
// Sync upload-side tests (SYNC_REVERSAL_WORKPLAN.md Phase 2). Run:
//   node --test tests/sync.test.js
//
// Real-source-pulled: functions and constants are extracted verbatim from the
// inline <script> in index.html and run in a sandbox. Only the browser and
// Supabase edges (localStorage, document, the sb client) are faked.

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const nodeCrypto = require('crypto');

const { html, script, extractFunction, extractConst } = require('./helpers');

const SYNC_FUNCTIONS = [
  'isNetworkError', 'newId', 'isUuid', 'idArg', 'pendingKey', 'chunk', 'nextPendingOp',
  'shapeCheckInRow', 'shapeWishlistRow', 'isStopError', 'currentUserId', 'claimCacheOwner',
  'syncPaused', 'queueSync', 'queueSyncMany', 'myPendingCount', 'flushPending', 'flushTable',
  'savePendingOps', 'loadPendingOps', 'updateSyncPill',
];
const SYNC_CONSTS = ['PROFILE_OK_KEY', 'PENDING_KEY', 'CACHE_OWNER_KEY', 'UPSERT_CHUNK', 'DELETE_CHUNK', 'FLUSH_DEBOUNCE_MS'];

// A fake supabase client. `plan(table, kind, payload)` returns { error } or
// a promise of one; every call is recorded.
function fakeSb(plan = () => ({ error: null })) {
  const calls = [];
  return {
    calls,
    from(table) {
      return {
        upsert(rows, opts) {
          const list = Array.isArray(rows) ? rows : [rows];
          calls.push({ table, kind: 'upsert', ids: list.map(r => r.id), rows: list, opts });
          return Promise.resolve(plan(table, 'upsert', list));
        },
        delete() {
          return {
            in(col, ids) {
              calls.push({ table, kind: 'delete', col, ids });
              return Promise.resolve(plan(table, 'delete', ids));
            },
          };
        },
      };
    },
  };
}

// Build a sandbox running the real sync code. Timers are captured, not run,
// so debounced flushes happen only when a test calls flushPending().
function makeSync({ uid = 'user-a', owner, entries = [], wishlist = [], sb = fakeSb(), store = {} } = {}) {
  const storage = { ...store };
  if (owner !== undefined) storage.hopprint_cache_owner = owner;
  const ctx = {
    crypto: nodeCrypto.webcrypto,
    localStorage: {
      getItem: k => (k in storage ? storage[k] : null),
      setItem: (k, v) => { storage[k] = String(v); },
      removeItem: k => { delete storage[k]; },
    },
    document: { getElementById: () => null },
    setTimeout: () => 0,
    clearTimeout: () => {},
    console,
  };
  vm.createContext(ctx);
  vm.runInContext([
    ...SYNC_CONSTS.map(extractConst),
    ...SYNC_FUNCTIONS.map(extractFunction),
    'var sb, authUser, entries, wishlist, pendingOps, pendingSeq = 0, syncing = false, pulling = false, flushTimer = null;',
  ].join('\n'), ctx);
  ctx.sb = sb;
  ctx.authUser = uid ? { id: uid, email: `${uid}@example.com` } : null;
  ctx.entries = entries;
  ctx.wishlist = wishlist;
  ctx.pendingOps = ctx.loadPendingOps();
  ctx.storage = storage;
  return ctx;
}

const uuid = () => nodeCrypto.randomUUID();
const entry = (over = {}) => ({
  id: uuid(), beer_name: 'Heady Topper', brewery_name: 'The Alchemist', brewery_city: 'Stowe',
  brewery_state: 'VT', beer_type: 'IPA - Imperial / Double', beer_abv: '8', venue_name: '',
  purchase_venue: '', created_at: '2026-09-23T21:00', serving_type: 'Can', occasion: 'home-solo',
  occasion_ctx: ['Winding down'], comment: '', rating: null, rating_mode: null, source: 'live', ...over,
});

// ── Pure helpers ────────────────────────────────────────────────

test('newId: uuid v4, including the non-secure-context fallback', () => {
  const s = makeSync();
  assert.ok(s.isUuid(s.newId()));
  s.crypto = { getRandomValues: a => nodeCrypto.webcrypto.getRandomValues(a) };   // no randomUUID
  const id = s.newId();
  assert.ok(s.isUuid(id), id);
  assert.equal(id[14], '4');
  assert.ok('89ab'.includes(id[19]));
});

test('idArg: uuids quoted, legacy numeric ids bare and exact (SY4 quoted-id fix)', () => {
  const s = makeSync();
  const u = uuid();
  assert.equal(s.idArg(u), `'${u}'`);
  assert.equal(s.idArg(1719000000000), '1719000000000');
  const legacyFloat = 1719000000000.1234;                     // old import ids: Date.now() + Math.random()
  assert.equal(Number(s.idArg(legacyFloat)), legacyFloat);    // round-trips, so x.id === id still matches
  assert.equal(s.idArg(`x');alert(1);//`), `'xalert1'`);      // can't break out of the attribute
});

test('quoted-id fix is applied at all three render sites', () => {
  assert.equal((script.match(/openEdit\(\$\{idArg\(e\.id\)\}\)/g) || []).length, 1);
  assert.equal((script.match(/openRatingModal\(\$\{idArg\(e\.id\)\}\)/g) || []).length, 2);
  assert.doesNotMatch(script, /\(\$\{e\.id\}\)/);
  assert.match(script, /removeWish\('\$\{w\.id\}'\)/);
});

test('shapeCheckInRow: ABV blank → null, numeric ABV parsed, wall-clock date kept', () => {
  const s = makeSync();
  const row = s.shapeCheckInRow(entry({ beer_abv: '' }), 'u1');
  assert.equal(row.beer_abv, null);
  assert.equal(row.user_id, 'u1');
  assert.equal(row.created_at, '2026-09-23T21:00');
  assert.equal(s.shapeCheckInRow(entry({ beer_abv: '6.5' }), 'u1').beer_abv, 6.5);
  assert.equal(s.shapeCheckInRow(entry({ beer_abv: 'N/A' }), 'u1').beer_abv, null);
  assert.equal(s.shapeCheckInRow(entry({ rating: 84.6 }), 'u1').rating, 85);
  assert.equal(s.shapeCheckInRow(entry({ source: undefined }), 'u1').source, 'live');
  assert.deepEqual([...s.shapeCheckInRow(entry({ occasion_ctx: undefined }), 'u1').occasion_ctx], []);
});

test('shapeCheckInRow: rows missing a not-null column are not sent', () => {
  const s = makeSync();
  assert.equal(s.shapeCheckInRow(entry({ created_at: '' }), 'u1'), null);
  assert.equal(s.shapeCheckInRow(entry({ beer_name: '' }), 'u1'), null);
});

test('shapeCheckInRow: only real check_ins columns are written', () => {
  const s = makeSync();
  assert.deepEqual(Object.keys(s.shapeCheckInRow(entry(), 'u1')).sort(), [
    'beer_abv', 'beer_name', 'beer_type', 'brewery_city', 'brewery_name', 'brewery_state', 'comment',
    'created_at', 'id', 'occasion', 'occasion_ctx', 'purchase_venue', 'rating', 'rating_mode', 'serving_type',
    'source', 'user_id', 'venue_name',
  ]);
});

test('shapeWishlistRow: local → table field mapping (Part 3)', () => {
  const s = makeSync();
  const id = uuid();
  const row = s.shapeWishlistRow({ id, name: 'Pliny', brewery: 'Russian River', style: 'IPA', added: '2026-09-01T00:00:00.000Z' }, 'u1');
  assert.deepEqual({ ...row }, { id, user_id: 'u1', beer_name: 'Pliny', brewery_name: 'Russian River', beer_type: 'IPA', added_at: '2026-09-01T00:00:00.000Z' });
  assert.equal(s.shapeWishlistRow({ id, name: '' }, 'u1'), null);
});

test('nextPendingOp: legacy ids, other owners, and paused mode', () => {
  const s = makeSync();
  const id = uuid();
  assert.equal(s.nextPendingOp(undefined, 'check_ins', 1719000000000, 'upsert', false, 'a', false, 1), null);
  assert.equal(s.nextPendingOp(undefined, 'check_ins', id, 'upsert', false, null, false, 1), null);
  assert.equal(s.nextPendingOp({ owner: 'b' }, 'check_ins', id, 'upsert', false, 'a', false, 1), null);
  assert.equal(s.nextPendingOp(undefined, 'check_ins', id, 'upsert', false, 'b', true, 1), null);   // editing owner's row while paused
  assert.equal(s.nextPendingOp(undefined, 'check_ins', id, 'upsert', true, 'b', true, 1).owner, 'b');  // own new row while paused
  assert.equal(s.nextPendingOp({ owner: 'b', op: 'upsert' }, 'check_ins', id, 'delete', false, 'b', true, 2).op, 'delete');
});

// ── Queue + flush against a fake Supabase ───────────────────────

test('queue: last write wins per row; delete replaces upsert; pile persists', async () => {
  const e = entry();
  const s = makeSync({ owner: 'user-a', entries: [e] });
  s.queueSync('check_ins', e.id, 'upsert', true);
  s.queueSync('check_ins', e.id, 'upsert');
  assert.equal(Object.keys(s.pendingOps).length, 1);
  s.queueSync('check_ins', e.id, 'delete');
  const stored = JSON.parse(s.storage.hopprint_pending);
  assert.equal(stored[`check_ins:${e.id}`].op, 'delete');
  assert.equal(stored[`check_ins:${e.id}`].owner, 'user-a');
});

test('queue: legacy numeric-id rows are never queued (SY4)', () => {
  const s = makeSync({ owner: 'user-a' });
  s.queueSyncMany('check_ins', [1719000000000, 1719000000000.5], 'upsert', true);
  assert.equal(s.storage.hopprint_pending, undefined);
});

test('flush: upserts go up in chunks of 500, keyed on id (SY7c)', async () => {
  const rows = Array.from({ length: 1203 }, () => entry());
  const sb = fakeSb();
  const s = makeSync({ owner: 'user-a', entries: rows, sb });
  s.queueSyncMany('check_ins', rows.map(r => r.id), 'upsert', true);
  await s.flushPending();
  assert.deepEqual(sb.calls.map(c => c.ids.length), [500, 500, 203]);
  assert.ok(sb.calls.every(c => c.kind === 'upsert' && c.opts.onConflict === 'id'));
  assert.ok(sb.calls.every(c => c.rows.every(r => r.user_id === 'user-a')));
  assert.equal(s.myPendingCount(), 0);
  assert.deepEqual(JSON.parse(s.storage.hopprint_pending), {});
});

test('flush: offline keeps the pile; the retry resends the same ids (idempotent)', async () => {
  const e = entry();
  let online = false;
  const sb = fakeSb(() => (online ? { error: null } : { error: { message: 'TypeError: Failed to fetch', code: '' } }));
  const s = makeSync({ owner: 'user-a', entries: [e], sb });
  s.queueSync('check_ins', e.id, 'upsert', true);
  await s.flushPending();
  assert.equal(s.myPendingCount(), 1);
  assert.equal(sb.calls.length, 1);                 // stopped at the network error, no row-by-row retry
  online = true;
  await s.flushPending();
  assert.equal(s.myPendingCount(), 0);
  assert.deepEqual(sb.calls.map(c => c.ids[0]), [e.id, e.id]);
});

test('flush: an expired session stops the flush instead of retrying row by row', async () => {
  const rows = [entry(), entry()];
  const sb = fakeSb(() => ({ error: { code: 'PGRST301', message: 'JWT expired' } }));
  const s = makeSync({ owner: 'user-a', entries: rows, sb });
  s.queueSyncMany('check_ins', rows.map(r => r.id), 'upsert', true);
  await s.flushPending();
  assert.equal(sb.calls.length, 1);
  assert.equal(s.myPendingCount(), 2);
});

test('flush: one bad row is isolated; the rest of the chunk uploads', async () => {
  const good1 = entry(), bad = entry({ rating: 150 }), good2 = entry();
  const sb = fakeSb((table, kind, rows) =>
    rows.some(r => r.rating === 150) ? { error: { code: '23514', message: 'violates check constraint "check_ins_rating_check"' } } : { error: null });
  const s = makeSync({ owner: 'user-a', entries: [good1, bad, good2], sb });
  s.queueSyncMany('check_ins', [good1.id, bad.id, good2.id], 'upsert', true);
  await s.flushPending();
  assert.equal(s.myPendingCount(), 1);
  assert.ok(s.pendingOps[`check_ins:${bad.id}`]);
});

test('flush: an edit made mid-upload stays queued and is sent next', async () => {
  const e = entry();
  let s;
  let first = true;
  const sb = fakeSb((table, kind, rows) => {
    if (first) {                                    // user edits the rating while the insert is in flight
      first = false;
      e.rating = 90;
      s.queueSync('check_ins', e.id, 'upsert');
    }
    return { error: null };
  });
  s = makeSync({ owner: 'user-a', entries: [e], sb });
  s.queueSync('check_ins', e.id, 'upsert', true);
  await s.flushPending();
  await new Promise(r => setImmediate(r));          // let the chained re-flush finish
  assert.equal(sb.calls.length, 2);
  assert.equal(sb.calls[0].rows[0].rating, null);
  assert.equal(sb.calls[1].rows[0].rating, 90);
  assert.equal(s.myPendingCount(), 0);
});

test('flush: deletes are hard deletes in chunks of 100 (SY2)', async () => {
  const ids = Array.from({ length: 150 }, uuid);
  const sb = fakeSb();
  const s = makeSync({ owner: 'user-a', sb });
  s.queueSyncMany('wishlist', ids, 'delete');
  await s.flushPending();
  assert.deepEqual(sb.calls.map(c => [c.table, c.kind, c.col, c.ids.length]), [['wishlist', 'delete', 'id', 100], ['wishlist', 'delete', 'id', 50]]);
  assert.equal(s.myPendingCount(), 0);
});

test('flush: wish list rows upload with the table field names', async () => {
  const w = { id: uuid(), name: 'Pliny', brewery: 'Russian River', style: 'IPA', added: '2026-09-01T00:00:00.000Z' };
  const sb = fakeSb();
  const s = makeSync({ owner: 'user-a', wishlist: [w], sb });
  s.queueSync('wishlist', w.id, 'upsert', true);
  await s.flushPending();
  assert.equal(sb.calls[0].table, 'wishlist');
  assert.equal(sb.calls[0].rows[0].beer_name, 'Pliny');
});

test('owner guard: first account claims the cache; another account is paused and uploads nothing', async () => {
  const a = makeSync({ uid: 'user-a' });
  a.claimCacheOwner();
  assert.equal(a.storage.hopprint_cache_owner, 'user-a');

  const e = entry();
  const sb = fakeSb();
  const b = makeSync({ uid: 'user-b', owner: 'user-a', entries: [e], sb });
  b.claimCacheOwner();
  assert.equal(b.storage.hopprint_cache_owner, 'user-a');      // not stolen
  assert.equal(b.syncPaused(), true);
  b.queueSync('check_ins', e.id, 'upsert');                     // edit to the owner's row: local only
  assert.equal(b.pendingOps[`check_ins:${e.id}`], undefined);
  const mine = entry();
  b.entries.push(mine);
  b.queueSync('check_ins', mine.id, 'upsert', true);            // B's own new row: kept for later
  assert.equal(b.pendingOps[`check_ins:${mine.id}`].owner, 'user-b');
  await b.flushPending();
  assert.equal(sb.calls.length, 0);
});

test("owner guard: the owner's flush never sends another account's queued rows", async () => {
  const mineA = entry(), fromB = entry();
  const sb = fakeSb();
  const s = makeSync({ uid: 'user-a', owner: 'user-a', entries: [mineA, fromB], sb });
  s.pendingOps[`check_ins:${fromB.id}`] = { table: 'check_ins', id: fromB.id, op: 'upsert', owner: 'user-b', seq: 1 };
  s.pendingSeq = 1;
  s.queueSync('check_ins', fromB.id, 'upsert');                 // A edits B's row: not re-tagged
  s.queueSync('check_ins', mineA.id, 'upsert', true);
  await s.flushPending();
  assert.deepEqual(sb.calls.flatMap(c => c.ids), [mineA.id]);
  assert.equal(s.pendingOps[`check_ins:${fromB.id}`].owner, 'user-b');
});

// ── handleImport (SY7d) ─────────────────────────────────────────

test('handleImport: undated rows are skipped and reported; new rows get uuids and are queued', () => {
  const queued = [];
  const diag = { innerHTML: '', insertAdjacentHTML(pos, h) { this.innerHTML += h; } };
  const ctx = {
    entries: [], queued,
    save() {}, upsertBeerDB() {}, upsertBreweryDB() {}, buildLiveLists() {}, updateHeaderMeta() {},
    showToast(msg) { ctx.toast = msg; }, resolveMatrixStyle: () => true,
    queueSyncMany(table, ids, op, isNew) { queued.push({ table, ids, op, isNew }); },
    document: { getElementById: id => (id === 'importDiagnostic' ? diag : null) },
    FileReader: function () { this.readAsText = () => this.onload({ target: { result: ctx.csv } }); },
    crypto: nodeCrypto.webcrypto,
  };
  vm.createContext(ctx);
  vm.runInContext([extractFunction('newId'), extractFunction('handleImport')].join('\n'), ctx);
  ctx.csv = [
    'beer_name,brewery_name,created_at,beer_abv,rating_score',
    'Heady Topper,The Alchemist,2024-05-01 20:15:00,8,4.5',
    'Focal Banger,The Alchemist,,7,4',
    'Pliny,Russian River,2024-06-01 19:00:00,,',
  ].join('\n');
  ctx.handleImport({ target: { files: [{}], value: 'x' } });

  assert.equal(ctx.entries.length, 2);
  assert.ok(ctx.entries.every(e => /^[0-9a-f-]{36}$/.test(e.id)));
  assert.equal(queued.length, 1);
  assert.equal(queued[0].table, 'check_ins');
  assert.equal(queued[0].op, 'upsert');
  assert.equal(queued[0].isNew, true);
  assert.deepEqual([...queued[0].ids].sort(), [...ctx.entries.map(e => e.id)].sort());
  assert.match(diag.innerHTML, /1 row in the CSV had no check-in date and was skipped/);
  assert.match(ctx.toast, /Imported 2 entries/);
});

// ── Rendered handlers (Phase 6) ─────────────────────────────────

test('quoted-id rendering: the onclick string hands the exact id back to openEdit', () => {
  const s = makeSync();
  const card = extractFunction('renderHistory').match(/onclick="(openEdit\(\$\{idArg\(e\.id\)\}\))"/)[1];
  for (const id of [uuid(), 1719000000000, 1719000000000.1234]) {
    const handler = card.replace('${idArg(e.id)}', s.idArg(id));     // what the browser sees in the attribute
    let received;
    vm.runInNewContext(handler, { openEdit: x => { received = x; } });
    assert.equal(received, id, String(id));                          // strict: uuid stays a string, legacy stays a number
  }
});

test('removeWish: removes exactly that item by id and queues its delete', () => {
  const a = { id: uuid(), name: 'A' }, b = { id: uuid(), name: 'B' }, c = { id: uuid(), name: 'C' };
  const ctx = { wishlist: [a, b, c], queued: [], rendered: 0, localStorage: { setItem() {} } };
  vm.createContext(ctx);
  vm.runInContext(`${extractFunction('removeWish')}
    function queueSync(t, id, op) { queued.push([t, id, op]); }
    function renderWishlist() { rendered++; }`, ctx);
  ctx.removeWish(b.id);
  assert.deepEqual([...ctx.wishlist.map(w => w.name)], ['A', 'C']);
  assert.deepEqual(ctx.queued.map(q => [...q]), [['wishlist', b.id, 'delete']]);
  assert.equal(ctx.rendered, 1);
});
