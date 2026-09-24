#!/usr/bin/env node
// Sync pull-down tests (SYNC_REVERSAL_WORKPLAN.md Phase 3). Run:
//   node --test tests/pull.test.js
//
// Real-source-pulled: functions and constants are extracted verbatim from the
// inline <script> in index.html and run in a sandbox. The Supabase client is
// an in-memory fake that really applies eq / gte / gt / or / order / limit,
// so keyset paging over tied timestamps is exercised, not assumed.

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const nodeCrypto = require('crypto');

const { html, script, extractFunction, extractConst } = require('./helpers');

const FUNCTIONS = [
  'isNetworkError', 'isUuid', 'pendingKey', 'chunk', 'nextPendingOp', 'shapeCheckInRow', 'shapeWishlistRow',
  'isStopError', 'currentUserId', 'syncPaused', 'queueSync', 'queueSyncMany', 'myPendingCount',
  'flushPending', 'flushTable', 'savePendingOps', 'loadPendingOps', 'updateSyncPill',
  'loadSyncState', 'saveSyncState', 'localDateKey', 'checkInFromRow', 'wishFromRow', 'mergePulled',
  'pruneMissing', 'pullTable', 'fetchServerIds', 'takeOverCache', 'pullChanges', 'syncNow',
];
const CONSTS = ['PROFILE_OK_KEY', 'PENDING_KEY', 'CACHE_OWNER_KEY', 'UPSERT_CHUNK', 'DELETE_CHUNK',
  'FLUSH_DEBOUNCE_MS', 'SYNC_STATE_KEY', 'PULL_PAGE'];

// ── In-memory PostgREST stand-in ────────────────────────────────
// Understands exactly the filters the app sends. Rows are the server truth;
// `calls` records each query's filters.
function fakeServer(tables) {
  const calls = [];
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const unq = v => v.replace(/^"|"$/g, '');
  function parseOr(expr) {
    // updated_at.gt."T",and(updated_at.eq."T",id.gt.ID)
    const m = expr.match(/^updated_at\.gt\.("[^"]*"),and\(updated_at\.eq\.("[^"]*"),id\.gt\.([0-9a-f-]+)\)$/);
    if (!m) throw new Error(`fake server: unsupported or() ${expr}`);
    const [ , t1, t2, id] = m;
    return r => r.updated_at > unq(t1) || (r.updated_at === unq(t2) && r.id > id);
  }
  function query(table) {
    const q = { filters: [], orders: [], lim: Infinity, cols: '*', table, failWith: null };
    const b = {
      select(cols) { q.cols = cols; return b; },
      eq(c, v) { q.filters.push(r => r[c] === v); return b; },
      gte(c, v) { q.gte = v; q.filters.push(r => r[c] >= v); return b; },
      gt(c, v) { q.filters.push(r => r[c] > v); return b; },
      or(expr) { q.or = expr; q.filters.push(parseOr(expr)); return b; },
      order(c, o) { q.orders.push([c, o.ascending]); return b; },
      limit(n) { q.lim = n; return b; },
      then(res, rej) {
        calls.push({ table, cols: q.cols, gte: q.gte, or: q.or });
        if (server.offline) return Promise.resolve({ data: null, error: { message: 'TypeError: Failed to fetch', code: '' } }).then(res, rej);
        let rows = (tables[table] || []).filter(r => q.filters.every(f => f(r)));
        rows.sort((x, y) => { for (const [c, asc] of q.orders) { const d = cmp(x[c], y[c]); if (d) return asc ? d : -d; } return 0; });
        rows = rows.slice(0, q.lim).map(r => (q.cols === 'id' ? { id: r.id } : { ...r }));
        return Promise.resolve({ data: rows, error: null }).then(res, rej);
      },
    };
    return b;
  }
  const server = {
    calls, offline: false, tables,
    from: table => ({
      ...query(table),
      select: cols => query(table).select(cols),
      upsert(rows) {
        calls.push({ table, kind: 'upsert' });
        (Array.isArray(rows) ? rows : [rows]).forEach(r => {
          const list = tables[table] || (tables[table] = []);
          const i = list.findIndex(x => x.id === r.id);
          const row = { ...r, updated_at: server.now() };
          if (i >= 0) list[i] = { ...list[i], ...row }; else list.push(row);
        });
        return Promise.resolve({ error: null });
      },
      delete: () => ({ in(col, ids) { tables[table] = (tables[table] || []).filter(r => !ids.includes(r.id)); calls.push({ table, kind: 'delete' }); return Promise.resolve({ error: null }); } }),
    }),
    tick: 0,
    now() { server.tick += 1; return `2026-09-24T10:00:00.${String(server.tick).padStart(6, '0')}+00:00`; },
  };
  return server;
}

