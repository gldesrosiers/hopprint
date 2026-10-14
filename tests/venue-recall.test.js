#!/usr/bin/env node
// Home venue normalization + venue/purchase recall (VENUE_RECALL_WORKPLAN.md). Run:
//   node --test tests/venue-recall.test.js
//
// Real-source-pulled: functions and constants are extracted verbatim from the
// inline <script> in index.html and run in a sandbox with a minimal DOM.

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');

const { script, extractFunction, extractConst } = require('./helpers');

const NOW = Date.parse('2026-10-14T12:00:00');
// A wall-clock created_at `days` before NOW, in the ISO form a pull delivers.
const ago = days => new Date(NOW - days * 86400000).toISOString().slice(0, 19);

function app(entries = [], extra = {}) {
  const calls = { save: 0, queued: [] };
  const RealDate = Date;
  const ctx = vm.createContext({
    entries,
    Date: class extends RealDate { static now() { return NOW; } },
    BREWERY_DB: {},
    save() { calls.save++; },
    queueSyncMany(table, ids, op, isNew) { calls.queued.push({ table, ids, op, isNew }); },
    ...extra,
  });
  vm.runInContext([
    ...['HOME_VENUE', 'UNTAPPD_HOME', 'HALF_LIFE_DAYS'].map(extractConst),
    ...['venueScores', 'purchaseScores'].map(n => script.match(new RegExp(`^let ${n} = [^\\n]*;`, 'm'))[0]),
    ...['normalizeVenue', 'migrateHomeVenue', 'checkInFromRow', 'acNormKey', 'computePlaceScores',
      'placeRanker', 'showDrop'].map(extractFunction),
  ].join('\n'), ctx);
  return { ctx, calls };
}

// ── Part 1: Home normalization ─────────────────────────────────

test('VR1/VR2: normalizeVenue maps the Untappd label and "home" (any case) to Home, trims the rest', () => {
  const { ctx } = app();
  assert.equal(vm.runInContext('HOME_VENUE', ctx), 'Home');
  for (const v of ['Untappd at Home', '  untappd at HOME ', 'home', 'HOME', ' Home ']) assert.equal(ctx.normalizeVenue(v), 'Home', v);
  assert.equal(ctx.normalizeVenue(' Trillium Brewing '), 'Trillium Brewing');
  assert.equal(ctx.normalizeVenue('Homebrew Club'), 'Homebrew Club');
  assert.equal(ctx.normalizeVenue(''), '');
  assert.equal(ctx.normalizeVenue(null), '');
  assert.equal(ctx.normalizeVenue(undefined), '');
});

test('VR4: the load migration rewrites and queues only changed rows; blanks stay blank', () => {
  const entries = [
    { id: 'a', venue_name: 'Untappd at Home' }, { id: 'b', venue_name: 'home' }, { id: 'c', venue_name: ' Trillium ' },
    { id: 'd', venue_name: '' }, { id: 'e' }, { id: 'f', venue_name: 'Home' }, { id: 'g', venue_name: 'Tree House' },
  ];
  const { ctx, calls } = app(entries);
  ctx.migrateHomeVenue();
  assert.deepEqual(entries.map(e => e.venue_name), ['Home', 'Home', 'Trillium', '', undefined, 'Home', 'Tree House']);
  assert.equal(calls.save, 1);
  // Arrays built inside the sandbox belong to another realm; compare plain copies.
  assert.equal(calls.queued.length, 1);
  const q = calls.queued[0];
  assert.deepEqual({ table: q.table, ids: [...q.ids], op: q.op }, { table: 'check_ins', ids: ['a', 'b', 'c'], op: 'upsert' });
  assert.equal(q.isNew, undefined);   // not isNew: these rows already exist on the server
});

test('VR4: a second load finds nothing — no save, nothing queued', () => {
  const { ctx, calls } = app([{ id: 'a', venue_name: 'Home' }, { id: 'b', venue_name: 'Tree House' }, { id: 'c', venue_name: '' }]);
  ctx.migrateHomeVenue();
  assert.equal(calls.save, 0);
  assert.deepEqual(calls.queued, []);
});

test('VR5: a pulled row with the old label arrives as Home; null stays blank; purchase untouched', () => {
  const { ctx } = app();
  const row = v => ({ id: 'x', beer_name: 'B', created_at: ago(1), venue_name: v, purchase_venue: 'Untappd at Home' });
  assert.equal(ctx.checkInFromRow(row('Untappd at Home')).venue_name, 'Home');
  assert.equal(ctx.checkInFromRow(row(null)).venue_name, '');
  assert.equal(ctx.checkInFromRow(row('Tree House')).venue_name, 'Tree House');
  assert.equal(ctx.checkInFromRow(row('Home')).purchase_venue, 'Untappd at Home');   // VR9
});

