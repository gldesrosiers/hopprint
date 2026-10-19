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

test('§8: takeUnsuppressed walks full window → half → none, fresh first, and flags starvation', () => {
  const now = Date.now();
  const ctx = suppressionCtx([
    { mode: 'brewery', key: 'A', timestamp: now - 1 * DAY },   // inside half (7) and full (14)
    { mode: 'brewery', key: 'B', timestamp: now - 10 * DAY },  // inside full only
  ]);
  const cands = ['A', 'B', 'C'];
  const id = x => x;
  assert.deepEqual([...ctx.takeUnsuppressed(cands, 'brewery', id, 1).cards], ['C']);
  const two = ctx.takeUnsuppressed(cands, 'brewery', id, 2);
  assert.deepEqual([...two.cards], ['C', 'B']);   // half window frees B — behind the fresh C
  assert.equal(two.starved, false);
  const three = ctx.takeUnsuppressed(cands, 'brewery', id, 3);
  assert.deepEqual([...three.cards], ['C', 'B', 'A']); // window 0 frees A last
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
    line('HOPPRINT_DIMS'), extractBlock('GAP_REGIONS'), extractBlock('GAP_LABELS'),
    ...['GAP_HIGH_MIN', 'GAP_LOW_MAX', 'GAP_THIN_SHARE', 'GAP_DISLIKE_MIN_RATED', 'GAP_MIN_STYLES', 'GAP_PICKS', 'GAP_MIN_PICKS'].map(line),
    extractBlock('STYLE_FAMILY'),
    ...['REDISCOVERY_ZONES', 'GAP_ZONES', 'BREWERY_ZONES', 'OCCASION_ZONES'].map(line),
    ...['REDISCOVERY_COPY', 'GAP_COPY', 'BREWERY_COPY', 'OCCASION_COPY'].map(extractBlock),
    ...['BREWERY_MIN_CHECKINS', 'BREWERY_MIN_RATED', 'BREWERY_NARROW_SHARE', 'BREWERY_ORBIT_DAYS', 'BREWERY_ELSEWHERE_MIN_RATED', 'BREWERY_SUGGESTIONS'].map(line),
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
      'selectDiscoverContext', 'occasionPrecheck', 'buildOccasion', 'occasionPlace', 'occasionRationale', 'renderOccasionCard',
      'computeHopprint', 'inGapRegion', 'dimensionGaps', 'gapsGate', 'buildGaps', 'gapRationale', 'renderGapCard',
      'breweryKeyOf', 'familyOf', 'familyAffinity', 'breweryGaps', 'breweryGapsGate', 'buildBreweryGaps', 'breweryRationale',
      'renderBreweryGapCard', 'rediscoveryStyleTag', 'selectCopy', 'discoverRationale', 'nearestContributor'].map(extractFunction),
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
  assert.equal((els.modeGrid.innerHTML.match(/class="mode-reason">Not built yet</g) || []).length, 0);
  assert.match(els.modeGrid.innerHTML, /class="mode-reason">Needs a favorite brewery/);
  assert.match(els.modeGrid.innerHTML, /class="mode-reason">Needs 4 different styles logged</);
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

test('OF5/RD6/RD9: a beer logged under a non-recommendable bin is still recommended, tagged with its family', () => {
  const { ctx } = gridCtx();
  const [c] = ctx.rediscoveryCandidates([ci('Mystery Porter', 400, 90, { beer_type: 'Porter - Other' })]);
  assert.equal(c.style, 'Porter');
  const [d] = ctx.rediscoveryCandidates([ci('Mystery', 400, 90, { beer_type: 'Other' })]);
  assert.equal(d.style, '');
  const [e] = ctx.rediscoveryCandidates([ci('Gose', 400, 90, { beer_type: 'Sour - Other Gose' })]);
  assert.equal(e.style, 'Sour - Other Gose');
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
  assert.match(app.els.recResults.innerHTML, /class="rec-save" id="recSave-0" onclick="saveShownToWishlist\(0\)"/);
  const pill = fakeNode(app.els, 'recSave-0');
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

// ── Dimension Gaps (§4) ────────────────────────────────────────

let gapN = 0;
const g = (beer_type, rating = null, days = 20) => ({ id: `g${++gapN}`, beer_name: `G ${gapN}`, brewery_name: 'B', beer_type, rating, created_at: ago(days) });
const hazyDrinker = (extra = []) => [
  ...times(20, () => g('IPA - New England / Hazy', 85)),
  ...['IPA - American', 'Pale Ale - New England / Hazy', 'Pilsner - German'].map(t => g(t, 80)),
  ...extra,
];
const gapByKey = (ctx, list, key) => ctx.dimensionGaps(list).gaps.find(x => x.key === key);

test('DG4: nine regions — every high end plus low alcohol; no low haze or low carbonation', () => {
  const { get } = gridCtx();
  const keys = [...get('GAP_REGIONS')].map(r => `${r.axis}:${r.end}`);
  assert.equal(keys.length, 9);
  assert.ok(keys.includes('alcohol:low'));
  assert.ok(!keys.includes('haze:low') && !keys.includes('carbonation:low'));
  keys.forEach(k => assert.ok(get('GAP_LABELS')[k], k));
});

test('DG1: under 5% of matched check-ins is a gap; exactly 5% is not', () => {
  const { ctx } = gridCtx();
  const base = hazyDrinker();                                   // 23 matched, no roast
  assert.ok(gapByKey(ctx, base, 'roast:high'));
  const one = [...base.slice(0, 19), g('Stout - American')];   // 1 of 20 = 5%
  assert.equal(gapByKey(ctx, [...one, g('IPA - American'), g('Pilsner - German'), g('Pale Ale - New England / Hazy')].slice(0, 20), 'roast:high'), undefined);
});

test('DG1: coverage counts unrated check-ins too', () => {
  const { ctx } = gridCtx();
  const unrated = [...times(10, () => g('Stout - American')), ...times(10, () => g('IPA - New England / Hazy')), g('Pilsner - German'), g('IPA - American')];
  assert.equal(gapByKey(ctx, unrated, 'roast:high'), undefined);
});

test('DG3: 2 rated Never in a thin region is still a gap; 3 makes it a known dislike', () => {
  const { ctx } = gridCtx();
  const big = [...hazyDrinker(), ...times(60, () => g('IPA - New England / Hazy'))];   // 83 matched
  assert.ok(gapByKey(ctx, [...big, ...times(2, () => g('Stout - American', 10))], 'roast:high'));
  assert.equal(gapByKey(ctx, [...big, ...times(3, () => g('Stout - American', 10))], 'roast:high'), undefined);
});

test('DG3: the dislike average is recency-weighted — a recent love outweighs old Nevers', () => {
  const { ctx } = gridCtx();
  const big = [...hazyDrinker(), ...times(60, () => g('IPA - New England / Hazy'))];
  const oldNevers = times(3, () => g('Stout - American', 5, 1500));
  assert.ok(gapByKey(ctx, [...big, ...oldNevers, g('Stout - American', 95, 5)], 'roast:high'));
});

test('DG2: picks sit in the gap and near the hopprint elsewhere — Baltic Porter, not Russian Imperial Stout', () => {
  const { ctx } = gridCtx();
  const roast = gapByKey(ctx, hazyDrinker(), 'roast:high');
  assert.equal(roast.picks.length, 3);
  roast.picks.forEach(p => assert.ok(STYLE_MATRIX[p.style].roast >= 4, p.style));
  assert.ok(!roast.picks.some(p => p.style === 'Stout - Russian Imperial'));
  const d = [...roast.picks.map(p => p.distance)];
  assert.deepEqual(d, [...d].sort((a, b) => a - b));
});

test('DG2: untried styles come first; a tried one only fills', () => {
  const { ctx } = gridCtx();
  const bitter = gapByKey(ctx, hazyDrinker(), 'bitterness:high');   // IPA - American is tried
  assert.ok(!bitter.picks.some(p => p.style === 'IPA - American'));
  assert.ok(bitter.picks.every(p => !p.tried));
});

test('OF3: centroid styles never appear under a gap', () => {
  const { ctx } = gridCtx();
  ctx.dimensionGaps(hazyDrinker()).gaps.forEach(gap => gap.picks.forEach(p => assert.equal(ctx.isRecommendableStyle(p.style), true, p.style)));
});

test('Order: thinnest first, ties to the smallest step', () => {
  const { ctx } = gridCtx();
  const gaps = ctx.dimensionGaps(hazyDrinker()).gaps;
  for (let i = 1; i < gaps.length; i++) {
    assert.ok(gaps[i - 1].share < gaps[i].share || (gaps[i - 1].share === gaps[i].share && gaps[i - 1].step <= gaps[i].step), `${gaps[i - 1].key} before ${gaps[i].key}`);
  }
  assert.equal(gaps[gaps.length - 1].key, 'bitterness:high');   // the only non-zero share
});

test('Gate: 4 matched styles needed; locked with its own reason when nothing is a gap', () => {
  const { ctx, get } = gridCtx();
  const three = ['IPA - American', 'Pilsner - German', 'Stout - American'].map(t => g(t));
  assert.match(ctx.gapsGate(three).reason, /Needs 4 different styles/);
  assert.equal(ctx.gapsGate(hazyDrinker()).open, true);
  // One check-in per region's first recommendable style: every region holds ≥ 1/9.
  const regions = [...get('GAP_REGIONS')];
  const broad = regions.map(r => g(Object.keys(STYLE_MATRIX).find(st => ctx.isRecommendableStyle(st) && ctx.inGapRegion(r, STYLE_MATRIX[st]))));
  const gate = ctx.gapsGate(broad);
  assert.equal(gate.open, false);
  assert.match(gate.reason, /explored every flavor direction/);
});

test('Gaps card: direction headline, three styles each with its own Save pill, counts not scores', () => {
  const wishlist = [];
  const app = gridCtx(hazyDrinker(), '', { wishlist });
  app.ctx.enterDiscover();
  app.ctx.selectMode('gaps');
  app.ctx.generateRecs();
  const shown = app.get('discoverShownCard');
  const html = app.els.recResults.innerHTML;
  assert.match(html, new RegExp(`rec-name">${shown.label}<`));
  [0, 1, 2].forEach(i => assert.match(html, new RegExp(`id="recSave-${i}" onclick="saveShownToWishlist\\(${i}\\)"`)));
  assert.doesNotMatch(html, /\d\.\d/);
  assert.deepEqual(app.shown(), [[shown.key, 'gaps']]);
  fakeNode(app.els, 'recSave-1');
  app.ctx.saveShownToWishlist(1);
  assert.equal(wishlist[0].name, shown.picks[1].style);
  assert.equal(wishlist[0].brewery, '');
});

test('DG6: the rationale admits it can\'t rule out a dislike until 3 ratings land in the region', () => {
  const { ctx } = gridCtx();
  const big = [...hazyDrinker(), ...times(60, () => g('IPA - New England / Hazy'))];
  const few = gapByKey(ctx, [...big, ...times(2, () => g('Stout - American', 90))], 'roast:high');
  assert.match(ctx.gapRationale(few), /rule out a dislike/);
  assert.match(ctx.gapRationale(few), /^Only 2 of your 85 check-ins land here\. These move roast up/);
  const enough = gapByKey(ctx, [...big, ...times(3, () => g('Stout - American', 90))], 'roast:high');
  assert.doesNotMatch(ctx.gapRationale(enough), /rule out/);
});

test('Gaps suppression: each region rotates on its own key for 7 days', () => {
  const now = Date.now();
  const { ctx } = gridCtx(undefined, '', { store: { hopprint_rec_suppression: JSON.stringify([{ mode: 'gaps', key: 'alcohol:high', timestamp: now }]) } });
  const keys = [...ctx.buildGaps(hazyDrinker()).cards.map(c => c.key)];
  assert.ok(keys.includes('alcohol:low'));
  assert.equal(keys[keys.length - 1], 'alcohol:high');   // recently shown: back of the batch, not first
});

// ── Brewery Gaps (§6) ──────────────────────────────────────────

const APPROVED_FAMILIES = ['Hazy IPA', 'Clear IPA', 'Imperial IPA', 'Specialty IPA', 'Stout', 'Imperial Stout', 'Porter', 'Imperial Porter',
  'Pale Lager', 'Amber & Dark Lager', 'Gose & Berliner', 'Fruited Sour', 'Flanders & Other Sour', 'Belgian Ale', 'Blonde / Golden Ale',
  'Scottish Ale', 'Fruit & Spice', 'Wild Ale', 'Farmhouse Ale', 'Historical Beer', 'Rye Beer', 'Smoked Beer', 'Shandy / Radler',
  'Altbier', 'Barleywine', 'Bitter', 'Bock', 'Brown Ale', 'Cider', 'Mead', 'Mild', 'Non-Alcoholic', 'Pale Ale', 'Pilsner', 'Red Ale',
  'Strong Ale', 'Wheat Beer'];

test('Families: every STYLE_MATRIX key is mapped, to an approved family or null', () => {
  const { get } = gridCtx();
  const fam = get('STYLE_FAMILY');
  assert.deepEqual(Object.keys(STYLE_MATRIX).filter(k => !(k in fam)), [], 'unmapped');
  assert.deepEqual(Object.keys(fam).filter(k => !STYLE_MATRIX[k]), [], 'not a matrix key');
  assert.deepEqual([...new Set(Object.values(fam).filter(Boolean))].filter(f => !APPROVED_FAMILIES.includes(f)), []);
  assert.deepEqual(Object.keys(fam).filter(k => fam[k] === null).sort(),
    ['Dark Ale', 'Hard Ginger Beer', 'Historical Beer - Other', 'Other', 'Root Beer', 'Traditional Ale']);
});

test('Families: the approved edge cases', () => {
  const fam = gridCtx().get('STYLE_FAMILY');
  const expect = {
    'IPA - Milkshake': 'Hazy IPA', 'IPA - Fruited': 'Hazy IPA', 'IPA - Session': 'Clear IPA', 'IPA - English': 'Clear IPA',
    'IPA - Imperial / Double New England / Hazy': 'Imperial IPA', 'IPA - Black / Cascadian Dark Ale': 'Specialty IPA',
    'Stout - Other': 'Stout', 'Stout - Imperial / Double Pastry': 'Imperial Stout', 'Porter - Baltic': 'Imperial Porter', 'Porter - Other': 'Porter',
    'Lager - Other': 'Pale Lager', 'Festbier': 'Pale Lager', 'California Common': 'Pale Lager', 'Historical Beer - Pre-Prohibition Lager': 'Pale Lager',
    'Märzen': 'Amber & Dark Lager', 'Schwarzbier': 'Amber & Dark Lager', 'Sour - Other Gose': 'Gose & Berliner', 'Sour - Fruited': 'Fruited Sour',
    'Sour - Other': 'Flanders & Other Sour', 'Kölsch': 'Blonde / Golden Ale', 'Brett Beer': 'Wild Ale', 'Table Beer': 'Farmhouse Ale',
    'Winter Warmer': 'Fruit & Spice', 'Pilsner - German': 'Pilsner', 'Wheat Beer - Other': 'Wheat Beer',
  };
  Object.entries(expect).forEach(([k, f]) => assert.equal(fam[k], f, k));
});

let brN = 0;
const br = (brewery_name, beer_type, rating = 90, days = 30) => ({ id: `br${++brN}`, beer_name: `Beer ${brN}`, brewery_name, beer_type, rating, created_at: ago(days) });
const loyal = (n = 6, extra = {}) => times(n, () => br('Trillium', 'IPA - New England / Hazy', extra.rating ?? 90, extra.days ?? 30));
const lovedElsewhere = (family = 'Stout - Imperial / Double', n = 3, rating = 90) => times(n, (_, i) => br(`Elsewhere ${i}`, family, rating));
const names2 = list => [...list].map(b => b.brewery);

test('BG2: needs 5 check-ins, 5 rated, and a Definitely majority', () => {
  const { ctx } = gridCtx();
  const else3 = lovedElsewhere();
  assert.deepEqual(names2(ctx.breweryGaps([...loyal(5), ...else3])), ['Trillium']);
  assert.deepEqual(names2(ctx.breweryGaps([...loyal(4), ...else3])), []);
  assert.deepEqual(names2(ctx.breweryGaps([...loyal(4), br('Trillium', 'IPA - New England / Hazy', null), ...else3])), [], '4 rated');
  const split = [...times(3, () => br('Trillium', 'IPA - New England / Hazy', 50)), ...times(2, () => br('Trillium', 'IPA - New England / Hazy', 90))];
  assert.deepEqual(names2(ctx.breweryGaps([...split, ...else3])), [], '2 of 5 Definitely');
  const unrated = times(8, () => br('Trillium', 'IPA - New England / Hazy', null));
  assert.deepEqual(names2(ctx.breweryGaps([...unrated, ...else3])), [], 'no ratings, no affection');
});

test('BG3: 70% in one family fires; 60% does not; no-family check-ins count toward depth only', () => {
  const { ctx } = gridCtx();
  const else3 = lovedElsewhere();
  const mix = (hazy, other) => [...times(hazy, () => br('Trillium', 'IPA - New England / Hazy')), ...times(other, () => br('Trillium', 'Pale Ale - American'))];
  assert.deepEqual(names2(ctx.breweryGaps([...mix(7, 3), ...else3])), ['Trillium']);
  assert.deepEqual(names2(ctx.breweryGaps([...mix(6, 4), ...else3])), []);
  const withRootBeer = [...times(4, () => br('Trillium', 'IPA - New England / Hazy')), br('Trillium', 'Root Beer')];
  const [b] = ctx.breweryGaps([...withRootBeer, ...else3]);
  assert.equal(b.checkins, 5);
  assert.equal(b.famTotal, 4);
});

test('BG4: suggests families rated Definitely elsewhere (3+ rated), never one already had here, best first, at most 2', () => {
  const { ctx } = gridCtx();
  const list = [
    ...loyal(6), br('Trillium', 'Stout - Imperial / Double', 90),                   // Imperial Stout already had here
    ...lovedElsewhere('Stout - Imperial / Double', 4, 95),
    ...lovedElsewhere('Pilsner - German', 3, 80), ...lovedElsewhere('Porter - Baltic', 3, 90),
    ...lovedElsewhere('Farmhouse Ale - Saison', 2, 99),                           // only 2 rated elsewhere
    ...lovedElsewhere('Lager - Helles', 3, 50),                                   // not Definitely
  ];
  const [b] = ctx.breweryGaps(list);
  assert.deepEqual([...b.suggestions.map(x => x.family)], ['Imperial Porter', 'Pilsner']);
});

test('BG4: no qualifying suggestion means no card for that brewery', () => {
  const { ctx } = gridCtx();
  assert.deepEqual(names2(ctx.breweryGaps(loyal(8))), []);
});

test('BG5: still in orbit within 12 months; out of orbit past it', () => {
  const { ctx } = gridCtx();
  assert.deepEqual(names2(ctx.breweryGaps([...loyal(6, { days: 300 }), ...lovedElsewhere()])), ['Trillium']);
  assert.deepEqual(names2(ctx.breweryGaps([...loyal(6, { days: 400 }), ...lovedElsewhere()])), []);
});

test('Brewery names match across case and spacing; deepest relationship first', () => {
  const { ctx } = gridCtx();
  const drift = [...times(3, () => br('Trillium', 'IPA - New England / Hazy')), ...times(3, () => br('  trillium ', 'IPA - New England / Hazy'))];
  const deeper = times(9, () => br('Other Half', 'IPA - Imperial / Double New England / Hazy'));
  assert.deepEqual(names2(ctx.breweryGaps([...drift, ...deeper, ...lovedElsewhere()])), ['Other Half', 'Trillium']);
});

test('Gate: locked with a reason until a brewery qualifies', () => {
  const { ctx } = gridCtx();
  assert.equal(ctx.breweryGapsGate(loyal(4)).open, false);
  assert.match(ctx.breweryGapsGate(loyal(4)).reason, /favorite brewery/);
  assert.equal(ctx.breweryGapsGate([...loyal(6), ...lovedElsewhere()]).open, true);
});

test('BG1 card: brewery headline, families with Save pills, never a specific beer, counts not scores', () => {
  const wishlist = [];
  const list = [...loyal(6), ...lovedElsewhere(), ...lovedElsewhere('Pilsner - German', 3, 85)];
  const app = gridCtx(list, '', { wishlist });
  app.ctx.enterDiscover();
  app.ctx.selectMode('brewery');
  app.ctx.generateRecs();
  const html = app.els.recResults.innerHTML;
  assert.match(html, /rec-name">Trillium</);
  assert.match(html, /Mostly Hazy IPA so far/);
  assert.match(html, /gap-style-name">Imperial Stout<.*recSave-0/s);
  assert.match(html, /gap-style-name">Pilsner<.*recSave-1/s);
  assert.match(html, /6 of your 6 check-ins here are Hazy IPA\./);
  assert.doesNotMatch(html, /Beer \d+/, 'no beer names');
  assert.doesNotMatch(html, /\d\.\d/);
  assert.deepEqual(app.shown(), [['trillium', 'brewery']]);
  fakeNode(app.els, 'recSave-0');
  app.ctx.saveShownToWishlist(0);
  assert.deepEqual({ name: wishlist[0].name, brewery: wishlist[0].brewery }, { name: 'Imperial Stout', brewery: 'Trillium' });
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

// ── §9 battery: cross-mode guards ──────────────────────────────

test('D1: no copy candidate in any Discover registry leaks a raw 0–100 rating', () => {
  // Every rating is 77 — a value no count, label or date in these fixtures produces.
  const r = 77;
  const list = [
    ...times(6, () => br('Trillium', 'IPA - New England / Hazy', r)), ...lovedElsewhere('Stout - Imperial / Double', 3, r),
    ...times(6, () => out('Pilsner - German', r)), ...times(6, () => home('Porter - English', r)),
    ...times(3, () => oc('Pilsner - German', r, { occasion: 'bar-taproom' })),
    ci('Old Love', 500, r), ci('Old Import', 600, r, { source: 'import', rating_mode: 'import' }),
  ];
  const { ctx, get } = gridCtx(list);
  const cards = {
    REDISCOVERY_COPY: ctx.rediscoveryCandidates(list),
    GAP_COPY: ctx.dimensionGaps(list).gaps,
    BREWERY_COPY: ctx.breweryGaps(list),
  };
  vm.runInContext("discoverContext = 'out'", ctx);
  const occ = ctx.buildOccasion(list).cards.map(c => ({ ...c, place: ctx.occasionPlace(c.context, c.label), cites: ['Lager - Helles'], derived: c.rated - c.stated }));
  cards.OCCASION_COPY = [...occ, ...occ.map(c => ({ ...c, fallback: true, result: { ...c.result, source: 'direct' } }))];
  let rendered = 0;
  Object.entries(cards).forEach(([reg, cs]) => {
    assert.ok(cs.length > 0, `${reg} has fixtures`);
    cs.forEach(c => get(reg).forEach(k => {
      if (!k.condition(c)) return;
      const html = k.render(c);
      rendered++;
      assert.doesNotMatch(html, /\b77\b/, `${reg}.${k.id}`);
    }));
  });
  assert.ok(rendered > 20);
});

test('D1: every registry candidate has the engine shape — id, zone in its zone list, priority, condition, render', () => {
  const { get } = gridCtx();
  [['REDISCOVERY_COPY', 'REDISCOVERY_ZONES'], ['GAP_COPY', 'GAP_ZONES'], ['BREWERY_COPY', 'BREWERY_ZONES'], ['OCCASION_COPY', 'OCCASION_ZONES']].forEach(([reg, zones]) => {
    const ids = new Set();
    get(reg).forEach(k => {
      assert.ok(k.id && !ids.has(k.id), `${reg}: unique id ${k.id}`);
      ids.add(k.id);
      assert.ok(get(zones).includes(k.zone), `${reg}.${k.id} zone`);
      assert.equal(typeof k.priority, 'number');
      assert.equal(typeof k.condition, 'function');
      assert.equal(typeof k.render, 'function');
    });
  });
});

test('OF1: non-recommendable styles still count — coverage, the hopprint, and Occasion affinity', () => {
  const { ctx } = gridCtx();
  // Coverage: 'Stout - Other' check-ins fill the roast region, even though it never renders.
  const base = [...times(10, () => g('IPA - New England / Hazy')), g('Pilsner - German'), g('IPA - American'), g('Pale Ale - New England / Hazy')];
  assert.ok(gapByKey(ctx, base, 'roast:high'));
  assert.equal(gapByKey(ctx, [...base, ...times(4, () => g('Stout - Other'))], 'roast:high'), undefined);
  // Hopprint: an 'Other' bin moves the vector.
  assert.notDeepEqual([...ctx.computeHopprint(base).vector], [...ctx.computeHopprint([...base, ...times(4, () => g('Stout - Other'))]).vector]);
  // Occasion: a 'Porter - Other' rating feeds every transferred prediction out.
  const list = times(6, () => out('Porter - Other', 95));
  const cards = occasionApp(list, 'out').ctx.buildOccasion(list).cards;
  assert.equal(cards.length, 5);
  cards.forEach(c => assert.ok(c.result.contributors.some(x => x.style === 'Porter - Other'), c.style));
});

test('Occasion ties on thin data go to the nearest neighbour, not matrix order', () => {
  const list = times(6, () => out('Porter - Other', 95));
  const cards = occasionApp(list, 'out').ctx.buildOccasion(list).cards;
  const d = [...cards.map(c => Math.min(...c.result.contributors.map(x => x.distance)))];
  assert.deepEqual(d, [...d].sort((a, b) => a - b));
});

test('Rediscovery is unaffected by the non-recommendable filter, end to end', () => {
  const { els } = showOne([ci('House Mystery', 400, 90, { beer_type: 'Other' })]);
  assert.match(els.recResults.innerHTML, /rec-name">House Mystery</);
  assert.doesNotMatch(els.recResults.innerHTML, /etag style/);
});

// ── Scorer weights (proximity_engine.js) ───────────────────────

test('§5/§8: MODE_WEIGHTS holds only the Occasion posture (0.75 / 0.25)', () => {
  const ctx = vm.createContext({});
  vm.runInContext(ENGINE_SRC.match(/^const MODE_WEIGHTS = \{[\s\S]*?^\};/m)[0] + ';this.W = MODE_WEIGHTS;', ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.W)), { occasion: { affinity: 0.75, novelty: 0.25 } });
});