function makeApp({ uid = 'user-a', owner, entries = [], wishlist = [], server, store = {} } = {}) {
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
    setTimeout: () => 0, clearTimeout: () => {}, console,
    refreshCount: 0,
  };
  vm.createContext(ctx);
  vm.runInContext([
    ...CONSTS.map(extractConst),
    ...FUNCTIONS.map(extractFunction),
    'var sb, authUser, entries, wishlist, pendingOps, pendingSeq = 0, syncing = false, pulling = false, flushTimer = null;',
    'function save() { localStorage.setItem("hopprint_entries", JSON.stringify(entries)); }',
    'function refreshAfterPull() { refreshCount++; }',
    // Phase 4 hooks (tested for real in tests/first-load.test.js): record the pre-sync prompt, continue at once.
    'var promptCalls = [];',
    'function confirmDropUnsyncedLocal(tables) { promptCalls.push(tables.map(t => [t.table, t.ids ? t.ids.size : null])); return Promise.resolve(); }',
    'function afterSyncAttempt() {}',
  ].join('\n'), ctx);
  ctx.sb = server;
  ctx.authUser = uid ? { id: uid, email: `${uid}@example.com` } : null;
  ctx.entries = entries;
  ctx.wishlist = wishlist;
  ctx.pendingOps = ctx.loadPendingOps();
  ctx.storage = storage;
  return ctx;
}

const uuid = () => nodeCrypto.randomUUID();
let clock = 0;
const serverRow = (uid, over = {}) => ({
  id: uuid(), user_id: uid, beer_name: 'Heady Topper', brewery_name: 'The Alchemist', brewery_city: 'Stowe',
  brewery_state: 'VT', beer_type: 'IPA', beer_abv: 8, venue_name: null, purchase_venue: null,
  serving_type: 'Can', occasion: null, occasion_ctx: null, comment: null, rating: 85, rating_mode: 'live_button',
  source: 'live', created_at: `2026-09-${String(10 + (clock % 18)).padStart(2, '0')}T21:00:00`,
  updated_at: `2026-09-24T09:00:00.${String(++clock).padStart(6, '0')}+00:00`, synced_at: '2026-09-24T09:00:00+00:00', ...over,
});

// ── Pure helpers ────────────────────────────────────────────────

test('checkInFromRow: nulls → blanks, ABV → string, same keys as a fresh check-in', () => {
  const s = makeApp({ server: fakeServer({}) });
  const r = serverRow('u', { beer_abv: null, occasion_ctx: ['With food'] });
  const e = s.checkInFromRow(r);
  assert.equal(e.brewery_name, 'The Alchemist');
  assert.equal(e.venue_name, '');
  assert.equal(e.beer_abv, '');
  assert.equal(s.checkInFromRow(serverRow('u', { beer_abv: 6.5 })).beer_abv, '6.5');
  assert.deepEqual([...e.occasion_ctx], ['With food']);
  assert.equal(e.user_id, undefined);            // server bookkeeping stays out of the cache / exports
  assert.equal(e.updated_at, undefined);
  // Same key order as submitCheckin, so the JSON export shape is unchanged (SY11).
  const submitKeys = [...extractFunction('submitCheckin').match(/const entry = \{([\s\S]*?)\n  \};/)[1].matchAll(/^\s+(\w+):/gm)].map(m => m[1]);
  assert.deepEqual(Object.keys(e), submitKeys);
});

test('round trip: shapeCheckInRow(checkInFromRow(row)) gives the server values back', () => {
  const s = makeApp({ server: fakeServer({}) });
  const r = serverRow('u1', { beer_abv: 5.6, venue_name: 'Home', comment: 'Crisp' });
  const back = s.shapeCheckInRow(s.checkInFromRow(r), 'u1');
  for (const k of ['id', 'beer_name', 'brewery_name', 'beer_abv', 'rating', 'rating_mode', 'source', 'created_at', 'venue_name', 'comment']) {
    assert.equal(back[k], r[k], k);
  }
});

