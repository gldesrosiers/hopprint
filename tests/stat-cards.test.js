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
