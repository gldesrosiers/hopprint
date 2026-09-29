#!/usr/bin/env node
// Stats page + per-page scroll (STATS_WORKPLAN.md ST1–ST17). Run:
//   node --test tests/stats-page.test.js
//
// Real-source-pulled: switchTab() and restoreScroll() are extracted verbatim
// from index.html. Each page's render step is a stand-in that clamps the
// window to the top, the worst case a real rebuild can do, so a passing
// restore proves it runs after the render.

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const vm = require('vm');

const { ROOT, script, inlineScript, extractFunction, extractFunctionFrom, allFunctions } = require('./helpers');

// main at the start of the stats-page branch (the history-perf merge).
const BRANCH_BASE = '8095a9c';
const TABS = ['checkin', 'history', 'analytics', 'profile', 'discover'];

function fakeEl() {
  const classes = new Set();
  return { classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c) },
    setAttribute() {}, removeAttribute() {} };
}

// A fresh app on Check In. win.scrollY is settable; scrollTo records calls.
function app() {
  const els = {};
  for (const t of TABS) { els[`tab-${t}`] = fakeEl(); els[`screen-${t}`] = fakeEl(); }
  els['screen-checkin'].classList.add('active');
  const win = { scrollY: 0, scrolls: [], readFrom: [] };
  const renders = [];
  const render = name => () => { renders.push(name); win.scrollY = 0; };
  const ctx = vm.createContext({
    console,
    window: {
      get scrollY() { win.readFrom.push(TABS.find(t => els[`screen-${t}`].classList.contains('active'))); return win.scrollY; },
      scrollTo: o => { win.scrolls.push({ ...o }); win.scrollY = o.top; },
    },
    document: {
      getElementById: id => els[id] || null,
      querySelectorAll: sel => (sel === '.bn-item' ? TABS.map(t => els[`tab-${t}`]) : sel === '.screen' ? TABS.map(t => els[`screen-${t}`]) : []),
    },
    enterHistory: render('history'), renderAnalytics: render('analytics'),
    renderProfile: render('profile'), renderWishlist: render('discover'),
  });
  vm.runInContext([
    ...['currentTab', 'tabScroll'].map(n => script.match(new RegExp(`^let ${n} = [^\\n]*;`, 'm'))[0]),
    ...['restoreScroll', 'switchTab'].map(extractFunction),
  ].join('\n'), ctx);
  const get = name => vm.runInContext(name, ctx);
  return { ctx, els, win, renders, get };
}

// The branch-base build's inline script, or null without git history.
let baseCache;
function baseScript() {
  if (baseCache === undefined) {
    try {
      baseCache = inlineScript(execFileSync('git', ['show', `${BRANCH_BASE}:index.html`], { cwd: ROOT, encoding: 'utf8' }));
    } catch (e) {
      baseCache = null;
    }
  }
  return baseCache;
}

// ── ST1 / ST2 / ST3 per-page scroll ─────────────────────────────
test('ST3: every page starts at the top, and the state is in memory only', () => {
  const { get } = app();
  assert.deepEqual({ ...get('tabScroll') }, { checkin: 0, history: 0, analytics: 0, profile: 0, discover: 0 });
  assert.doesNotMatch(extractFunction('switchTab'), /localStorage/);
});

test('ST1: each page restores its own scroll after visits to the others', () => {
  const { ctx, win } = app();
  const depth = { checkin: 300, history: 4000, analytics: 1800, profile: 900, discover: 150 };
  ctx.switchTab('checkin');                        // settle on Check In (re-tap → 0)
  for (const t of TABS) { ctx.switchTab(t); win.scrollY = depth[t]; }
  for (const t of TABS) {                          // on Discover now, so no step is a re-tap
    ctx.switchTab(t);
    assert.equal(win.scrollY, depth[t], t);
  }
});

test('ST1: scroll is read while the page being left is still showing', () => {
  const { ctx, win } = app();
  ctx.switchTab('analytics');
  win.scrollY = 700;
  win.readFrom.length = 0;
  ctx.switchTab('profile');
  assert.deepEqual(win.readFrom, ['analytics']);
});