test('wishFromRow: table → local field mapping (Part 3)', () => {
  const s = makeApp({ server: fakeServer({}) });
  const w = s.wishFromRow({ id: 'x', user_id: 'u', beer_name: 'Pliny', brewery_name: null, beer_type: 'IPA', added_at: '2026-09-01T00:00:00+00:00', updated_at: 't' });
  assert.deepEqual({ ...w }, { id: 'x', name: 'Pliny', brewery: '', style: 'IPA', added: '2026-09-01T00:00:00+00:00' });
});

test('mergePulled: new rows added, changed rows replaced, pending rows win (SY6)', () => {
  const s = makeApp({ server: fakeServer({}) });
  const a = serverRow('u'), b = serverRow('u'), c = serverRow('u');
  const local = [s.checkInFromRow(a), { ...s.checkInFromRow(b), rating: 10 }];
  const pending = { [`check_ins:${b.id}`]: { op: 'upsert' } };
  const { list, changed } = s.mergePulled(local, [{ ...a }, { ...b, rating: 99 }, c], 'check_ins', pending, s.checkInFromRow);
  assert.equal(changed, 1);                                       // only c is new; a unchanged; b is pending
  assert.equal(list.find(x => x.id === b.id).rating, 10);
  assert.ok(list.find(x => x.id === c.id));
});

test('mergePulled: rows returned twice (>= bookmark) are merged once', () => {
  const s = makeApp({ server: fakeServer({}) });
  const a = serverRow('u');
  const { list } = s.mergePulled([], [a, { ...a }], 'check_ins', {}, s.checkInFromRow);
  assert.equal(list.length, 1);
});

test('pruneMissing: drops rows the server lacks, keeps pending ones (SY2)', () => {
  const s = makeApp({ server: fakeServer({}) });
  const local = [{ id: 'keep' }, { id: 'gone' }, { id: 'pending-new' }, { id: 1719000000000 }];
  const { list, removed } = s.pruneMissing(local, new Set(['keep']), 'check_ins', { 'check_ins:pending-new': { op: 'upsert' } });
  assert.deepEqual(list.map(r => r.id), ['keep', 'pending-new']);
  assert.equal(removed, 2);                                       // includes the legacy row — the first pull replaces the list (SY4)
});

// ── Paging ──────────────────────────────────────────────────────

