#!/usr/bin/env node
// First-load tests (SYNC_REVERSAL_WORKPLAN.md Phase 4: OS1–OS3 + pre-sync prompt). Run:
//   node --test tests/first-load.test.js
//
// Real-source-pulled: functions are extracted verbatim from the inline
// <script> in index.html and run in a sandbox with a minimal fake DOM.

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');

const { html, script, style, extractFunction, extractConst } = require('./helpers');

// Minimal DOM: elements by id, a body classList, and the three loading notes.
function fakeDom() {
  const classes = new Set();
  const el = () => {
    const c = new Set();
    return { textContent: '', classList: { add: x => c.add(x), remove: x => c.delete(x), contains: x => c.has(x) }, _c: c };
  };
  const byId = { welcomeModal: el(), preSyncModal: el(), preSyncText: el() };
  const notes = [el(), el(), el()];
  return {
    byId, notes,
    body: { classList: { add: x => classes.add(x), remove: x => classes.delete(x), contains: x => classes.has(x) } },
    getElementById: id => byId[id] || null,
    querySelectorAll: sel => (sel === '.first-sync-note' ? notes : []),
  };
}

function makeApp({ uid = 'u', owner = 'u', syncState, entries = [], wishlist = [], online = true, store = {} } = {}) {
  const storage = { ...store };
  if (owner) storage.hopprint_cache_owner = owner;
  if (syncState) storage.hopprint_sync_state = JSON.stringify(syncState);
  const document = fakeDom();
  const timers = [];
  const ctx = {
    document, navigator: { onLine: online },
    localStorage: {
      getItem: k => (k in storage ? storage[k] : null),
      setItem: (k, v) => { storage[k] = String(v); },
      removeItem: k => { delete storage[k]; },
    },
    setTimeout: (fn, ms) => { timers.push(ms); return timers.length; }, clearTimeout: () => {},
    Math, JSON, Promise, console,
    calls: { refresh: 0, downloads: [], toasts: [] },
  };
  vm.createContext(ctx);
  vm.runInContext([
    extractConst('PROFILE_OK_KEY'), extractConst('CACHE_OWNER_KEY'), extractConst('SYNC_STATE_KEY'),
    extractConst('FIRST_SYNC_RETRY_MAX_MS'),
    ...['currentUserId', 'syncPaused', 'loadSyncState', 'pendingKey', 'firstPullDone', 'firstSyncPending',
        'enterFirstSyncMode', 'setFirstSyncNote', 'afterSyncAttempt', 'maybeShowWelcome', 'rowsMissingFromServer',
        'preSyncMessage', 'confirmDropUnsyncedLocal', 'exportPreSync', 'continuePreSync'].map(extractFunction),
    'var authUser, entries, wishlist, pendingOps = {}, firstSyncRetryMs = 5000, firstSyncTimer = null, preSyncRows = null, preSyncResolve = null;',
    'function refreshAfterPull() { calls.refresh++; }',
    'function syncNow() {}',
    'function download(name, content) { calls.downloads.push({ name, content }); }',
    'function showToast(m) { calls.toasts.push(m); }',
  ].join('\n'), ctx);
  ctx.authUser = uid ? { id: uid } : null;
  ctx.entries = entries;
  ctx.wishlist = wishlist;
  ctx.storage = storage;
  ctx.timers = timers;
  return ctx;
}

const done = uid => ({ uid, bookmarks: {}, lastIdCheck: '2026-09-23' });
const isFirstSync = s => s.document.body.classList.contains('first-sync');

// ── Mode entry ──────────────────────────────────────────────────

test('a fresh device enters first-sync mode with a loading note', () => {
  const s = makeApp();
  s.enterFirstSyncMode();
  assert.ok(isFirstSync(s));
  assert.ok(s.document.notes.every(n => n.textContent === 'Loading your check-ins…'));
});

test('a device that already synced never enters first-sync mode', () => {
  const s = makeApp({ syncState: done('u') });
  s.enterFirstSyncMode();
  assert.equal(isFirstSync(s), false);
});

test("another account's sync state doesn't count as this account's first sync", () => {
  const s = makeApp({ syncState: done('someone-else') });
  assert.equal(s.firstPullDone(), false);
  assert.equal(s.firstSyncPending(), true);
});

test('a paused (shared) device shows its cache instead of loading', () => {
  const s = makeApp({ uid: 'b', owner: 'a' });
  s.enterFirstSyncMode();
  assert.equal(isFirstSync(s), false);
});

// ── OS1 welcome modal ───────────────────────────────────────────

test('OS1: no welcome modal while the first sync is running, even with an empty cache', () => {
  const s = makeApp();
  s.maybeShowWelcome();
  assert.equal(s.document.byId.welcomeModal._c.has('open'), false);
});