test('VR3/VR9a: import, check-in and edit store the normalized venue', () => {
  assert.match(extractFunction('handleImport'), /venue_name: normalizeVenue\(obj\.venue_name\)/);
  assert.match(extractFunction('submitCheckin'), /venue_name: normalizeVenue\(document\.getElementById\('venueWhere'\)\.value\)/);
  assert.match(extractFunction('saveEdit'), /e\.venue_name = normalizeVenue\(document\.getElementById\('e_venue'\)\.value\)/);
});

test('VR4: init() runs the migration before the first buildLiveLists()', () => {
  const init = extractFunction('init');
  assert.ok(init.indexOf('migrateHomeVenue();') > -1);
  assert.ok(init.indexOf('migrateHomeVenue();') < init.indexOf('buildLiveLists();'));
});

test('VR12: edit and delete rebuild the live lists', () => {
  assert.match(extractFunction('saveEdit'), /buildLiveLists\(\);/);
  assert.match(extractFunction('deleteEntry'), /buildLiveLists\(\);/);
});

// ── Part 2: frecency ───────────────────────────────────────────

test('VR11: each use adds 0.5^(age / half-life), keyed by the normalized name', () => {
  const { ctx } = app([
    { venue_name: 'Trillium', created_at: ago(0) },
    { venue_name: ' trillium ', created_at: ago(60) },
    { venue_name: 'Tree House', created_at: ago(120) },
    { venue_name: 'Tree House', created_at: ago(120).replace('T', ' ') },   // CSV-style space
  ]);
  const s = ctx.computePlaceScores('venue_name');
  assert.ok(Math.abs(s.get('trillium') - 1.5) < 0.01);
  assert.ok(Math.abs(s.get('tree house') - 0.5) < 0.01);
});

test('VR11/VR14: blanks and unparseable dates are skipped; Home is scored; a future date counts as today', () => {
  const { ctx } = app([
    { venue_name: 'Home', created_at: ago(0) },
    { venue_name: '', created_at: ago(0) },
    { venue_name: 'Bad Date', created_at: 'garbage' },
    { venue_name: 'Future', created_at: ago(-5) },
  ]);
  const s = ctx.computePlaceScores('venue_name');
  assert.deepEqual([...s.keys()], ['home', 'future']);
  assert.equal(s.get('future'), 1);
});

test('VR10: zero entries → empty scores', () => {
  const { ctx } = app([]);
  assert.equal(ctx.computePlaceScores('venue_name').size, 0);
});

test('VR12: buildLiveLists() computes both maps', () => {
  const live = extractFunction('buildLiveLists');
  assert.match(live, /venueScores = computePlaceScores\('venue_name'\);/);
  assert.match(live, /purchaseScores = computePlaceScores\('purchase_venue'\);/);
});

// ── VR18: typed ranking ────────────────────────────────────────

test('VR18: word-start matches first, then score, then alphabetical', () => {
  const { ctx } = app();
  const scores = new Map([['tree house brewing', 1], ['trillium brewing', 3], ['the trap', 0.2]]);
  const rank = ctx.placeRanker(() => scores);
  const matches = ['Pastoral Artisan', 'Tree House Brewing', 'The Trap', 'Trillium Brewing', 'Astra Bar'];
  // "Pastoral Artisan" and "Astra Bar" contain "tr" only mid-word.
  assert.deepEqual(rank(matches, 'tr'), ['Trillium Brewing', 'Tree House Brewing', 'The Trap', 'Astra Bar', 'Pastoral Artisan']);
});

test('VR14/VR18: a scored Home outranks other word-start matches for "ho"', () => {
  const { ctx } = app([
    ...Array.from({ length: 20 }, () => ({ venue_name: 'Home', created_at: ago(30) })),
    ...['Rose Alley Ale House', 'Embassy Suites Hotel', 'Hog Island', 'Barrel House Z'].map(v => ({ venue_name: v, created_at: ago(1) })),
  ]);
  const scores = ctx.computePlaceScores('venue_name');
  const list = ['Barrel House Z', 'Embassy Suites Hotel', 'Hog Island', 'Home', 'Rose Alley Ale House'];
  assert.equal(dropValues(ctx, list, 'ho', ctx.placeRanker(() => scores))[0], 'Home');
});

test('VR18: the ranker reads the current scores on every call', () => {
  const { ctx } = app();
  let scores = new Map([['a bar', 1]]);
  const rank = ctx.placeRanker(() => scores);
  assert.deepEqual(rank(['A Bar', 'A Pub'], 'a'), ['A Bar', 'A Pub']);
  scores = new Map([['a pub', 1]]);
  assert.deepEqual(rank(['A Bar', 'A Pub'], 'a'), ['A Pub', 'A Bar']);
});

