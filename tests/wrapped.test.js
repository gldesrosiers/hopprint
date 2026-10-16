#!/usr/bin/env node
// Wrapped (PHASE_DPLUS_E_WORKPLAN.md Phase E session a). Run:
//   node --test tests/wrapped.test.js
//
// Real-source-pulled: every function and const under test is extracted
// verbatim from index.html; STYLE_MATRIX comes from style_matrix.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');

const { script, extractFunction } = require('./helpers');
const STYLE_MATRIX = require('../style_matrix.js');

// A top-level const, single- or multi-line, with an optional trailing comment.
function constFrom(name) {
  const m = script.match(new RegExp(`^const ${name} = [\\s\\S]*?;(?: *//[^\\n]*)?\\n`, 'm'));
  if (!m) throw new Error(`const ${name} not found`);
  return m[0];
}

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
    ...['MS_CHECKIN_STEPS', 'MS_BREWERY_STEPS', 'MS_STYLE_STEPS', 'HOPPRINT_DIMS', 'WRAPPED_MIN',
      'RATING_BANDS', 'HOME_VENUE'].map(constFrom),
    'let STYLE_KEY_INDEX = null;',
    ...['normalizeStyleKey', 'resolveMatrixStyle', 'computeHopprint', 'computeMilestones',
      'milestonesCrossedIn', 'wrappedYears', 'firstOccurrenceIds', 'computeBandAnalytics', 'bandOf',
      'isHomeEntry', 'wrappedTop', 'computeWrappedContext', 'esc', 'selectCopy',
      'buildWrappedCopy', 'wrappedSentences'].map(extractFunction),
    ...['WRAPPED_ZONE_ORDER', 'WRAPPED_MAX_EARNED', 'WRAPPED_COPY'].map(constFrom),
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

// ── Task 2: computeWrappedContext ───────────────────────────────

const J = v => JSON.stringify(v);
let seq = 0;
const ck = (year, o = {}) => ({ id: 'w' + (seq++), beer_name: 'Beer', brewery_name: 'Br', beer_type: STYLES[0],
  venue_name: 'Pub', source: 'live', rating: 80, created_at: at(year, o.month ?? 5, o.day ?? 10), ...o });

// Load the year into the sandbox's full history (first-time and milestone
// logic read it) and build the context.
function wctx(ctx, yearEs, prevEs = [], older = []) {
  ctx.entries = [...older, ...prevEs, ...yearEs];
  return ctx.computeWrappedContext(yearEs, prevEs, 2025);
}

test('WR7: stat block counts the year and judges new breweries/styles against full history', () => {
  const ctx = sandbox();
  const older = [ck(2023, { brewery_name: 'Known', beer_type: STYLES[0] })];
  const year = [
    ck(2025, { brewery_name: 'Known', beer_type: STYLES[0], comment: 'nice' }),
    ck(2025, { brewery_name: 'Fresh', beer_type: STYLES[1], month: 6 }),
    ck(2025, { brewery_name: 'Fresh', beer_type: STYLES[1], month: 6, comment: '' }),
    ck(2025, { brewery_name: 'Newer', beer_type: STYLES[2], month: 7, comment: 'ok' }),
  ];
  const c = wctx(ctx, year, [], older);
  assert.equal(c.year, 2025); assert.equal(c.prevYear, 2024);
  assert.equal(c.total, 4); assert.equal(c.prevTotal, 0);
  assert.equal(c.breweries, 3); assert.equal(c.styles, 3); assert.equal(c.notes, 2);
  assert.equal(c.newBreweryCount, 2); assert.equal(c.newStyleCount, 2);
  assert.equal(c.newBreweryPct, 50);
  assert.equal(c.busiestMonthName, 'July'); assert.equal(c.busiestMonthCount, 2);
  assert.equal(c.activeMonths, 3);
});

test('WR8: busiest month needs at least 2 check-ins', () => {
  const ctx = sandbox();
  const c = wctx(ctx, [0, 1, 2].map(m => ck(2025, { month: m })));
  assert.equal(c.busiestMonthName, '');
});