test('OS1: after the first sync, welcome shows only if the account has no check-ins', () => {
  const empty = makeApp();
  empty.enterFirstSyncMode();
  empty.storage.hopprint_sync_state = JSON.stringify(done('u'));     // first pull just finished
  empty.afterSyncAttempt();
  assert.equal(isFirstSync(empty), false);
  assert.equal(empty.calls.refresh, 1);
  assert.equal(empty.document.byId.welcomeModal._c.has('open'), true);

  const returning = makeApp();
  returning.enterFirstSyncMode();
  returning.entries = [{ id: 'x' }];                                   // pull brought their history down
  returning.storage.hopprint_sync_state = JSON.stringify(done('u'));
  returning.afterSyncAttempt();
  assert.equal(returning.document.byId.welcomeModal._c.has('open'), false);
});

// ── OS2 loading / offline ───────────────────────────────────────

test('OS2: a failed first sync while offline says so and waits for the online event', () => {
  const s = makeApp({ online: false });
  s.enterFirstSyncMode();
  s.afterSyncAttempt();
  assert.ok(isFirstSync(s));
  assert.match(s.document.notes[0].textContent, /Can't reach Hopprint/);
  assert.equal(s.timers.length, 0);
});

test('OS2: a failed first sync while online retries with backoff, capped at 60s', () => {
  const s = makeApp();
  s.enterFirstSyncMode();
  for (let i = 0; i < 6; i++) s.afterSyncAttempt();
  assert.deepEqual(s.timers, [5000, 10000, 20000, 40000, 60000, 60000]);
  assert.equal(s.document.notes[0].textContent, 'Loading your check-ins…');
});

// ── OS3 export/import gating (CSS contract) ─────────────────────

test('OS3: export and import buttons are disabled during first sync; content hidden behind notes', () => {
  for (const fn of ['exportCSV', 'exportJSON', 'importUntappd']) {
    assert.match(script, new RegExp(`class="btn-action needs-first-sync" onclick="${fn}\\(\\)"`), fn);
  }
  assert.match(style, /body\.first-sync \.needs-first-sync \{ opacity: 0\.45; pointer-events: none; \}/);
  for (const sel of ['#historyList', '#analyticsInner', '#profileInner']) assert.ok(style.includes(`body.first-sync ${sel}`), sel);
  assert.equal((html.match(/<div class="first-sync-note"><\/div>/g) || []).length, 3);
});

// ── Pre-sync prompt ─────────────────────────────────────────────

test('rowsMissingFromServer: legacy and unknown rows, minus pending ones', () => {
  const s = makeApp();
  const local = [{ id: 1719000000000 }, { id: 'on-server' }, { id: 'pending' }, { id: 'unknown' }];
  const out = s.rowsMissingFromServer(local, new Set(['on-server']), 'check_ins', { 'check_ins:pending': {} });
  assert.deepEqual([...out.map(r => r.id)], [1719000000000, 'unknown']);
});

test('preSyncMessage: counts and plurals', () => {
  const s = makeApp();
  assert.match(s.preSyncMessage(12, 0), /^This device has 12 check-ins saved before you signed in\./);
  assert.match(s.preSyncMessage(1, 3), /1 check-in and 3 wish list items/);
  assert.match(s.preSyncMessage(0, 1), /has 1 wish list item saved/);
});

test('pre-sync prompt: nothing to drop → no modal, resolves at once', async () => {
  const s = makeApp({ entries: [{ id: 'a' }] });
  await s.confirmDropUnsyncedLocal([{ table: 'check_ins', ids: new Set(['a']) }, { table: 'wishlist', ids: new Set() }]);
  assert.equal(s.document.byId.preSyncModal._c.has('open'), false);
});

test('pre-sync prompt: waits for Continue; Export downloads exactly the rows that would drop', async () => {
  const legacy = { id: 1719000000000, beer_name: 'Old One' };
  const wish = { id: 'w-local', name: 'Pliny' };
  const s = makeApp({ entries: [legacy, { id: 'a' }], wishlist: [wish] });
  let resolved = false;
  const p = s.confirmDropUnsyncedLocal([{ table: 'check_ins', ids: new Set(['a']) }, { table: 'wishlist', ids: new Set() }])
    .then(() => { resolved = true; });
  await new Promise(r => setImmediate(r));
  assert.equal(resolved, false);
  assert.equal(s.document.byId.preSyncModal._c.has('open'), true);
  assert.match(s.document.byId.preSyncText.textContent, /1 check-in and 1 wish list item/);

  s.exportPreSync();
  assert.equal(s.calls.downloads[0].name, 'hopprint_before_signin.json');
  const exported = JSON.parse(s.calls.downloads[0].content);
  assert.deepEqual(exported, { check_ins: [legacy], wishlist: [wish] });
  assert.equal(resolved, false);                                       // exporting doesn't continue by itself

  s.continuePreSync();
  await p;
  assert.equal(resolved, true);
  assert.equal(s.document.byId.preSyncModal._c.has('open'), false);
});
