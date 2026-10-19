#!/usr/bin/env node
// Discover redesign — shared plumbing (DISCOVER_REDESIGN_HANDOFF.md §2, §3, §8).
// Run:
//   node --test tests/discover.test.js
//
// Real-source-pulled: functions and consts are extracted verbatim from the
// inline <script> in index.html and run in a sandbox with a minimal DOM.

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');

const { script, extractFunction } = require('./helpers');
const STYLE_MATRIX = require('../style_matrix.js');
const STYLE_MATRIX_SRC = require('fs').readFileSync(require('path').join(__dirname, '..', 'style_matrix.js'), 'utf8');
const ENGINE_SRC = require('fs').readFileSync(require('path').join(__dirname, '..', 'proximity_engine.js'), 'utf8');

const DAY = 86400000;

// A multi-line top-level const (array / Set / object), verbatim.
function extractBlock(name) {
  const start = script.search(new RegExp(`^const ${name} = `, 'm'));
  if (start === -1) throw new Error(`const ${name} not found`);
  const open = script.slice(start).search(/[[({]/) + start;
  let depth = 0;
  for (let i = open; i < script.length; i++) {
    if ('[({'.includes(script[i])) depth++;
    else if (')]}'.includes(script[i]) && --depth === 0) return script.slice(start, script.indexOf(';', i) + 1);
  }
  throw new Error(`unbalanced ${name}`);
}
const line = name => script.match(new RegExp(`^(?:const|let) ${name} = [^\\n]*;`, 'm'))[0];

// ── Non-recommendable styles (§3) ──────────────────────────────

function filterCtx() {
  const ctx = vm.createContext({ STYLE_MATRIX });
  vm.runInContext([extractBlock('NON_RECOMMENDABLE_STYLES'), extractFunction('isRecommendableStyle')].join('\n'), ctx);
  return ctx;
}

test('OF2: the list is the resolved 15 keys, every one a real STYLE_MATRIX key', () => {
  const ctx = filterCtx();
  const list = [...vm.runInContext('NON_RECOMMENDABLE_STYLES', ctx)];
  assert.equal(list.length, 15);
  assert.deepEqual(list.filter(k => !STYLE_MATRIX[k]), []);
  ['Other', 'Porter - Other', 'Historical Beer - Other', 'Dark Ale', 'Traditional Ale'].forEach(k => assert.ok(list.includes(k), k));
});

test('OF2: every "- Other" bin is listed except the orderable Sour - Other Gose', () => {
  const ctx = filterCtx();
  const otherBins = Object.keys(STYLE_MATRIX).filter(k => / - Other$/.test(k));
  assert.deepEqual(otherBins.filter(k => ctx.isRecommendableStyle(k)), []);
  assert.equal(ctx.isRecommendableStyle('Sour - Other Gose'), true);
});

test('OF2: reviewed-and-kept styles stay recommendable; unknown or empty input is not', () => {
  const ctx = filterCtx();
  ['Malt Liquor', 'Root Beer', 'Hard Ginger Beer', 'Shandy / Radler', 'Spiced / Herbed Beer', 'Fruit Beer', 'IPA - New England / Hazy']
    .forEach(k => assert.equal(ctx.isRecommendableStyle(k), true, k));
  [null, '', 'Not A Style'].forEach(k => assert.equal(ctx.isRecommendableStyle(k), false, String(k)));
});

// ── Per-mode suppression (§8) ──────────────────────────────────

function suppressionCtx(rows = []) {
  const store = { hopprint_rec_suppression: JSON.stringify(rows) };
  const ctx = vm.createContext({
    localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v; } },
  });
  vm.runInContext([
    line('SUPPRESSION_WINDOWS'), line('SUPPRESSION_PRUNE_DAYS'),
    ...['loadSuppression', 'saveSuppression', 'isSuppressed', 'recordShown', 'takeUnsuppressed'].map(extractFunction),
  ].join('\n'), ctx);
  ctx.rows = () => JSON.parse(store.hopprint_rec_suppression);
  return ctx;
}

test('§8: windows are 4 / 7 / 14 / 30 days and the prune is 31', () => {
  const ctx = suppressionCtx();
  assert.deepEqual({ ...vm.runInContext('SUPPRESSION_WINDOWS', ctx) }, { gaps: 7, occasion: 4, brewery: 14, rediscovery: 30 });
  assert.equal(vm.runInContext('SUPPRESSION_PRUNE_DAYS', ctx), 31);
});

test('§8: recordShown writes { mode, key, timestamp } rows', () => {
  const ctx = suppressionCtx();
  ctx.recordShown(['roast'], 'gaps');
  const [row] = ctx.rows();
  assert.deepEqual(Object.keys(row).sort(), ['key', 'mode', 'timestamp']);
  assert.equal(row.key, 'roast');
  assert.equal(row.mode, 'gaps');
});

test('§8: the mode namespaces the key — the same key in another mode is not suppressed', () => {
  const now = Date.now();
  const ctx = suppressionCtx();
  const list = [{ mode: 'brewery', key: 'Trillium', timestamp: now }];
  assert.equal(ctx.isSuppressed('Trillium', 'brewery', 14, list), true);
  assert.equal(ctx.isSuppressed('Trillium', 'rediscovery', 30, list), false);
  // style|occasion keys don't collide with the bare style
  const occ = [{ mode: 'occasion', key: 'Kölsch|home', timestamp: now }];
  assert.equal(ctx.isSuppressed('Kölsch|out', 'occasion', 4, occ), false);
  assert.equal(ctx.isSuppressed('Kölsch', 'occasion', 4, occ), false);
});

test('§8: window edges — inside suppresses, past it does not, 0 never does', () => {
  const ctx = suppressionCtx();
  const list = [{ mode: 'gaps', key: 'roast', timestamp: Date.now() - 6.5 * DAY }];
  assert.equal(ctx.isSuppressed('roast', 'gaps', 7, list), true);
  assert.equal(ctx.isSuppressed('roast', 'gaps', 6, list), false);
  assert.equal(ctx.isSuppressed('roast', 'gaps', 0, list), false);
});

test('§8: rows from the retired modes never match and age out at the prune', () => {
  const now = Date.now();
  const legacy = [
    { style: 'IPA - American', mode: 'wheelhouse', timestamp: now - 2 * DAY },
    { style: 'Porter - English', mode: 'wildcard', timestamp: now - 32 * DAY },
  ];
  const ctx = suppressionCtx(legacy);
  assert.equal(ctx.isSuppressed('IPA - American', 'wheelhouse', 4, legacy), false, 'no key field: a style never matches');
  ctx.recordShown(['roast'], 'gaps');
  const rows = ctx.rows();
  assert.equal(rows.some(r => r.mode === 'wildcard'), false, 'older than 31 days is pruned');
  assert.equal(rows.some(r => r.mode === 'wheelhouse'), true, 'younger legacy rows wait for the prune');
});

test('§8: prune keeps a 30-day Rediscovery row and drops a 32-day one', () => {
  const now = Date.now();
  const ctx = suppressionCtx([
    { mode: 'rediscovery', key: 'a', timestamp: now - 30 * DAY },
    { mode: 'rediscovery', key: 'b', timestamp: now - 32 * DAY },
  ]);
  ctx.recordShown(['c'], 'rediscovery');
  assert.deepEqual(ctx.rows().map(r => r.key), ['a', 'c']);
});

test('§8: takeUnsuppressed walks full window → half → none and flags starvation', () => {
  const now = Date.now();
  const ctx = suppressionCtx([
    { mode: 'brewery', key: 'A', timestamp: now - 1 * DAY },   // inside half (7) and full (14)
    { mode: 'brewery', key: 'B', timestamp: now - 10 * DAY },  // inside full only
  ]);
  const cands = ['A', 'B', 'C'];
  const id = x => x;
  assert.deepEqual([...ctx.takeUnsuppressed(cands, 'brewery', id, 1).cards], ['C']);
  const two = ctx.takeUnsuppressed(cands, 'brewery', id, 2);
  assert.deepEqual([...two.cards], ['B', 'C']);   // half window frees B
  assert.equal(two.starved, false);
  const three = ctx.takeUnsuppressed(cands, 'brewery', id, 3);
  assert.deepEqual([...three.cards], ['A', 'B', 'C']); // window 0 frees everything
  const four = ctx.takeUnsuppressed(cands, 'brewery', id, 4);
  assert.equal(four.starved, true);
});

// ── Mode registry and gating (DS1–DS6) ─────────────────────────

function el() {
  return { innerHTML: '', disabled: false, insertAdjacentHTML(_, h) { this.innerHTML += h; } };
}

function gridCtx(entries = [{ id: 1 }], extraModes = '', { store = {}, wishlist = [], random = Math.random } = {}) {
  const els = { modeGrid: el(), discoverLocked: el(), discoverGo: el(), recResults: el(), discoverOptions: el() };
  const toasts = [];
  const queued = [];
  let n = 0;
  const ctx = vm.createContext({
    entries, wishlist,
    document: { getElementById: id => els[id] || null, querySelectorAll: () => [] },
    localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v; } },
    Math: Object.assign(Object.create(Math), { random }),
    icon: () => '', renderWishlist() {}, showToast: m => toasts.push(m),
    newId: () => `id-${++n}`, queueSync: (...a) => queued.push(a),
  });
  vm.runInContext(STYLE_MATRIX_SRC, ctx);
  vm.runInContext(ENGINE_SRC, ctx);
  vm.runInContext([
    ...['discoverMode', 'discoverQueue', 'discoverQueueMode', 'discoverStarved', 'discoverShownKey', 'discoverShownCard', 'discoverContext'].map(line),
    line('HOME_VENUE'), line('UNTAPPD_HOME'), extractBlock('OCCASIONS'), extractBlock('NON_RECOMMENDABLE_STYLES'),
    line('STYLE_KEY_INDEX'), line('NEIGHBOR_INDEX'), line('OCCASION_SIDE'), extractBlock('OCCASION_SIDES'),
    line('OCCASION_MIN_RATED'), line('OCCASION_SIX_UNLOCKED'), line('OCCASION_SMARTER_SHARE'), line('OCCASION_BATCH'),
    line('SUPPRESSION_WINDOWS'), line('SUPPRESSION_PRUNE_DAYS'), extractBlock('RATING_BANDS'),
    line('REDISCOVERY_MIN_AGE_DAYS'), line('REDISCOVERY_BATCH'), line('REDISCOVERY_RETIRED_KEY'),
    line('DISC_NOT_BUILT'), extractBlock('DISC_MODES'), extraModes,
    ...['esc', 'stubBeerKey', 'loadSuppression', 'saveSuppression', 'isSuppressed', 'recordShown', 'takeUnsuppressed',
      'discModeById', 'discGates', 'buildModeGrid', 'selectMode', 'enterDiscover', 'generateRecs', 'renderNextRec',
      'isOnWishlist', 'recSaveButton', 'saveShownToWishlist',
      'loadRetired', 'saveRetired', 'rediscoveryCandidates', 'rediscoveryGate', 'buildRediscovery', 'rediscoveryRationale',
      'renderRediscoveryCard', 'rediscoveryActions', 'askRetireShown', 'cancelRetireShown', 'retireShownBeer',
      'normalizeVenue', 'normalizeStyleKey', 'resolveMatrixStyle', 'isRecommendableStyle', 'computeSignalModel', 'getNeighborIndex',
      'renderDiscoverOptions', 'occasionSideOf', 'occasionContexts', 'occasionOptions', 'occasionGate', 'renderOccasionOptions',
      'selectDiscoverContext', 'occasionPrecheck', 'buildOccasion', 'occasionPlace', 'occasionRationale', 'renderOccasionCard'].map(extractFunction),
  ].join('\n'), ctx);
  const shown = () => JSON.parse(store.hopprint_rec_suppression || '[]').map(r => [r.key, r.mode]);
  return { ctx, els, toasts, queued, store, shown, get: n => vm.runInContext(n, ctx) };
}