test('WR9: superlatives need 2+ check-ins and break ties A–Z', () => {
  const ctx = sandbox();
  const c = wctx(ctx, [
    ck(2025, { brewery_name: 'Zed' }), ck(2025, { brewery_name: 'Zed' }),
    ck(2025, { brewery_name: 'Alpha' }), ck(2025, { brewery_name: 'Alpha' }),
    ck(2025, { brewery_name: 'Solo', beer_type: STYLES[1] }),
  ]);
  assert.equal(J(c.topBrewery), J({ name: 'Alpha', count: 2 }));
  assert.equal(J(c.topStyle), J({ name: STYLES[0], count: 4 }));
  const thin = wctx(sandbox(), [ck(2025, { brewery_name: 'A', beer_type: STYLES[0], venue_name: 'X' }),
    ck(2025, { brewery_name: 'B', beer_type: STYLES[1], venue_name: 'Y' })]);
  assert.equal(thin.topBrewery, null); assert.equal(thin.topStyle, null); assert.equal(thin.topVenue, null);
});

test('WR10: top venue skips Home and venue-less imports; home share counts them', () => {
  const ctx = sandbox();
  const c = wctx(ctx, [
    ...Array.from({ length: 5 }, () => ck(2025, { venue_name: 'Home' })),
    ck(2025, { venue_name: '', source: 'import' }),          // home by isHomeEntry
    ck(2025, { venue_name: '', source: 'live' }),            // not home, no venue
    ck(2025, { venue_name: 'Tap Room' }), ck(2025, { venue_name: 'Tap Room' }),
    ck(2025, { venue_name: 'Bar' }),
  ]);
  assert.equal(J(c.topVenue), J({ name: 'Tap Room', count: 2 }));
  assert.equal(c.homeCount, 6); assert.equal(c.homePct, 60);
  const allHome = wctx(sandbox(), Array.from({ length: 4 }, () => ck(2025, { venue_name: 'Home' })));
  assert.equal(allHome.topVenue, null); assert.equal(allHome.homePct, 100);
});

test('WR11: names come back raw — escaping is the renderer\'s job', () => {
  const ctx = sandbox();
  const c = wctx(ctx, [ck(2025, { brewery_name: '<b>&Co' }), ck(2025, { brewery_name: '<b>&Co' })]);
  assert.equal(c.topBrewery.name, '<b>&Co');
});

const styled = (year, nStyles, perStyle = 2) => Array.from({ length: nStyles * perStyle }, (_, i) =>
  ck(year, { beer_type: STYLES[i % nStyles], month: i % 12 }));

test('WR12: the radar shows at 4+ matched styles, not 3', () => {
  assert.equal(wctx(sandbox(), styled(2025, 3)).showRadar, false);
  const c = wctx(sandbox(), styled(2025, 4));
  assert.equal(c.showRadar, true);
  assert.equal(c.hpMatchedStyles, 4);
  assert.equal(c.hpVector.length, 8);
});

test('WR13: the prior-year overlay needs the radar plus 3+ styles and 5+ entries in the prior year', () => {
  const yr = styled(2025, 4);
  assert.equal(wctx(sandbox(), yr, styled(2024, 3)).showPrior, true);           // 3 styles, 6 entries
  assert.ok(wctx(sandbox(), yr, styled(2024, 3)).prevHpVector);
  assert.equal(wctx(sandbox(), yr, styled(2024, 2, 3)).showPrior, false);       // 2 styles
  assert.equal(wctx(sandbox(), yr, styled(2024, 3).slice(0, 4).concat(ck(2024, { beer_type: 'Not A Style' }))).showPrior, false); // 4 matched entries
  assert.equal(wctx(sandbox(), yr, []).showPrior, false);                        // no prior year
  const thin = wctx(sandbox(), styled(2025, 3), styled(2024, 5));                // prior is rich, year is thin
  assert.equal(thin.showPrior, false); assert.equal(thin.prevHpVector, null);
});

