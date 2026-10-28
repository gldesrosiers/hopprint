#!/usr/bin/env node
// Stats hero card subheads (STAT_CARDS_WORKPLAN.md SC1–SC32). Run:
//   node --test tests/stat-cards.test.js
//
// Real-source-pulled: the helpers are extracted verbatim from index.html.

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');

const { extractFunction } = require('./helpers');

function load(entries = []) {
  const ctx = vm.createContext({});
  vm.runInContext([
    ...['breweryKeyOf', 'beerKeyOf', 'validAbv', 'firstOccurrenceIds'].map(extractFunction),
    'var entries = [];',
  ].join('\n'), ctx);
  ctx.entries = entries;
  vm.runInContext('entries = this.entries;', ctx);
  return ctx;
}

const ci = (id, beer_name, brewery_name, created_at, over = {}) => ({ id, beer_name, brewery_name, created_at, ...over });

// ── SC12 / SC21 / SC22 validAbv ─────────────────────────────────
test('SC22: validAbv keeps 0–20 inclusive, drops typos, blanks and junk', () => {
  const { validAbv } = load();
  assert.equal(validAbv('6.5'), 6.5);
  assert.equal(validAbv(6.5), 6.5);
  assert.equal(validAbv('0'), 0);            // non-alcoholic counts
  assert.equal(validAbv(0), 0);
  assert.equal(validAbv('0.0'), 0);
  assert.equal(validAbv('18'), 18);
  assert.equal(validAbv('20'), 20);          // the cutoff itself is valid
  assert.equal(validAbv('20.1'), null);
  assert.equal(validAbv('65'), null);
  assert.equal(validAbv('-1'), null);
  for (const v of ['', null, undefined, 'N/A']) assert.equal(validAbv(v), null, String(v));
});

test('SC21: every ABV summary reads through validAbv, none parse beer_abv directly', () => {
  for (const fn of ['renderAnalytics', 'computeProfileContext', 'renderProfile']) {
    const src = extractFunction(fn);
    assert.match(src, /validAbv\(e\.beer_abv\)/, fn);
    assert.doesNotMatch(src, /parseFloat\(e\.beer_abv\)/, fn);
    assert.doesNotMatch(src, /filter\(\s*e\s*=>\s*e\.beer_abv\s*\)/, `${fn} still drops 0% by truthiness`);
  }
});

// ── SC9 beerKeyOf ───────────────────────────────────────────────
test('SC9: same-named beers from different breweries are different beers', () => {
  const { beerKeyOf } = load();
  assert.notEqual(beerKeyOf(ci(1, 'IPA', 'Brewery A')), beerKeyOf(ci(2, 'IPA', 'Brewery B')));
});

test('SC9: case and whitespace differences are the same beer', () => {
  const { beerKeyOf } = load();
  assert.equal(beerKeyOf(ci(1, 'Keeper', 'Hill  Farmstead')), beerKeyOf(ci(2, ' keeper ', 'hill farmstead ')));
});

test('SC9: beer_id wins when present; no beer name means no key', () => {
  const { beerKeyOf } = load();
  assert.equal(beerKeyOf(ci(1, 'Keeper', 'Hill Farmstead', null, { beer_id: 'b-42' })), 'b-42');
  assert.equal(beerKeyOf(ci(1, 'Other name', 'X', null, { beer_id: 'b-42' })), 'b-42');
  assert.equal(beerKeyOf(ci(1, '', 'Hill Farmstead')), '');
  assert.equal(beerKeyOf(ci(1, '   ', 'Hill Farmstead')), '');
  assert.notEqual(beerKeyOf(ci(1, 'Keeper', '')), '');            // brewery missing still countable
});

// ── SC10 firstOccurrenceIds key-function path ──────────────────
test('SC10: firstOccurrenceIds with beerKeyOf judges first-ever across full history', () => {
  const ctx = load([
    ci('c', 'keeper ', 'Hill Farmstead', '2025-03-01T12:00:00Z'),   // repeat of a
    ci('a', 'Keeper', 'Hill Farmstead', '2024-01-01T12:00:00Z'),
    ci('b', 'IPA', 'Brewery A', '2024-02-01T12:00:00Z'),
    ci('d', 'IPA', 'Brewery B', '2024-03-01T12:00:00Z'),            // different beer from b
    ci('e', '', 'Brewery B', '2024-04-01T12:00:00Z'),               // no name: skipped
  ]);
  assert.deepEqual([...ctx.firstOccurrenceIds(ctx.beerKeyOf)].sort(), ['a', 'b', 'd']);
});

test('SC10: the field-name path is unchanged (raw value, falsy skipped)', () => {
  const ctx = load([
    ci('a', 'IPA', 'Brewery A', '2024-01-01T12:00:00Z'),
    ci('b', 'IPA', 'Brewery B', '2024-02-01T12:00:00Z'),
    ci('c', 'ipa ', 'Brewery C', '2024-03-01T12:00:00Z'),
    ci('d', '', 'Brewery D', '2024-04-01T12:00:00Z'),
  ]);
  assert.deepEqual([...ctx.firstOccurrenceIds('beer_name')].sort(), ['a', 'c']);
});

test('SC10: New vs Repeat Beers view uses beerKeyOf; Breweries and Styles keep their field', () => {
  assert.match(extractFunction('renderAnalytics'),
    /firstOccurrenceIds\(nvrField === 'beer_name' \? beerKeyOf : nvrField\)/);
});