// Replace one registry entry with a built, open test mode.
const fakeMode = `DISC_MODES[3] = { id:'rediscovery', iconName:'x', name:'Rediscovery', desc:'d',
  gate: () => ({ open: true, reason: '' }),
  build: () => ({ cards: [{ beer: 'It\\'s "Quoted"' }, { beer: 'Second' }], starved: false }),
  renderCard: c => '<div class="rec-name">' + c.beer + '</div>',
  suppressionKey: c => c.beer };`;

test('DS1/DS2: the picker is the four new modes, the old four are gone', () => {
  const { get } = gridCtx();
  assert.deepEqual([...get('DISC_MODES').map(m => m.id)], ['gaps', 'occasion', 'brewery', 'rediscovery']);
  assert.doesNotMatch(script, /'wheelhouse'|'wildcard'|buildAffinityRecs|wildcardConfidence|rationaleFor\(/);
});

test('DS5: with every mode gated, the tab shows its locked state and the button is disabled', () => {
  const { ctx, els } = gridCtx();
  ctx.enterDiscover();
  assert.match(els.discoverLocked.innerHTML, /class="empty"/);
  assert.equal(els.discoverGo.disabled, true);
  assert.equal((els.modeGrid.innerHTML.match(/mode-card gated/g) || []).length, 4);
});

test('DS4: a gated mode renders greyed with its reason, and cannot be selected', () => {
  const { ctx, els, get } = gridCtx();
  ctx.buildModeGrid();
  assert.equal((els.modeGrid.innerHTML.match(/class="mode-reason">Not built yet</g) || []).length, 2);
  assert.match(els.modeGrid.innerHTML, /class="mode-reason">Needs 5 rated check-ins at home or out</);
  assert.match(els.modeGrid.innerHTML, /class="mode-reason">Needs a beer you rated Definitely/);
  ctx.selectMode('gaps');
  assert.equal(get('discoverMode'), '');
});

test('DS4: one open mode lifts the tab lock; only that mode is selectable', () => {
  const { ctx, els, get } = gridCtx(undefined, fakeMode);
  ctx.buildModeGrid();
  assert.equal(els.discoverLocked.innerHTML, '');
  assert.equal(els.discoverGo.disabled, false);
  assert.equal((els.modeGrid.innerHTML.match(/mode-card gated/g) || []).length, 3);
  ctx.selectMode('rediscovery');
  assert.equal(get('discoverMode'), 'rediscovery');
});

test('DS4: a selected mode that becomes gated is deselected on the next visit', () => {
  const { ctx, get } = gridCtx(undefined, fakeMode);
  ctx.selectMode('rediscovery');
  vm.runInContext("DISC_MODES[3].gate = () => ({ open: false, reason: 'Needs more' })", ctx);
  ctx.enterDiscover();
  assert.equal(get('discoverMode'), '');
});

test('DS3: Find My Next Beer with no mode picked asks for one instead of defaulting', () => {
  const { ctx, toasts, els } = gridCtx(undefined, fakeMode);
  ctx.generateRecs();
  assert.equal(toasts.length, 1);
  assert.equal(els.recResults.innerHTML, '');
});

test('DS6: a card renders through its mode, stamps its mode key, and never inlines the key', () => {
  const { ctx, els, shown, get } = gridCtx(undefined, fakeMode);
  ctx.selectMode('rediscovery');
  ctx.generateRecs();
  assert.match(els.recResults.innerHTML, /rec-name">It's "Quoted"</);
  assert.match(els.recResults.innerHTML, /onclick="notInterestedRec\(discoverShownKey, discoverQueueMode\)"/);
  assert.deepEqual(shown(), [[`It's "Quoted"`, 'rediscovery']]);
  assert.equal(get('discoverShownKey'), `It's "Quoted"`);
  ctx.renderNextRec();
  assert.equal(get('discoverShownKey'), 'Second');
});

// ── Rediscovery (§7) ───────────────────────────────────────────

// Wall-clock strings, like real check-ins. ago(400) = 400 days before now.
const ago = days => new Date(Date.now() - days * DAY).toISOString().slice(0, 16);
const ci = (beer_name, days, rating, extra = {}) => ({ id: `${beer_name}-${days}`, beer_name, brewery_name: 'Hill Farmstead', beer_type: 'Saison - Traditional', created_at: ago(days), rating, source: 'live', ...extra });
const names = list => [...list].map(c => c.name).sort();

test('RD2: Definitely on the latest rating and last logged a year or more ago qualifies', () => {
  const { ctx } = gridCtx();
  const out = ctx.rediscoveryCandidates([ci('Old Love', 400, 85), ci('Too Recent', 200, 90), ci('Edge', 366, 67), ci('Maybe', 500, 66)]);
  assert.deepEqual(names(out), ['Edge', 'Old Love']);
});

test('RD2: the most recent rating wins over earlier ones', () => {
  const { ctx } = gridCtx();
  const cooled = [ci('Cooled', 900, 90), ci('Cooled', 500, 50)];
  const warmed = [ci('Warmed', 900, 40), ci('Warmed', 500, 80)];
  assert.deepEqual(names(ctx.rediscoveryCandidates([...cooled, ...warmed])), ['Warmed']);
});

test('RD2: an unrated check-in still counts as "last logged"', () => {
  const { ctx } = gridCtx();
  const recentPour = [ci('Recent Pour', 800, 90), ci('Recent Pour', 30, null)];
  const oldPour = [ci('Old Pour', 800, 90), ci('Old Pour', 400, null)];
  assert.deepEqual(names(ctx.rediscoveryCandidates([...recentPour, ...oldPour])), ['Old Pour']);
  assert.deepEqual(names(ctx.rediscoveryCandidates([ci('Never Rated', 800, null)])), []);
});

test('RD2: imported ratings count — 4 stars (80) qualifies and is marked imported; 3 stars (60) does not', () => {
  const { ctx } = gridCtx();
  const imp = (name, rating) => ci(name, 700, rating, { source: 'import', rating_mode: 'import' });
  const out = ctx.rediscoveryCandidates([imp('Four Star', 80), imp('Three Star', 60)]);
  assert.deepEqual(names(out), ['Four Star']);
  assert.equal(out[0].imported, true);
});

test('RD2: the same beer under case/space drift is one beer', () => {
  const { ctx } = gridCtx();
  const out = ctx.rediscoveryCandidates([ci('Ann', 800, 90), ci('  ann ', 20, null, { brewery_name: 'hill  farmstead' })]);
  assert.deepEqual(names(out), []);
});

test('OF5/RD6: a beer logged under a non-recommendable bin is still recommended, style as logged', () => {
  const { ctx } = gridCtx();
  const [c] = ctx.rediscoveryCandidates([ci('Mystery Porter', 400, 90, { beer_type: 'Porter - Other' })]);
  assert.equal(c.style, 'Porter - Other');
});

test('RD5: gated with a reason until one beer qualifies', () => {
  const { ctx } = gridCtx();
  const closed = ctx.rediscoveryGate([ci('Recent', 10, 90)]);
  assert.equal(closed.open, false);
  assert.ok(closed.reason.length > 0);
  assert.equal(ctx.rediscoveryGate([ci('Old', 400, 90)]).open, true);
});

test('RD3: selection is random among qualifiers, five at most', () => {
  const seven = Array.from({ length: 7 }, (_, i) => ci(`B${i}`, 400 + i, 90));
  const first = gridCtx(seven, '', { random: () => 0 }).ctx.buildRediscovery(seven).cards.map(c => c.name);
  const other = gridCtx(seven, '', { random: () => 0.99 }).ctx.buildRediscovery(seven).cards.map(c => c.name);
  assert.equal(first.length, 5);
  assert.notDeepEqual(first, other);
});

test('§8: a beer shown in the last 30 days waits unless nothing else is left', () => {
  const two = [ci('Shown', 400, 90), ci('Fresh', 400, 90)];
  const store = { hopprint_rec_suppression: JSON.stringify([{ mode: 'rediscovery', key: 'shown|hill farmstead', timestamp: Date.now() - 20 * DAY }]) };
  const { ctx } = gridCtx(two, '', { store });
  // target 5 > pool: the ladder drops to window 0 and both come back
  assert.deepEqual(names(ctx.buildRediscovery(two).cards), ['Fresh', 'Shown']);
  const half = gridCtx(two, '', { store: { hopprint_rec_suppression: JSON.stringify([{ mode: 'rediscovery', key: 'shown|hill farmstead', timestamp: Date.now() - 20 * DAY }]) } });
  const { cards } = half.ctx.takeUnsuppressed(half.ctx.rediscoveryCandidates(two), 'rediscovery', c => c.key, 1);
  assert.deepEqual(names(cards), ['Fresh']);
});

function fakeNode(els, id) {
  const node = { innerHTML: '', classList: { add() {} }, removeAttribute() {}, set outerHTML(h) { node.replacedWith = h; } };
  els[id] = node;
  return node;
}

function showOne(list, opts) {
  const app = gridCtx(list, '', opts);
  app.ctx.enterDiscover();
  app.ctx.selectMode('rediscovery');
  app.ctx.generateRecs();
  return app;
}

test('Rediscovery card: name, brewery, style, band rationale — and no raw score anywhere (D1)', () => {
  const { els } = showOne([ci('Arthur', 400, 87, { beer_abv: '6.0' })]);
  const html = els.recResults.innerHTML;
  assert.match(html, /rec-name">Arthur</);
  assert.match(html, /Hill Farmstead · 6\.0% ABV/);
  assert.match(html, /etag style">Saison - Traditional</);
  assert.match(html, /Definitely/);
  assert.doesNotMatch(html, /\b87\b/);
});

test('Rediscovery card: imported ratings say so (provenance)', () => {
  const { els } = showOne([ci('Imported', 400, 80, { source: 'import', rating_mode: 'import' })]);
  assert.match(els.recResults.innerHTML, /\(imported\)/);
});

test('Rediscovery footer: Show Another and Can\'t Get It Anymore — no Not Interested', () => {
  const { els } = showOne([ci('Arthur', 400, 87)]);
  assert.doesNotMatch(els.recResults.innerHTML, /Not Interested/);
  assert.match(els.recResults.innerHTML, /id="recRetire" onclick="askRetireShown\(\)">Can't Get It Anymore</);
});

test('RD4: retiring asks first; Cancel puts the button back', () => {
  const app = showOne([ci('Arthur', 400, 87)]);
  const node = fakeNode(app.els, 'recRetire');
  app.ctx.askRetireShown();
  assert.match(node.innerHTML, /Retire for good\? <span onclick="retireShownBeer\(\)">Yes<\/span>/);
  assert.equal(app.ctx.loadRetired().length, 0, 'asking does not retire');
  app.ctx.cancelRetireShown();
  assert.match(node.replacedWith, /onclick="askRetireShown\(\)"/);
});

test('RD4: Yes retires the beer permanently — it survives a reload and never comes back', () => {
  const store = {};
  const list = [ci('Arthur', 400, 87), ci('Anna', 500, 90)];
  const app = showOne(list, { store, random: () => 0 });
  const shown = app.get('discoverShownCard');
  const shownName = shown.name;
  app.ctx.retireShownBeer();
  assert.equal(app.ctx.loadRetired().length, 1);
  assert.deepEqual(app.queued.map(q => [...q]), [['rediscovery_retired', app.ctx.loadRetired()[0].id, 'upsert', true]]);
  app.ctx.discoverShownCard = shown;
  vm.runInContext('discoverShownCard = globalThis.discoverShownCard', app.ctx);
  app.ctx.retireShownBeer();   // the same beer again doesn't duplicate
  assert.deepEqual([...app.ctx.loadRetired().map(r => r.beer_name)], [shownName]);
  const row = app.ctx.loadRetired()[0];
  assert.deepEqual(Object.keys(row).sort(), ['brewery_name', 'beer_name', 'id', 'key', 'retired_at'].sort());
  const reloaded = gridCtx(list, '', { store });   // fresh sandbox, same storage
  assert.deepEqual(names(reloaded.ctx.rediscoveryCandidates(list)), list.map(e => e.beer_name).filter(n => n !== shownName));
});

test('Save pill: saves the shown beer once, queues its sync, and flips to saved', () => {
  const wishlist = [];
  const app = showOne([ci('Arthur', 400, 87)], { wishlist });
  assert.match(app.els.recResults.innerHTML, /class="rec-save" id="recSave"/);
  const pill = fakeNode(app.els, 'recSave');
  app.ctx.saveShownToWishlist();
  app.ctx.saveShownToWishlist();
  assert.equal(wishlist.length, 1);
  assert.deepEqual({ name: wishlist[0].name, brewery: wishlist[0].brewery, style: wishlist[0].style }, { name: 'Arthur', brewery: 'Hill Farmstead', style: 'Saison - Traditional' });
  assert.deepEqual(app.queued, [['wishlist', wishlist[0].id, 'upsert', true]]);
  assert.match(pill.replacedWith, /rec-save saved/);
});

test('Save pill: a beer already on the wish list renders as saved', () => {
  const { els } = showOne([ci('Arthur', 400, 87)], { wishlist: [{ id: 'w', name: 'ARTHUR', brewery: 'hill farmstead' }] });
  assert.match(els.recResults.innerHTML, /rec-save saved">On Wish List</);
});

// ── Occasion (§5) ──────────────────────────────────────────────

let occN = 0;
const oc = (beer_type, rating, extra = {}) => ({ id: `o${++occN}`, beer_name: `Beer ${occN}`, brewery_name: 'B', beer_type, rating, created_at: ago(30), ...extra });
const home = (style, rating = 90, extra = {}) => oc(style, rating, { venue_name: 'Home', ...extra });
const out = (style, rating = 90, extra = {}) => oc(style, rating, { venue_name: 'Tired Hands', ...extra });
const times = (n, f) => Array.from({ length: n }, f);

test('OC3: Home and "Untappd at Home" derive home, any other venue out, no venue is left out', () => {
  const { ctx } = gridCtx();
  assert.deepEqual({ ...ctx.occasionSideOf({ venue_name: 'Home' }) }, { side: 'home', stated: false });
  assert.deepEqual({ ...ctx.occasionSideOf({ venue_name: 'Untappd at Home' }) }, { side: 'home', stated: false });
  assert.deepEqual({ ...ctx.occasionSideOf({ venue_name: 'Monk’s Café' }) }, { side: 'out', stated: false });
  assert.equal(ctx.occasionSideOf({ venue_name: '' }), null);
  assert.equal(ctx.occasionSideOf({}), null);
});

test('OC4/OC5: a stated occasion wins over the venue; traveling and the rest map to out', () => {
  const { ctx } = gridCtx();
  assert.deepEqual({ ...ctx.occasionSideOf({ occasion: 'bar-taproom', venue_name: 'Home' }) }, { side: 'out', stated: true });
  assert.deepEqual({ ...ctx.occasionSideOf({ occasion: 'home-social', venue_name: 'Tired Hands' }) }, { side: 'home', stated: true });
  ['traveling', 'event', 'dining', 'bar-taproom'].forEach(o => assert.equal(ctx.occasionSideOf({ occasion: o }).side, 'out', o));
  ['home-solo', 'home-social'].forEach(o => assert.equal(ctx.occasionSideOf({ occasion: o }).side, 'home', o));
});

test('OC1: only rated, style-matched check-ins feed a side', () => {
  const { ctx } = gridCtx();
  const { sides } = ctx.occasionContexts([home('Stout - American'), home('Stout - American', null), home('Not A Style'), out('Pilsner - German')]);
  assert.equal(sides.home.entries.length, 1);
  assert.equal(sides.out.entries.length, 1);
});

test('Gate: opens when either side has 5 rated check-ins, with a reason until then', () => {
  const { ctx } = gridCtx();
  const four = [...times(4, () => home('Stout - American')), ...times(4, () => out('Pilsner - German'))];
  const closed = ctx.occasionGate(four);
  assert.equal(closed.open, false);
  assert.match(closed.reason, /5 rated check-ins/);
  assert.equal(ctx.occasionGate([...four, out('Pilsner - German')]).open, true);
});

test('Picker: Home / Out, the thin side greyed and unselectable; no choice means a toast, not picks', () => {
  const list = [...times(6, () => out('Pilsner - German')), home('Stout - American')];
  const { ctx, els, toasts, get } = gridCtx(list);
  ctx.enterDiscover();
  ctx.selectMode('occasion');
  assert.match(els.discoverOptions.innerHTML, /Where are you\?/);
  assert.match(els.discoverOptions.innerHTML, /occ-pill gated"[^>]*onclick="selectDiscoverContext\('home'\)"/);
  ctx.selectDiscoverContext('home');
  assert.equal(get('discoverContext'), '');
  ctx.generateRecs();
  assert.deepEqual(toasts, ['Pick where you are first']);
  assert.equal(els.recResults.innerHTML, '');
  ctx.selectDiscoverContext('out');
  assert.equal(get('discoverContext'), 'out');
  assert.match(els.discoverOptions.innerHTML, /occ-pill sel"[^>]*onclick="selectDiscoverContext\('out'\)"/);
});

test('Six-way: switches once 3 stated occasions have 5 each; short ones borrow the parent side', () => {
  const { ctx } = gridCtx();
  const stated = (occasion, style, n = 5) => times(n, () => oc(style, 90, { occasion }));
  const two = [...stated('home-solo', 'Stout - American'), ...stated('bar-taproom', 'Pilsner - German')];
  assert.deepEqual([...ctx.occasionOptions(two).map(o => o.id)], ['home', 'out']);
  const three = [...two, ...stated('dining', 'Farmhouse Ale - Saison'), ...stated('event', 'Pilsner - German', 2)];
  const opts = ctx.occasionOptions(three);
  assert.deepEqual([...opts.map(o => o.id)], ['home-solo', 'home-social', 'bar-taproom', 'event', 'dining', 'traveling']);
  const by = id => opts.find(o => o.id === id);
  assert.equal(by('dining').fallback, false);
  assert.equal(by('event').fallback, true);
  assert.equal(by('event').parent, 'out');
  assert.equal(by('event').open, true);                 // out has 12 rated
  assert.equal(by('home-social').fallback, true);
  assert.equal(by('home-social').open, true);           // home has 5 (home-solo)
});

test('Six-way: venue-derived check-ins never unlock a specific occasion', () => {
  const { ctx } = gridCtx();
  const list = [...times(20, () => out('Pilsner - German')), ...times(5, () => oc('Stout - American', 90, { occasion: 'home-solo' }))];
  assert.equal(ctx.occasionContexts(list).sixMode, false);
});

function occasionApp(list, context, opts) {
  const app = gridCtx(list, '', opts);
  app.ctx.enterDiscover();
  app.ctx.selectMode('occasion');
  app.ctx.selectDiscoverContext(context);
  return app;
}

test('Picks follow the context: home and out give different styles from different data', () => {
  const list = [
    ...times(6, () => home('Stout - Imperial / Double', 95)), ...times(6, () => home('Pilsner - German', 10)),
    ...times(6, () => out('Pilsner - German', 95)), ...times(6, () => out('Stout - Imperial / Double', 10)),
  ];
  const homeCards = occasionApp(list, 'home').ctx.buildOccasion(list).cards.map(c => c.style);
  const outCards = occasionApp(list, 'out').ctx.buildOccasion(list).cards.map(c => c.style);
  // The 25% novelty weight lets untried neighbours of a favourite outrank it,
  // so assert the property that matters: the two contexts don't overlap.
  assert.equal(homeCards.length, 5);
  assert.deepEqual([...homeCards.filter(st => outCards.includes(st))], []);
  assert.ok(!homeCards.includes('Pilsner - German'), 'a home dislike never shows at home');
  assert.ok(!outCards.includes('Stout - Imperial / Double'), 'an out dislike never shows out');
});

test('OF3: never recommends or cites a non-recommendable style, even a well-loved one', () => {
  const list = [...times(8, () => out('Porter - Other', 95)), ...times(3, () => out('Porter - English', 90))];
  const app = occasionApp(list, 'out');
  const cards = app.ctx.buildOccasion(list).cards;
  assert.ok(cards.length > 0);
  cards.forEach(c => {
    assert.equal(app.ctx.isRecommendableStyle(c.style), true, c.style);
    assert.doesNotMatch(app.ctx.occasionRationale(c), /Porter - Other/);
  });
});

test('Rationale: transferred picks cite loved, recommendable neighbours by name', () => {
  const { ctx } = gridCtx();
  const card = { style: 'Kölsch', context: 'home', label: 'Home', parent: 'home', fallback: false, rated: 6, stated: 6,
    result: { source: 'transferred', predictedAffinity: 4.1, contributors: [
      { style: 'Lager - Other', affinity: 4.9 }, { style: 'Pilsner - German', affinity: 4.5 }, { style: 'Lager - Helles', affinity: 1.2 }, { style: 'Cream Ale', affinity: 4.0 }] } };
  assert.match(ctx.occasionRationale(card), /^Close to Pilsner - German and Cream Ale, which you rate well at home\./);
});

test('Rationale: names the context, the stated/derived mix, and no raw score (D1)', () => {
  const { ctx } = gridCtx();
  const direct = { style: 'Pilsner - German', context: 'out', label: 'Out', parent: 'out', fallback: false, rated: 8, stated: 3,
    result: { source: 'direct', predictedAffinity: 4.6, contributors: [] } };
  const text = ctx.occasionRationale(direct);
  assert.match(text, /You rate this well when you're out\./);
  assert.match(text, /Based on 8 rated check-ins \(3 tagged, 5 worked out from the venue\)\./);
  assert.doesNotMatch(text, /\d\.\d/);
});

test('OC6: the "gets sharper" line shows at half or more derived, and not below', () => {
  const half = [...times(3, () => out('Pilsner - German')), ...times(3, () => oc('Pilsner - German', 90, { occasion: 'bar-taproom' }))];
  const a = occasionApp(half, 'out');
  assert.match(a.ctx.occasionRationale(a.ctx.buildOccasion(half).cards[0]), /get sharper/);
  const mostlyTagged = [...times(2, () => out('Pilsner - German')), ...times(4, () => oc('Pilsner - German', 90, { occasion: 'bar-taproom' }))];
  const b = occasionApp(mostlyTagged, 'out');
  assert.doesNotMatch(b.ctx.occasionRationale(b.ctx.buildOccasion(mostlyTagged).cards[0]), /get sharper/);
  const allTagged = times(5, () => oc('Pilsner - German', 90, { occasion: 'bar-taproom' }));
  const c = occasionApp(allTagged, 'out');
  assert.match(c.ctx.occasionRationale(c.ctx.buildOccasion(allTagged).cards[0]), /all tagged with an occasion/);
});

test('Six-way fallback cards say they are the parent side\'s picks', () => {
  const stated = (occasion, style) => times(5, () => oc(style, 90, { occasion }));
  const list = [...stated('home-solo', 'Stout - American'), ...stated('bar-taproom', 'Pilsner - German'), ...stated('dining', 'Farmhouse Ale - Saison')];
  const app = occasionApp(list, 'event');
  const [card] = app.ctx.buildOccasion(list).cards;
  assert.equal(card.context, 'event');
  assert.match(app.ctx.occasionRationale(card), /^Not enough Event check-ins yet, so these are your out picks\./);
});

test('Occasion card: style headline, context line, Save pill keyed to the style; suppression is per context', () => {
  const list = times(6, () => out('Pilsner - German', 95));
  const wishlist = [];
  const app = occasionApp(list, 'out', { wishlist });
  app.ctx.generateRecs();
  const html = app.els.recResults.innerHTML;
  assert.match(html, /rec-brewery">Out</);
  assert.match(html, /Not Interested/);
  const shownStyle = app.get('discoverShownCard').style;
  assert.deepEqual(app.shown(), [[`${shownStyle}|out`, 'occasion']]);
  app.ctx.saveShownToWishlist();
  assert.deepEqual({ name: wishlist[0].name, brewery: wishlist[0].brewery, style: wishlist[0].style }, { name: shownStyle, brewery: '', style: shownStyle });
});

test('Separate keys: a pick hidden under Out can still show under a fallback occasion', () => {
  const stated = (occasion, style) => times(5, () => oc(style, 90, { occasion }));
  const list = [...stated('home-solo', 'Stout - American'), ...stated('bar-taproom', 'Pilsner - German'), ...stated('dining', 'Farmhouse Ale - Saison')];
  const first = occasionApp(list, 'event').ctx.buildOccasion(list).cards[0].style;
  const now = Date.now();
  const hidden = ['out', 'bar-taproom'].map(k => ({ mode: 'occasion', key: `${first}|${k}`, timestamp: now }));
  const app = occasionApp(list, 'event', { store: { hopprint_rec_suppression: JSON.stringify(hidden) } });
  assert.equal(app.ctx.buildOccasion(list).cards[0].style, first);
});

// ── Scorer weights (proximity_engine.js) ───────────────────────

test('§5/§8: MODE_WEIGHTS holds only the Occasion posture (0.75 / 0.25)', () => {
  const ctx = vm.createContext({});
  vm.runInContext(ENGINE_SRC.match(/^const MODE_WEIGHTS = \{[\s\S]*?^\};/m)[0] + ';this.W = MODE_WEIGHTS;', ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.W)), { occasion: { affinity: 0.75, novelty: 0.25 } });
});