test('pullTable: 2,500 rows with tied updated_at across page boundaries — none skipped', async () => {
  const rows = [];
  // Three bulk inserts: every row in a batch shares one updated_at (SY7b).
  for (const [n, ts] of [[1200, '2026-09-24T09:00:00.000001+00:00'], [900, '2026-09-24T09:00:00.000002+00:00'], [400, '2026-09-24T09:00:00.000003+00:00']]) {
    for (let i = 0; i < n; i++) rows.push(serverRow('u', { updated_at: ts }));
  }
  const server = fakeServer({ check_ins: rows });
  const s = makeApp({ uid: 'u', server });
  const res = await s.pullTable('check_ins', 'u', null);
  assert.equal(res.rows.length, 2500);
  assert.equal(new Set(res.rows.map(r => r.id)).size, 2500);
  assert.equal(server.calls.length, 3);                            // 1000 + 1000 + 500
  assert.equal(server.calls[0].or, undefined);
  assert.match(server.calls[1].or, /^updated_at\.gt\."/);
});

test('pullTable: only rows at or after the bookmark; other users never returned', async () => {
  const old = serverRow('u', { updated_at: '2026-09-01T00:00:00+00:00' });
  const same = serverRow('u', { updated_at: '2026-09-20T00:00:00+00:00' });
  const newer = serverRow('u', { updated_at: '2026-09-21T00:00:00+00:00' });
  const other = serverRow('someone-else', { updated_at: '2026-09-22T00:00:00+00:00' });
  const s = makeApp({ uid: 'u', server: fakeServer({ check_ins: [old, same, newer, other] }) });
  const res = await s.pullTable('check_ins', 'u', '2026-09-20T00:00:00+00:00');
  assert.deepEqual([...res.rows.map(r => r.id)], [same.id, newer.id]);
});

test('fetchServerIds: pages by id through 2,345 rows', async () => {
  const rows = Array.from({ length: 2345 }, () => serverRow('u'));
  const server = fakeServer({ check_ins: rows });
  const s = makeApp({ uid: 'u', server });
  const { ids } = await s.fetchServerIds('check_ins', 'u');
  assert.equal(ids.size, 2345);
  assert.ok(server.calls.every(c => c.cols === 'id'));
});

// ── End to end: pullChanges / syncNow ───────────────────────────

test('first pull on a fresh device restores everything and sets the bookmark', async () => {
  const rows = Array.from({ length: 30 }, () => serverRow('u'));
  const wish = [{ id: uuid(), user_id: 'u', beer_name: 'Pliny', brewery_name: 'RR', beer_type: 'IPA', added_at: '2026-09-01T00:00:00+00:00', updated_at: '2026-09-24T09:30:00+00:00' }];
  const server = fakeServer({ check_ins: rows, wishlist: wish });
  const s = makeApp({ uid: 'u', owner: 'u', server });
  await s.pullChanges();
  assert.equal(s.entries.length, 30);
  assert.equal(s.wishlist.length, 1);
  assert.equal(s.refreshCount, 1);
  const st = JSON.parse(s.storage.hopprint_sync_state);
  assert.equal(st.bookmarks.check_ins, rows[rows.length - 1].updated_at);
  assert.equal(st.lastIdCheck, s.localDateKey(new Date()));
  // Newest check-in first, like the rest of the app expects.
  assert.ok(s.entries.every((e, i, a) => i === 0 || new Date(a[i - 1].created_at) >= new Date(e.created_at)));
});

test('first pull replaces legacy local rows (SY4) but keeps pending ones', async () => {
  const server = fakeServer({ check_ins: [serverRow('u')], wishlist: [] });
  const pendingRow = { ...makeApp({ server }).checkInFromRow(serverRow('u')), id: uuid() };
  const s = makeApp({ uid: 'u', owner: 'u', server, entries: [{ id: 1719000000000, beer_name: 'Legacy', created_at: '2020-01-01T00:00' }, pendingRow] });
  s.server = server;
  s.pendingOps[`check_ins:${pendingRow.id}`] = { table: 'check_ins', id: pendingRow.id, op: 'upsert', owner: 'u', seq: 1 };
  await s.pullChanges();
  assert.equal(s.entries.length, 2);
  assert.ok(s.entries.some(e => e.id === pendingRow.id));
  assert.ok(!s.entries.some(e => e.beer_name === 'Legacy'));
});

test('second pull only asks for changes since the bookmark; id check once a day (OS5)', async () => {
  const rows = [serverRow('u'), serverRow('u')];
  const server = fakeServer({ check_ins: rows, wishlist: [] });
  const s = makeApp({ uid: 'u', owner: 'u', server });
  await s.pullChanges();
  server.calls.length = 0;
  await s.pullChanges();
  const checkInPulls = server.calls.filter(c => c.cols === '*' && c.table === 'check_ins');
  assert.equal(checkInPulls.length, 1);
  assert.equal(checkInPulls[0].gte, rows[rows.length - 1].updated_at);   // bookmark used
  // wishlist returned nothing yet, so it has no bookmark and asks for everything (still empty)
  assert.equal(server.calls.filter(c => c.cols === 'id').length, 0); // id check already done today
  server.calls.length = 0;
  await s.pullChanges({ forceIdCheck: true });                     // Sync Now
  assert.equal(server.calls.filter(c => c.cols === 'id').length, 2); // check_ins + wishlist
});

test('a check-in deleted on another device disappears at the next id check (SY2)', async () => {
  const keep = serverRow('u'), gone = serverRow('u');
  const server = fakeServer({ check_ins: [keep, gone], wishlist: [] });
  const s = makeApp({ uid: 'u', owner: 'u', server });
  await s.pullChanges();
  assert.equal(s.entries.length, 2);
  server.tables.check_ins = [keep];                                // deleted elsewhere
  await s.pullChanges();
  assert.equal(s.entries.length, 2);                               // incremental pull can't see deletes
  await s.pullChanges({ forceIdCheck: true });
  assert.deepEqual(s.entries.map(e => e.id), [keep.id]);
});

test('an edit made on another device arrives on the next pull', async () => {
  const row = serverRow('u', { rating: 40 });
  const server = fakeServer({ check_ins: [row], wishlist: [] });
  const s = makeApp({ uid: 'u', owner: 'u', server });
  await s.pullChanges();
  Object.assign(server.tables.check_ins[0], { rating: 95, updated_at: '2026-09-25T00:00:00+00:00' });
  await s.pullChanges();
  assert.equal(s.entries[0].rating, 95);
});

test('offline: pull leaves the cache and bookmark untouched', async () => {
  const server = fakeServer({ check_ins: [serverRow('u')], wishlist: [] });
  const s = makeApp({ uid: 'u', owner: 'u', server, entries: [{ id: 'local', beer_name: 'x', created_at: '2026-01-01T00:00' }] });
  server.offline = true;
  await s.pullChanges();
  assert.equal(s.entries.length, 1);
  assert.equal(s.storage.hopprint_sync_state, undefined);
  assert.equal(s.pulling, false);
});

test('syncNow: a local write uploads, and the next pull brings back the same row once', async () => {
  const server = fakeServer({ check_ins: [], wishlist: [] });
  const s = makeApp({ uid: 'u', owner: 'u', server });
  await s.pullChanges();
  const mine = s.checkInFromRow(serverRow('u'));
  s.entries.unshift(mine);
  s.queueSync('check_ins', mine.id, 'upsert', true);
  await s.syncNow();
  assert.equal(server.tables.check_ins.length, 1);
  assert.equal(s.entries.length, 1);
  assert.equal(s.myPendingCount(), 0);
});

test('take-over: another account replaces the cache when the owner has nothing pending', async () => {
  const bRow = serverRow('user-b');
  const server = fakeServer({ check_ins: [serverRow('user-a'), bRow], wishlist: [] });
  const aRows = [{ id: uuid(), beer_name: 'A1', created_at: '2026-09-01T00:00' }];
  const s = makeApp({ uid: 'user-b', owner: 'user-a', server, entries: aRows,
    store: { hopprint_sync_state: JSON.stringify({ uid: 'user-b', bookmarks: {}, lastIdCheck: s_today() }) } });
  assert.equal(s.syncPaused(), true);
  await s.pullChanges();
  assert.equal(s.storage.hopprint_cache_owner, 'user-b');
  assert.equal(s.syncPaused(), false);
  assert.deepEqual(s.entries.map(e => e.id), [bRow.id]);           // stale same-day state didn't skip the replace
});

test("take-over is refused while the owner still has unsynced rows", async () => {
  const server = fakeServer({ check_ins: [serverRow('user-b')], wishlist: [] });
  const aRow = { id: uuid(), beer_name: 'A unsynced', created_at: '2026-09-01T00:00' };
  const s = makeApp({ uid: 'user-b', owner: 'user-a', server, entries: [aRow] });
  s.pendingOps[`check_ins:${aRow.id}`] = { table: 'check_ins', id: aRow.id, op: 'upsert', owner: 'user-a', seq: 1 };
  await s.pullChanges();
  assert.equal(s.storage.hopprint_cache_owner, 'user-a');
  assert.deepEqual(s.entries.map(e => e.id), [aRow.id]);
  assert.equal(server.calls.length, 0);
});

test('flush and pull never overlap', async () => {
  const server = fakeServer({ check_ins: [], wishlist: [] });
  const s = makeApp({ uid: 'u', owner: 'u', server });
  s.pulling = true;
  const e = s.checkInFromRow(serverRow('u'));
  s.entries.push(e);
  s.queueSync('check_ins', e.id, 'upsert', true);
  await s.flushPending();
  assert.equal(server.calls.length, 0);                            // deferred while pulling
  s.pulling = false;
  s.syncing = true;
  await s.pullChanges();
  assert.equal(server.calls.length, 0);                            // and pull waits for a flush
});

function s_today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

test('pre-sync prompt: asked once, on the first pull only — never on later id checks or a take-over', async () => {
  const server = fakeServer({ check_ins: [serverRow('u')], wishlist: [] });
  const s = makeApp({ uid: 'u', owner: 'u', server, entries: [{ id: 1719000000000, beer_name: 'Legacy', created_at: '2020-01-01T00:00' }] });
  await s.pullChanges();
  assert.equal(s.promptCalls.length, 1);
  await s.pullChanges({ forceIdCheck: true });
  assert.equal(s.promptCalls.length, 1);

  const t = makeApp({ uid: 'user-b', owner: 'user-a', server: fakeServer({ check_ins: [serverRow('user-b')], wishlist: [] }),
    entries: [{ id: uuid(), beer_name: 'A1', created_at: '2026-09-01T00:00' }] });
  await t.pullChanges();
  assert.equal(t.storage.hopprint_cache_owner, 'user-b');
  assert.equal(t.promptCalls.length, 0);
});