test('WR14: milestones come from milestonesCrossedIn for the year', () => {
  const ctx = sandbox();
  const older = Array.from({ length: 99 }, (_, i) => ck(2024, { brewery_name: 'B' + (i % 10) }));
  const c = wctx(ctx, [ck(2025, { brewery_name: 'B0' })], [], older);
  assert.equal(J(c.milestones.map(m => m.kind)), J(['checkins']));
  assert.equal(c.milestones[0].label, '100th check-in');
});

test('WR15: band fields use band names only, never a 0–100 score', () => {
  const ctx = sandbox();
  const year = [
    ...Array.from({ length: 5 }, () => ck(2025, { beer_type: STYLES[0], beer_name: 'Fave', rating: 90 })),
    ...Array.from({ length: 5 }, () => ck(2025, { beer_type: STYLES[1], beer_name: 'Meh', rating: 10 })),
  ];
  const c = wctx(ctx, year);
  assert.equal(c.ratedTotal, 10);
  assert.equal(c.wheelhouse, STYLES[0]);
  assert.equal(c.lovedBeer, 'Fave');
  assert.equal(c.unfinishedStyle, STYLES[1]);
  for (const k of ['mostLogged', 'wheelhouse', 'lovedBeer', 'unfinishedStyle']) assert.equal(typeof c[k], 'string');
});

// ── Task 3: WRAPPED_COPY consumer ───────────────────────────────

const reg = ctx => vm.runInContext('WRAPPED_COPY', ctx);
const zones = ctx => vm.runInContext('WRAPPED_ZONE_ORDER', ctx);

// A synthetic context where every candidate's condition holds, with names
// that need escaping.
const RICH = {
  year: 2025, prevYear: 2024, total: 200, prevTotal: 100, deltaVolumePct: 100,
  breweries: 80, styles: 40, notes: 30, newBreweryCount: 90, newStyleCount: 12,
  newBreweryPct: 45, newStylePct: 6, busiestMonthName: 'July', busiestMonthCount: 40, activeMonths: 12,
  topBrewery: { name: 'Tree & <House>', count: 60 }, topStyle: { name: 'IPA - New England', count: 70 },
  topVenue: { name: 'The "Tap" Room', count: 9 }, homeCount: 130, homePct: 65,
  ratedTotal: 150, mostLogged: 'IPA - American', wheelhouse: 'Stout & Co', lovedBeer: 'Heady <Topper>',
  unfinishedStyle: 'Sour - Gose',
};
const EMPTY = { ...RICH, prevTotal: 0, deltaVolumePct: null, activeMonths: 3, busiestMonthCount: 3,
  newBreweryPct: 20, newStyleCount: 1, ratedTotal: 0, topBrewery: null, topStyle: null, topVenue: null, homePct: 10 };

test('WR16: registry hygiene — unique ids, known zones, priority order, explicit shareSlot', () => {
  const ctx = sandbox();
  const r = reg(ctx), order = zones(ctx);
  assert.equal(new Set(r.map(c => c.id)).size, r.length);
  for (const c of r) {
    assert.ok(order.includes(c.zone), `${c.id} has unknown zone ${c.zone}`);
    assert.equal(typeof c.shareSlot, 'boolean', `${c.id} needs an explicit shareSlot`);
    assert.equal(typeof c.condition, 'function'); assert.equal(typeof c.render, 'function');
  }
  for (const z of order) {
    const ps = r.filter(c => c.zone === z).map(c => c.priority);
    assert.ok(ps.length >= 2, `zone ${z} needs a minimal pool`);
    assert.equal(J(ps), J([...ps].sort((a, b) => b - a)), `zone ${z} out of priority order`);
  }
  assert.equal(J(order), J(['headline', 'exploration', 'band', 'superlative']));
  assert.equal(vm.runInContext('WRAPPED_MAX_EARNED', ctx), 2);
});