test('ST1: the restore runs after the page renders, instantly', () => {
  const { ctx, win, renders } = app();
  ctx.switchTab('profile');
  win.scrollY = 900;
  ctx.switchTab('analytics');
  ctx.switchTab('profile');                        // renderProfile() clamps to 0, then restore
  assert.equal(renders.at(-1), 'profile');
  assert.deepEqual(win.scrolls.at(-1), { top: 900, behavior: 'instant' });
  assert.equal(win.scrollY, 900);
});

test('ST1: a page that is new this session opens at the top, not at the last page\'s depth', () => {
  const { ctx, win } = app();
  ctx.switchTab('history');
  win.scrollY = 5000;
  ctx.switchTab('discover');
  assert.equal(win.scrollY, 0);
});

test('ST2: re-tapping any page jumps to its top, with no extra render', () => {
  for (const t of TABS) {
    const { ctx, win, renders } = app();
    ctx.switchTab(t);
    win.scrollY = 1234;
    const before = renders.filter(r => r === t).length;
    ctx.switchTab(t);
    assert.equal(win.scrollY, 0, t);
    assert.equal(renders.filter(r => r === t).length, before + (t === 'checkin' ? 0 : 1), `${t}: same render step as any visit`);
    ctx.switchTab(t === 'checkin' ? 'history' : 'checkin');
    ctx.switchTab(t);
    assert.equal(win.scrollY, 0, `${t}: the top is what was saved`);
  }
});

test('ST2: the logo is a Check In tap, so on Check In it jumps to the top', () => {
  assert.match(require('./helpers').html, /<div class="logo" onclick="switchTab\('checkin'\)"/);
});

// ── Stats render harness ────────────────────────────────────────
// renderAnalytics() from a given build, with every function/const it touches
// pulled from that same build (resolved on demand from ReferenceErrors, so the
// harness never lists — or reimplements — the helpers by hand).
function statsApp(src, entries, { year = 'all' } = {}) {
  const inner = { innerHTML: '' };
  const code = [];
  const have = new Set();
  const pull = name => {
    let c = null;
    try { c = extractFunctionFrom(src, name); } catch (e) {
      const m = src.match(new RegExp(`^(?:const|let) ${name} = [\\s\\S]*?;\\n`, 'm'));
      c = m && m[0];
    }
    if (!c) throw new Error(`cannot resolve ${name}`);
    have.add(name); code.unshift(c);
  };
  pull('renderAnalytics');
  for (let i = 0; i < 80; i++) {
    const ctx = vm.createContext({
      console, entries,
      document: { getElementById: id => (id === 'analyticsInner' ? inner : null) },
      requestAnimationFrame: () => {},
    });
    try {
      vm.runInContext(code.join('\n') + `\nanalyticsYear = ${JSON.stringify(year)};\nrenderAnalytics();`, ctx);
      return { ctx, html: inner.innerHTML };
    } catch (e) {
      const m = String(e).match(/ReferenceError: (\w+) is not defined/);
      if (!m || have.has(m[1])) throw e;
      pull(m[1]);
    }
  }
  throw new Error('dependency resolution did not settle');
}

// A two-year log rich enough that every conditional card qualifies.
function richLog() {
  const out = [];
  for (let i = 0; i < 320; i++) {
    const y = i < 150 ? 2025 : 2026, m = i % 12, d = 1 + (i % 27);
    out.push({
      id: `id-${i}`, beer_name: `Beer ${i % 40}`, brewery_name: `Brewery ${i % 30}`, beer_type: `Style ${i % 28}`,
      brewery_state: ['VT', 'ME', 'NY', 'CA'][i % 4], venue_name: `Bar ${i % 9}`, purchase_venue: `Shop ${i % 5}`,
      serving_type: ['Draft', 'Can', 'Bottle'][i % 3], beer_abv: String(4 + (i % 70) / 10),
      rating: i % 2 ? [95, 90, 60, 20][i % 4] : null,
      created_at: `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}T${String(12 + (i % 10)).padStart(2, '0')}:00`,
    });
  }
  return out;
}

