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

function gridCtx(entries = [{ id: 1 }], extraModes = '') {
  const els = { modeGrid: el(), discoverLocked: el(), discoverGo: el(), recResults: el() };
  const toasts = [];
  const shown = [];
  const ctx = vm.createContext({
    entries,
    document: { getElementById: id => els[id] || null, querySelectorAll: () => [] },
    icon: () => '', renderWishlist() {}, showToast: m => toasts.push(m),
    recordShown: (keys, mode) => shown.push([...keys, mode]),
  });
  vm.runInContext([
    line('discoverMode'), line('discoverQueue'), line('discoverQueueMode'), line('discoverStarved'), line('discoverShownKey'),
    line('DISC_NOT_BUILT'), extractBlock('DISC_MODES'), extraModes,
    ...['esc', 'discModeById', 'discGates', 'buildModeGrid', 'selectMode', 'enterDiscover', 'generateRecs', 'renderNextRec'].map(extractFunction),
  ].join('\n'), ctx);
  return { ctx, els, toasts, shown, get: n => vm.runInContext(n, ctx) };
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
  assert.equal((els.modeGrid.innerHTML.match(/class="mode-reason">Not built yet</g) || []).length, 4);
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
  assert.deepEqual(shown, [[`It's "Quoted"`, 'rediscovery']]);
  assert.equal(get('discoverShownKey'), `It's "Quoted"`);
  ctx.renderNextRec();
  assert.equal(get('discoverShownKey'), 'Second');
});

// ── Scorer weights (proximity_engine.js) ───────────────────────

test('§5/§8: MODE_WEIGHTS holds only the Occasion posture (0.75 / 0.25)', () => {
  const ctx = vm.createContext({});
  vm.runInContext(ENGINE_SRC.match(/^const MODE_WEIGHTS = \{[\s\S]*?^\};/m)[0] + ';this.W = MODE_WEIGHTS;', ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.W)), { occasion: { affinity: 0.75, novelty: 0.25 } });
});