// ── SC23 distinctCount ──────────────────────────────────────────
test('SC23: brewery and style counts are normalized', () => {
  const ctx = vm.createContext({});
  vm.runInContext(['breweryKeyOf', 'distinctCount'].map(extractFunction).join('\n'), ctx);
  const list = [{ brewery_name: 'SweetWater', beer_type: 'IPA' }, { brewery_name: 'sweetwater ', beer_type: 'ipa' },
    { brewery_name: 'Allagash', beer_type: '' }, { brewery_name: '' }];
  assert.equal(ctx.distinctCount(list, 'brewery_name'), 2);
  assert.equal(ctx.distinctCount(list, 'beer_type'), 1);
});

// ── SC14–SC17, SC31, SC32 comparisonWindow ─────────────────────
function windowCtx(created) {
  const ctx = vm.createContext({ Date });
  vm.runInContext(extractFunction('comparisonWindow') + '\nvar entries = [];', ctx);
  ctx.entries = created.map((c, i) => ({ id: 'w' + i, created_at: c }));
  vm.runInContext('entries = this.entries;', ctx);
  return ctx;
}
const ids = w => w.entries.map(e => e.id).sort();

test('SC14/SC32: current year compares Jan 1 → end of the same month/day last year, local time', () => {
  const ctx = windowCtx([
    '2024-12-31T23:59:00',   // w0 year before: out
    '2025-01-01T00:00:00',   // w1 in
    '2025-10-27T23:59:00',   // w2 same date, late evening: in
    '2025-10-28T00:00:00',   // w3 next day: out
    '2025-12-15T12:00:00',   // w4 out
    '2026-03-01T12:00:00',   // w5 current year: never in the prior window
  ]);
  const w = ctx.comparisonWindow(2026, new Date(2026, 9, 27, 9, 0));
  assert.equal(w.prevYear, 2025);
  assert.equal(w.toDate, true);
  assert.equal(w.label, 'vs 2025 to date');
  assert.deepEqual(ids(w), ['w1', 'w2']);
});

test('SC14: a past year compares full year vs full year', () => {
  const ctx = windowCtx(['2024-01-01T00:00:00', '2024-12-31T23:59:00', '2025-01-01T00:00:00', '2023-12-31T23:00:00']);
  const w = ctx.comparisonWindow(2025, new Date(2026, 9, 27));
  assert.equal(w.toDate, false);
  assert.equal(w.label, 'vs 2024');
  assert.deepEqual(ids(w), ['w0', 'w1']);
});

test('SC32: Feb 29 compares through Feb 28 of the prior year', () => {
  const ctx = windowCtx(['2027-02-28T22:00:00', '2027-03-01T00:00:00']);
  assert.deepEqual(ids(ctx.comparisonWindow(2028, new Date(2028, 1, 29, 12))), ['w0']);
});

test('SC17/SC31: prior year with nothing before today gives an empty window; All Time gives none', () => {
  const ctx = windowCtx(['2025-11-15T12:00:00']);
  assert.deepEqual(ctx.comparisonWindow(2026, new Date(2026, 0, 3)).entries, []);
  assert.equal(ctx.comparisonWindow('all'), null);
});

test('SC15/SC16: stat deltas and insights read the window; the Monthly chart keeps the full prior year', () => {
  const src = extractFunction('renderAnalytics');
  assert.match(src, /const cmp = comparisonWindow\(analyticsYear\)/);
  assert.match(src, /deltaLine\(es\.length, cmpEntries\.length\)/);
  assert.match(src, /distinctCount\(cmpEntries, 'brewery_name'\)/);
  assert.match(src, /buildAnalyticsInsightCard\(es, cmpEntries, /);
  assert.match(src, /prevYrEntries\.forEach\(e => prevMonthCounts/);
  assert.match(src, /const canCompare = prevYrEntries\.length > 0/);
});

// ── SC24 insights volume-drop is fair for the current year ──────
test('SC24: the quieter-year insight is live for the current year, with to-date wording', () => {
  const { script } = require('./helpers');
  const ctx = vm.createContext({});
  vm.runInContext(script.match(/^const ANALYTICS_COPY = \[[\s\S]*?\n\];/m)[0].replace('const ANALYTICS_COPY', 'var ANALYTICS_COPY'), ctx);
  const down = ctx.ANALYTICS_COPY.find(c => c.id === 'cmp_volume_down');
  const c = { compareOn: true, isCurrentYear: true, deltaVolumePct: -30, prevYear: 2025 };
  assert.equal(down.condition(c), true);
  assert.match(down.render(c), /so far/);
  assert.match(down.render(c), /at this point last year/);
  assert.match(down.render({ ...c, isCurrentYear: false }), /than 2025$/);
  for (const id of ['cmp_range_up', 'cmp_volume_up']) {
    const up = ctx.ANALYTICS_COPY.find(x => x.id === id);
    assert.doesNotMatch(up.render({ ...c, deltaBreweriesPct: 30, deltaVolumePct: 30 }), /all of/, id);
  }
});

test('SC23: the Year-over-Year table counts normalized breweries and styles', () => {
  const src = extractFunction('renderAnalytics');
  assert.match(src, /byYear\[y\]\.styles\.add\(breweryKeyOf\(e\.beer_type\)\)/);
  assert.match(src, /byYear\[y\]\.breweries\.add\(breweryKeyOf\(e\.brewery_name\)\)/);
});