// showDrop against a fake input + dropdown; returns the values it lists.
function dropValues(ctx, list, q, rank) {
  const drop = { innerHTML: '', classList: { add() {}, remove() {} }, querySelectorAll: () => [] };
  ctx.showDrop({ value: q }, drop, list, null, rank);
  return [...drop.innerHTML.matchAll(/data-val="([^"]*)"/g)].map(m => m[1]);
}

test('VR18: with a ranker, showDrop sorts before the cap of 8, so a word-start match is not cut', () => {
  const { ctx } = app();
  const list = ['Chomp A', 'Chomp B', 'Comix Roadhouse', 'Cultivator Shoals', 'Echo Lake', 'Fathoms', 'Ghost Pub', 'Ghost Two', 'Home', 'Shore Hotel'];
  const ranked = dropValues(ctx, list, 'ho', ctx.placeRanker(() => new Map()));
  // Word starts: "Home", "Shore Hotel". Everything else has "ho" mid-word.
  assert.deepEqual(ranked, ['Home', 'Shore Hotel', 'Chomp A', 'Chomp B', 'Comix Roadhouse', 'Cultivator Shoals', 'Echo Lake', 'Fathoms']);
});

test('VR18: without a ranker, showDrop keeps list order (beer/brewery/style/wishlist unchanged)', () => {
  const { ctx } = app();
  const list = ['Chomp A', 'Chomp B', 'Comix Roadhouse', 'Cultivator Shoals', 'Echo Lake', 'Fathoms', 'Ghost Pub', 'Ghost Two', 'Home', 'Shore Hotel'];
  const plain = dropValues(ctx, list, 'ho');
  assert.deepEqual(plain, list.filter(v => v.toLowerCase().includes('ho')).slice(0, 8));
  assert.ok(!plain.includes('Home'));
});

test('VR18: only the venue and purchase boxes get a ranker', () => {
  const init = extractFunction('init');
  assert.match(init, /setupAC\('venueWhere', SEED\.venues, null, placeRanker\(\(\) => venueScores\)\);/);
  assert.match(init, /setupAC\('purchaseVenue', SEED\.purchase, null, placeRanker\(\(\) => purchaseScores\)\);/);
  for (const line of init.split('\n').filter(l => /setupAC\(/.test(l) && !/venueWhere|purchaseVenue/.test(l))) {
    assert.doesNotMatch(line, /placeRanker/, line.trim());
  }
});

// ── VR15–VR21: recall chips ────────────────────────────────────

// Fake DOM for the two boxes and their chip rows.
function chipApp({ venueScores = [], purchaseScores = [], venues = [], purchase = [], values = {} } = {}) {
  const el = id => {
    const classes = new Set();
    const listeners = {};
    return {
      id, value: values[id] || '', innerHTML: '', inputEvents: 0,
      classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)), add: c => classes.add(c), contains: c => classes.has(c) },
      addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
      dispatchEvent(e) { if (e.type === 'input') this.inputEvents++; (listeners[e.type] || []).forEach(fn => fn(e)); },
      fire(t, e = {}) { (listeners[t] || []).forEach(fn => fn({ type: t, ...e })); },
    };
  };
  const els = Object.fromEntries(['venueWhere', 'purchaseVenue', 'chips-venueWhere', 'chips-purchaseVenue'].map(id => [id, el(id)]));
  const { ctx } = app([], {
    document: { getElementById: id => els[id] || null },
    SEED: { venues, purchase },
  });
  vm.runInContext([
    ...['RECALL_CHIPS', 'RECALL_FIELDS'].map(extractConst),
    ...['esc', 'topPlaces', 'toggleRecallChips', 'renderRecallChips', 'renderAllRecallChips', 'setupRecallChips'].map(extractFunction),
  ].join('\n'), ctx);
  ctx.vs = new Map(venueScores); ctx.ps = new Map(purchaseScores);
  vm.runInContext('venueScores = vs; purchaseScores = ps;', ctx);
  // Chip values and labels in a row, in order.
  const chips = id => [...els['chips-' + id].innerHTML.matchAll(/data-val="([^"]*)"><span>([^<]*)<\/span>/g)].map(m => ({ val: m[1], label: m[2] }));
  return { ctx, els, chips };
}