// Top-level pieces of the Stats page, in order.
const piece = /<div class="(stat-grid|insight-card|chart-card)[^"]*">\s*(?:<div class="chart-title">([^<]*)<\/div>)?/g;
const layout = html => [...html.matchAll(piece)].map(m => m[2] || m[1]);
// The page split into its top-level cards, for markup comparison.
const cardsOf = html => html.split(/(?=<div class="(?:stat-grid|insight-card|chart-card))/).slice(1).map(c => c.trim());

const ST5_ORDER = [
  'stat-grid', 'insight-card', 'Firsts & Milestones', 'Your Ratings, Read Back', 'Go-To Beers', 'Top Breweries',
  'Top Styles', 'Serving Format', 'Top Venues', 'Brewery Origin', 'Where You Buy', 'ABV Spread',
  'New vs. Repeat', 'By Day of Week', 'Monthly Pattern', 'Volume Over Time', 'Year Over Year', 'Volume by Year',
];

// ── ST5 order ───────────────────────────────────────────────────
test('ST5: All Time shows every card in the new order (no insight card on All Time)', () => {
  const { html } = statsApp(script, richLog());
  assert.deepEqual(layout(html), ST5_ORDER.filter(k => k !== 'insight-card'));
});

test('ST5: a single year adds the insight card and drops the All-Time-only pair, order kept', () => {
  const { html } = statsApp(script, richLog(), { year: 2026 });
  const got = layout(html);
  assert.ok(got.includes('insight-card'), 'fixture should produce an insight');
  assert.deepEqual(got, ST5_ORDER.filter(k => k !== 'Year Over Year' && k !== 'Volume by Year'));
});

test('ST5: conditional cards drop out and the rest keep their relative order', () => {
  const sparse = richLog().slice(150, 155).map(e => ({ ...e, rating: null, beer_abv: '', created_at: e.created_at.replace(/-\d\d-/, '-05-') }));
  const got = layout(statsApp(script, sparse).html);
  for (const gone of ['Your Ratings, Read Back', 'ABV Spread', 'New vs. Repeat']) assert.ok(!got.includes(gone), gone);
  assert.ok(got.includes('Firsts & Milestones'), 'any logged style is a "first", so this card nearly always shows');
  assert.deepEqual(got, ST5_ORDER.filter(k => got.includes(k)));
});

test('ST5: every card\'s markup is unchanged — only the order moved', { skip: baseScript() ? false : 'git history not available' }, () => {
  for (const year of ['all', 2026]) {
    const before = cardsOf(statsApp(baseScript(), richLog(), { year }).html);
    const after = cardsOf(statsApp(script, richLog(), { year }).html);
    assert.equal(after.length, before.length, `${year}: same number of cards`);
    assert.deepEqual([...after].sort(), [...before].sort(), `${year}: same cards`);
    assert.notDeepEqual(after, before, `${year}: order changed`);
  }
});

// ── Byte-identical preservation against the branch base ─────────
const ST_ALLOWED = {
  switchTab: 'ST1/ST2 per-page scroll + restore after render',
  enterHistory: 'ST1 scroll restore moves to switchTab',
  applyHistorySearch: 'ST1 off-tab pause writes tabScroll.history',
  handleImport: 'ST1 HL7 reset writes tabScroll.history',
  renderAnalytics: 'ST5 card order',
};

test('functions outside the workplan are byte-identical to the branch base', { skip: baseScript() ? false : 'git history not available' }, () => {
  const before = allFunctions(baseScript());
  const now = allFunctions(script);
  assert.deepEqual(Object.keys(before).filter(n => !(n in now)), [], 'no function removed');
  const changed = Object.keys(before).filter(n => before[n] !== now[n]);
  assert.deepEqual(changed.filter(n => !(n in ST_ALLOWED)), [], 'changed without a listed reason');
  assert.deepEqual(Object.keys(ST_ALLOWED).filter(n => !changed.includes(n)), [], 'listed but unchanged');
});
