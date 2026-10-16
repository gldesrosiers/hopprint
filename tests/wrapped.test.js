#!/usr/bin/env node
// Wrapped (PHASE_DPLUS_E_WORKPLAN.md Phase E session a). Run:
//   node --test tests/wrapped.test.js
//
// Real-source-pulled: every function and const under test is extracted
// verbatim from index.html; STYLE_MATRIX comes from style_matrix.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');

const { extractFunction, extractConst } = require('./helpers');
const STYLE_MATRIX = require('../style_matrix.js');

const DAY = 86400000;

// A sandbox whose clock can be moved: Date.now() reads ctx.clock.
function sandbox() {
  const clock = { t: Date.UTC(2026, 9, 16) };
  class ClockDate extends Date {
    constructor(...a) { a.length ? super(...a) : super(clock.t); }
    static now() { return clock.t; }
  }
  const ctx = vm.createContext({ console, Math, JSON, Date: ClockDate, STYLE_MATRIX });
  vm.runInContext([
    ...['MS_CHECKIN_STEPS', 'MS_BREWERY_STEPS', 'MS_STYLE_STEPS', 'HOPPRINT_DIMS', 'WRAPPED_MIN'].map(extractConst),
    'let STYLE_KEY_INDEX = null;',
    ...['normalizeStyleKey', 'resolveMatrixStyle', 'computeHopprint', 'computeMilestones',
      'milestonesCrossedIn', 'wrappedYears'].map(extractFunction),
    'var entries = [];',
  ].join('\n'), ctx);
  ctx.clock = clock;
  return ctx;
}

const STYLES = Object.keys(STYLE_MATRIX).slice(0, 6);
const at = (y, m, d, h = 12, min = 0) => new Date(y, m, d, h, min).toISOString();

// Rated entries across several styles and months of one year.
function yearOf(year, n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `${year}-${i}`, beer_name: 'B' + i, brewery_name: 'Br' + (i % 7),
    beer_type: STYLES[i % STYLES.length], rating: (i * 37) % 101,
    created_at: at(year, i % 12, 1 + (i % 27)),
  }));
}

test('WR1: a fixed year\'s shape does not drift as the clock moves (recency decay cancels out)', () => {
  // Every weight is 0.5^(age/180); moving the clock scales them all by the same
  // factor, which divides out of each style's weighted average. Only float
  // noise remains, so a past year's Wrapped radar stays put.
  const ctx = sandbox();
  const es = yearOf(2025, 40);
  const before = ctx.computeHopprint(es).vector;
  for (const days of [1, 400, 3650]) {
    ctx.clock.t += days * DAY;
    const after = ctx.computeHopprint(es).vector;
    after.forEach((v, i) => assert.ok(Math.abs(v - before[i]) < 1e-12, `dim ${i} moved by ${v - before[i]}`));
  }
});

test('WR2: milestonesCrossedIn keeps only that year, ranked check-ins > breweries > styles, then newest', () => {
  const ctx = sandbox();
  // 100th check-in lands on 2025-03-01; brewery #25 and style #25 land later in
  // 2025. Everything before is in 2024.
  const es = [];
  for (let i = 0; i < 99; i++) es.push({ id: 'a' + i, beer_name: 'x', brewery_name: 'Old' + (i % 20), beer_type: 'S' + (i % 20), created_at: at(2024, i % 12, 1) });
  es.push({ id: 'c100', beer_name: 'Hundredth', brewery_name: 'Old0', beer_type: 'S0', created_at: at(2025, 2, 1) });
  for (let i = 0; i < 5; i++) es.push({ id: 'b' + i, beer_name: 'x', brewery_name: 'New' + i, beer_type: 'S0', created_at: at(2025, 4, 1 + i) });
  for (let i = 0; i < 5; i++) es.push({ id: 's' + i, beer_name: 'x', brewery_name: 'Old0', beer_type: 'T' + i, created_at: at(2025, 8, 1 + i) });
  ctx.entries = es;
  const got = ctx.milestonesCrossedIn(2025);
  assert.equal(JSON.stringify(got.map(m => m.kind)), JSON.stringify(['checkins', 'breweries', 'styles']));
  assert.ok(got.every(m => new Date(m.date).getFullYear() === 2025));
  assert.equal(ctx.milestonesCrossedIn(2024).length, 0);
  assert.equal(ctx.milestonesCrossedIn(2023).length, 0);
});

test('WR3: milestonesCrossedIn splits at local midnight on Dec 31 / Jan 1', () => {
  const ctx = sandbox();
  const base = Array.from({ length: 99 }, (_, i) => ({ id: 'a' + i, beer_name: 'x', brewery_name: 'B', beer_type: 'S', created_at: at(2024, 5, 1) }));
  ctx.entries = [...base, { id: 'late', beer_name: 'x', brewery_name: 'B', beer_type: 'S', created_at: at(2024, 11, 31, 23, 59) }];
  assert.equal(ctx.milestonesCrossedIn(2024).length, 1);
  assert.equal(ctx.milestonesCrossedIn(2025).length, 0);
  ctx.entries = [...base, { id: 'early', beer_name: 'x', brewery_name: 'B', beer_type: 'S', created_at: at(2025, 0, 1, 0, 1) }];
  assert.equal(ctx.milestonesCrossedIn(2024).length, 0);
  assert.equal(ctx.milestonesCrossedIn(2025).length, 1);
});

test('WR4: wrappedYears lists completed years with ≥20 check-ins, newest first', () => {
  const ctx = sandbox(); // clock: Oct 2026
  assert.equal(vm.runInContext('WRAPPED_MIN', ctx), 20);
  ctx.entries = [
    ...yearOf(2026, 50),           // current year: never listed
    ...yearOf(2025, 20),           // exactly at the gate
    ...yearOf(2024, 19),           // one short: hidden
    ...yearOf(2022, 300),
    { id: 'bad', created_at: 'not a date' },
    { id: 'none' },
  ];
  assert.equal(JSON.stringify(ctx.wrappedYears()), JSON.stringify([{ year: 2025, count: 20 }, { year: 2022, count: 300 }]));
});

test('WR5: wrappedYears is empty when no completed year qualifies', () => {
  const ctx = sandbox();
  ctx.entries = [...yearOf(2026, 200), ...yearOf(2025, 19)];
  assert.equal(ctx.wrappedYears().length, 0);
  ctx.entries = [];
  assert.equal(ctx.wrappedYears().length, 0);
});

test('WR6: wrappedYears rolls over with the clock — the old current year becomes completed', () => {
  const ctx = sandbox();
  ctx.entries = yearOf(2026, 25);
  assert.equal(ctx.wrappedYears().length, 0);
  ctx.clock.t = new Date(2027, 0, 1, 0, 5).getTime();
  assert.equal(JSON.stringify(ctx.wrappedYears()), JSON.stringify([{ year: 2026, count: 25 }]));
});