test('WR17: venue and home lines never go on a share card (DE3)', () => {
  const r = reg(sandbox());
  for (const c of r) {
    const text = c.render(RICH);
    if (/Tap|home/i.test(text)) assert.equal(c.shareSlot, false, `${c.id} mentions a venue but is shareable`);
  }
});

// RICH plus the mirror-image variants for the mutually exclusive pairs.
const VARIANTS = [RICH, { ...RICH, deltaVolumePct: -50 }, { ...RICH, newBreweryPct: 10 }];

test('WR18: every candidate renders a clean past-tense fragment under its own condition', () => {
  const ctx = sandbox();
  for (const c of reg(ctx)) {
    const v = VARIANTS.find(x => c.condition(x));
    assert.ok(v, `${c.id} never qualifies`);
    const html = c.render(v);
    assert.ok(html.length > 0, c.id);
    assert.doesNotMatch(html, /[.!]$/, `${c.id} ends with punctuation`);
    assert.doesNotMatch(html, /^</, `${c.id} starts with markup`);
    assert.doesNotMatch(html, /\bso far\b|\bthis year\b|\byou've\b|\byou're\b|\bhave been\b|\bkeep\b/i, `${c.id} is not past tense: ${html}`);
    assert.doesNotMatch(html, /<(?!\/?b>)/, `${c.id} leaks unescaped markup: ${html}`);
  }
});

test('WR19: entity names are escaped', () => {
  const r = reg(sandbox());
  const all = r.map(c => c.render(RICH)).join(' | ');
  assert.match(all, /Tree &amp; &lt;House/);
  assert.match(all, /Heady &lt;Topper/);
  assert.match(all, /Stout &amp; Co/);
  assert.match(all, /The &quot;Tap&quot; Room/);
  assert.doesNotMatch(all, /<(?!\/?b>)/);
});

test('WR20: cap of 2, first zones in order win; determinism', () => {
  const ctx = sandbox();
  const a = ctx.buildWrappedCopy(RICH);
  assert.equal(J(a.map(p => p.zone)), J(['headline', 'exploration']));
  assert.equal(J(a.map(p => p.id)), J(['wr_bigger', 'wr_new_ground']));
  assert.equal(J(ctx.buildWrappedCopy(RICH)), J(a));
});

test('WR21: later zones inherit when earlier ones earn nothing', () => {
  const ctx = sandbox();
  const c = { ...EMPTY, ratedTotal: 50, homePct: 70 };
  assert.equal(J(ctx.buildWrappedCopy(c).map(p => p.zone)), J(['band', 'superlative']));
});

test('WR22: nothing earned → no sentences (no empty shell)', () => {
  const ctx = sandbox();
  const picked = ctx.buildWrappedCopy(EMPTY);
  assert.equal(picked.length, 0);
  assert.equal(ctx.wrappedSentences(picked), '');
});

test('WR23: sentences are capitalized and punctuated', () => {
  const ctx = sandbox();
  const out = ctx.wrappedSentences(ctx.buildWrappedCopy(RICH));
  assert.match(out, /^A bigger year than 2024 — <b>100%<\/b> more check-ins\. New ground all year/);
  assert.match(out, /\.$/);
});

test('WR24: D1 — the year\'s raw 0–100 ratings never reach the copy', () => {
  const ctx = sandbox();
  const year = Array.from({ length: 30 }, (_, i) => ck(2025, {
    rating: 77, beer_name: i < 6 ? 'Loved' : 'B' + i, beer_type: STYLES[i % 5], brewery_name: 'Br' + (i % 4), month: i % 12 }));
  const prev = Array.from({ length: 21 }, (_, i) => ck(2024, { rating: 77, beer_type: STYLES[i % 3] }));
  const c = wctx(ctx, year, prev);
  const text = reg(ctx).filter(k => k.condition(c)).map(k => k.render(c)).join(' ');
  assert.ok(text.length > 0);
  assert.doesNotMatch(text, /\b77\b/);
});