test('VR13/VR15: topPlaces returns the top n by score, spelled as the list shows them', () => {
  const { ctx } = chipApp();
  const scores = new Map([['trillium', 3], ['tree house', 5], ['gone', 9], ['a', 1], ['b', 1], ['c', 0.5], ['d', 0.1]]);
  const list = ['A', 'B', 'C', 'D', 'Tree House', 'Trillium'];
  // 'gone' has no list entry, so it is dropped; ties fall back to alphabetical.
  assert.deepEqual([...ctx.topPlaces(scores, list, 5)], ['Tree House', 'Trillium', 'A', 'B', 'C']);
});

test('VR14/VR15: venue row is Home then the top 5 others (Home not repeated); purchase row is the top 5 with no Home', () => {
  const venueScores = [['home', 99], ['v1', 6], ['v2', 5], ['v3', 4], ['v4', 3], ['v5', 2], ['v6', 1]];
  const { ctx, chips } = chipApp({
    venueScores, venues: ['V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'Home'],
    purchaseScores: [['shop', 2], ['store', 1]], purchase: ['Shop', 'Store'],
  });
  ctx.renderAllRecallChips();
  assert.deepEqual(chips('venueWhere'), [
    { val: 'Home', label: 'Home' },   // plain label, no emoji
    ...['V1', 'V2', 'V3', 'V4', 'V5'].map(v => ({ val: v, label: v })),
  ]);
  assert.deepEqual(chips('purchaseVenue').map(c => c.val), ['Shop', 'Store']);
});

test('VR19: cold start — venue shows only Home, purchase row is empty (no placeholder)', () => {
  const { ctx, els, chips } = chipApp();
  ctx.renderAllRecallChips();
  assert.deepEqual(chips('venueWhere').map(c => c.val), ['Home']);
  assert.equal(els['chips-purchaseVenue'].innerHTML, '');
});

test('VR21: chip text is escaped', () => {
  const { ctx, chips } = chipApp({ venueScores: [['tom\'s "big" <bar> & grill', 1]], venues: ['Tom\'s "Big" <Bar> & Grill'] });
  ctx.renderAllRecallChips();
  assert.deepEqual(chips('venueWhere')[1], { val: 'Tom\'s &quot;Big&quot; &lt;Bar> &amp; Grill', label: 'Tom\'s &quot;Big&quot; &lt;Bar> &amp; Grill' });
});

test('VR16: a tap fills the box and hides the row, with no input event (dropdown stays shut)', () => {
  const { ctx, els } = chipApp({ venueScores: [['trillium', 1]], venues: ['Trillium'] });
  ctx.renderAllRecallChips();
  ctx.setupRecallChips('venueWhere');
  const chip = { dataset: { val: 'Trillium' } };
  els['chips-venueWhere'].fire('click', { target: { closest: () => chip } });
  assert.equal(els.venueWhere.value, 'Trillium');
  assert.equal(els['chips-venueWhere'].classList.contains('hide'), true);
  assert.equal(els.venueWhere.inputEvents, 0);
});

test('VR16: a tap between chips does nothing', () => {
  const { ctx, els } = chipApp();
  ctx.setupRecallChips('venueWhere');
  els['chips-venueWhere'].fire('click', { target: { closest: () => null } });
  assert.equal(els.venueWhere.value, '');
});

test('VR16: typing hides the row; clearing brings it back', () => {
  const { ctx, els } = chipApp();
  ctx.renderAllRecallChips();
  ctx.setupRecallChips('venueWhere');
  els.venueWhere.value = 'tr'; els.venueWhere.fire('input');
  assert.equal(els['chips-venueWhere'].classList.contains('hide'), true);
  els.venueWhere.value = ''; els.venueWhere.fire('input');
  assert.equal(els['chips-venueWhere'].classList.contains('hide'), false);
});

test('VR16: a rebuild while the box has text keeps the row hidden', () => {
  const { ctx, els } = chipApp({ values: { venueWhere: 'Tree' } });
  ctx.renderAllRecallChips();
  assert.equal(els['chips-venueWhere'].classList.contains('hide'), true);
});

test('VR17/VR16: wiring — chips render from buildLiveLists(), init() sets them up, resetForm() re-shows them', () => {
  assert.match(extractFunction('buildLiveLists'), /renderAllRecallChips\(\);/);
  assert.match(extractFunction('init'), /RECALL_FIELDS\.forEach\(setupRecallChips\);/);
  assert.match(extractFunction('resetForm'), /RECALL_FIELDS\.forEach\(toggleRecallChips\);/);
  // Never pre-filled: nothing assigns a chip value to the box outside the tap handler.
  assert.doesNotMatch(extractFunction('renderAllRecallChips'), /\.value\s*=/);
});

test('VR20: the edit modal gets no chips', () => {
  assert.doesNotMatch(script, /chips-e_venue|chips-e_purchase/);
});
