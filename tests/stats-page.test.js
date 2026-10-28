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
const vm = require('vm');

const { script, style, extractFunction, extractFunctionFrom } = require('./helpers');

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
    enterHistory: render('history'), enterAnalytics: render('analytics'),
    enterProfile: render('profile'), enterDiscover: render('discover'),
  });
  vm.runInContext([
    ...['currentTab', 'tabScroll'].map(n => script.match(new RegExp(`^let ${n} = [^\\n]*;`, 'm'))[0]),
    ...['restoreScroll', 'switchTab'].map(extractFunction),
  ].join('\n'), ctx);
  const get = name => vm.runInContext(name, ctx);
  return { ctx, els, win, renders, get };
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
  ctx.switchTab('profile');                        // enterProfile() clamps to 0, then restore
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
//
// Stand-ins: #analyticsInner is a markup string (inner.writes counts full
// rebuilds); any other id present in that markup resolves to a fake element;
// Chart records every chart made; requestAnimationFrame queues until flush().
const STYLE_MATRIX = require('../style_matrix.js');
const resolved = new Map();   // src → [code]; dependency resolution is per build
function statsApp(src, entries, { year = 'all' } = {}) {
  let markup = '';
  // A rebuild of the visible page can clamp the scroll; model the worst case.
  const win = { scrollY: 0, scrollTo(o) { scrolls.push({ ...o }); this.scrollY = o.top; } };
  const inner = { writes: 0, get innerHTML() { return markup; }, set innerHTML(v) { markup = v; inner.writes++; win.scrollY = 0; } };
  const els = new Map();
  const el = id => {
    if (!els.has(id)) els.set(id, { id, hidden: markup.includes(`id="${id}" hidden`),
      attrs: {}, setAttribute(k, v) { this.attrs[k] = String(v); }, classList: { add() {}, remove() {} } });
    return els.get(id);
  };
  const charts = [], frames = [], scrolls = [], stubs = [];
  const stub = name => () => stubs.push(name);
  function Chart(canvas, config) { this.canvas = canvas; this.config = config; this.destroyed = false; charts.push(this); }
  Chart.prototype.destroy = function () { this.destroyed = true; };
  const makeCtx = () => vm.createContext({
    console, entries, Chart,
    STYLE_MATRIX,   // style_matrix.js is a separate <script>; the Styles card's go-to family reads it (SC11)
    document: {
      getElementById: id => (id === 'analyticsInner' ? inner
        : markup.includes(`id="${id}"`) || /^(tab|screen)-/.test(id) ? el(id) : null),
      querySelectorAll: () => [],
      documentElement: {},
    },
    getComputedStyle: () => ({ getPropertyValue: () => '#e97324' }),
    requestAnimationFrame: fn => frames.push(fn),
    window: win,
    localStorage: { setItem() {} },
    // What a pull or a tab switch touches outside Stats.
    buildLiveLists: stub('buildLiveLists'), updateHeaderMeta: stub('updateHeaderMeta'),
    enterDiscover: stub('enterDiscover'), renderWishlist: stub('renderWishlist'), buildModeGrid: stub('buildModeGrid'), enterProfile: stub('enterProfile'), refreshProfile: stub('refreshProfile'),
    enterHistory: stub('enterHistory'), refreshHistory: stub('refreshHistory'),
  });
  const code = resolved.get(src) || [];
  const have = new Set(code.map(c => c.match(/^(?:async\s+)?(?:function|const|let)\s+(\w+)/)[1]));
  const pull = name => {
    let c = null;
    try { c = extractFunctionFrom(src, name); } catch (e) {
      // One-line declarations (a trailing comment allowed) first, then multi-line ones.
      const m = src.match(new RegExp(`^(?:const|let) ${name} = [^\\n]*;(?:[ \\t]*//[^\\n]*)?$`, 'm'))
        || src.match(new RegExp(`^(?:const|let) ${name} = [\\s\\S]*?;\\n`, 'm'));
      c = m && m[0];
    }
    if (!c) throw new Error(`cannot resolve ${name}`);
    have.add(name); code.unshift(c);
  };
  if (!code.length) {
    pull('renderAnalytics');
    // Reached only after a render (toggles, the next frame, chart builders),
    // so the render-time resolution below never sees them.
    for (const late of ['toggleStatsCard', 'buildStatsChart', 'cssVar', 'rootStyle', 'statsChartBuilders',
      'enterAnalytics', 'refreshAnalytics', 'setAnalyticsYear', 'toggleAnalyticsCompare', 'setNvrField',
      'switchTab', 'save', 'refreshAfterPull', 'restoreScroll', 'currentTab', 'tabScroll', 'historyDirty']) {
      if (new RegExp(`^(?:function|const|let) ${late}\\b`, 'm').test(src)) pull(late);
    }
  }
  let ctx;
  for (let i = 0; i < 80; i++) {
    ctx = makeCtx();   // fresh each attempt: a failed run leaves its let/const bindings behind
    try {
      vm.runInContext(code.join('\n') + `\nanalyticsYear = ${JSON.stringify(year)};\nrenderAnalytics();`, ctx);
      resolved.set(src, code);
      break;
    } catch (e) {
      const m = String(e).match(/ReferenceError: (\w+) is not defined/);
      if (!m || have.has(m[1])) throw e;
      markup = ''; inner.writes = 0; charts.length = 0; frames.length = 0;
      pull(m[1]);
    }
  }
  const flush = () => { while (frames.length) frames.shift()(); };
  const run = js => vm.runInContext(js, ctx);
  // A fresh fake per id after each rebuild, as a real innerHTML write replaces the nodes.
  const render = () => { els.clear(); ctx.renderAnalytics(); };
  return { ctx, inner, get html() { return markup; }, charts, flush, run, render, el, scrolls, win, stubs };
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

// The page split into its top-level pieces (tiles, insight, cards).
const cardsOf = html => html.split(/(?=<div class="(?:stat-grid|insight-card|chart-card))/).slice(1).map(c => c.trim());
// Each piece's name: a card's title, or the piece's class.
const layout = html => cardsOf(html).map(c => (c.match(/class="chart-title">([^<]*)</) || [])[1] || c.match(/^<div class="([\w-]+)/)[1]);
// Collapsible cards: key → { open (aria-expanded), hidden (body) }.
const cardState = html => Object.fromEntries([...html.matchAll(/data-card="(\w+)">\s*<button class="card-head" type="button" id="card-\1-head" aria-expanded="(true|false)" aria-controls="card-\1"[\s\S]*?<div class="card-body" id="card-\1"( hidden)?>/g)]
  .map(m => [m[1], { open: m[2] === 'true', hidden: !!m[3] }]));
const ST5_ORDER = [
  'stat-grid', 'insight-card', 'Firsts & Milestones', 'Your Ratings, Read Back', 'Go-To Beers', 'Top Breweries',
  'Top Styles', 'Serving Format', 'Top Venues', 'Brewery Origin', 'Where You Buy', 'ABV Spread',
  'New vs. Repeat', 'By Day of Week', 'Monthly Pattern', 'Volume Over Time', 'Year Over Year', 'Volume by Year',
];
const COLLAPSIBLE = ['milestones', 'ratings', 'gotobeers', 'breweries', 'styles', 'serving', 'venues', 'origin', 'buy',
  'abv', 'nvr', 'dow', 'monthly', 'volume', 'yoy', 'byyear'];

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

// ── ST6–ST9, ST11, ST13, ST15–ST17 collapsible cards ────────────
test('ST15: icon("chevron") is a 20-grid line icon at the requested size and weight', () => {
  const { run } = statsApp(script, richLog());
  const svg = run(`icon('chevron', 18, 2.2)`);
  assert.match(svg, /^<svg class="ico" width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"[^>]*><path d="M5\.5 8 10 12\.5 14\.5 8"><\/path><\/svg>$/);
});

test('ST6/ST13/ST17: 16 collapsible cards; only Milestones and Ratings start open; items 1–3 have no toggle', () => {
  const { html } = statsApp(script, richLog(), { year: 2026 });
  const all = statsApp(script, richLog()).html;
  assert.deepEqual(Object.keys(cardState(all)).sort(), [...COLLAPSIBLE].sort());
  for (const [key, st] of Object.entries(cardState(all))) {
    const open = key === 'milestones' || key === 'ratings';
    assert.deepEqual(st, { open, hidden: !open }, key);
  }
  for (const piece of cardsOf(html).filter(c => /^<div class="(stat-grid|insight-card)/.test(c))) {
    assert.doesNotMatch(piece, /card-head|aria-expanded/);
  }
  assert.match(html, /<div class="year-row">(?:(?!card-head)[\s\S])*?<div class="stat-grid">/, 'year row has no toggle');
});

test('ST17: each header is one button holding title, sub and chevron, wired to its body', () => {
  const { html } = statsApp(script, richLog());
  const head = html.match(/<button class="card-head" type="button" id="card-styles-head" aria-expanded="false" aria-controls="card-styles" onclick="toggleStatsCard\('styles'\)">([\s\S]*?)<\/button>/);
  assert.ok(head, 'styles header');
  assert.match(head[1], /<span class="chart-title">Top Styles<\/span><span class="chart-sub">Tap any row to dig in<\/span>/);
  assert.match(head[1], /<span class="card-chevron"><svg [^>]*><path d="M5\.5 8 10 12\.5 14\.5 8"><\/path><\/svg><\/span>/);
});

test('ST8/ST16: toggling opens and closes in place — no rebuild, no scroll', () => {
  const a = statsApp(script, richLog());
  const writes = a.inner.writes;
  a.run(`toggleStatsCard('styles')`);
  assert.equal(a.el('card-styles-head').attrs['aria-expanded'], 'true');
  assert.equal(a.el('card-styles').hidden, false);
  a.run(`toggleStatsCard('breweries')`);           // several open at once (ST8)
  assert.equal(a.el('card-breweries').hidden, false);
  assert.equal(a.el('card-styles').hidden, false);
  a.run(`toggleStatsCard('styles')`);
  assert.equal(a.el('card-styles-head').attrs['aria-expanded'], 'false');
  assert.equal(a.el('card-styles').hidden, true);
  a.run(`toggleStatsCard('milestones')`);          // default-open cards close too (ST13)
  assert.equal(a.el('card-milestones').hidden, true);
  assert.equal(a.inner.writes, writes, 'no rebuild');
  assert.deepEqual(a.scrolls, [], 'no scroll');
  assert.deepEqual([...a.run('statsOpen')].sort(), ['breweries', 'ratings']);
});

test('ST11: no chart is built for a closed card; opening builds exactly one, once', () => {
  const a = statsApp(script, richLog());
  a.flush();
  assert.equal(a.charts.length, 0, 'every chart card starts closed');
  a.run(`toggleStatsCard('monthly')`);
  assert.deepEqual(a.charts.map(c => c.canvas.id), ['chartMonth']);
  a.run(`toggleStatsCard('monthly')`); a.run(`toggleStatsCard('monthly')`);
  a.flush();
  assert.equal(a.charts.length, 1, 'reopening does not build a second');
  for (const [key, canvas] of [['volume', 'chartTimeline'], ['nvr', 'chartNvr'], ['serving', 'chartServe'], ['byyear', 'chartYoY']]) {
    a.run(`toggleStatsCard('${key}')`);
    assert.equal(a.charts.at(-1).canvas.id, canvas, key);
  }
  assert.equal(a.charts.length, 5);
  a.run(`toggleStatsCard('styles')`);               // a card with no chart
  assert.equal(a.charts.length, 5);
});

test('ST11: a rebuild destroys the charts; open cards rebuild theirs on the next frame, closed ones wait', () => {
  const a = statsApp(script, richLog());
  a.run(`toggleStatsCard('monthly')`);
  a.run(`toggleStatsCard('serving')`);
  a.run(`toggleStatsCard('serving')`);               // built, then closed
  a.render();
  assert.ok(a.charts.slice(0, 2).every(c => c.destroyed), 'old charts destroyed');
  assert.equal(a.charts.length, 2, 'nothing built before the frame');
  a.flush();
  assert.deepEqual(a.charts.slice(2).map(c => c.canvas.id), ['chartMonth'], 'only the open chart card');
  a.run(`toggleStatsCard('serving')`);
  assert.deepEqual(a.charts.slice(2).map(c => c.canvas.id), ['chartMonth', 'chartServe']);
});

test('ST11: opening a card before the first frame builds its chart once, not twice', () => {
  const a = statsApp(script, richLog());
  a.run(`toggleStatsCard('volume')`);
  a.flush();
  assert.deepEqual(a.charts.map(c => c.canvas.id), ['chartTimeline']);
});

test('ST9: open state survives a rebuild and a year change, and a fresh app starts at the defaults', () => {
  const a = statsApp(script, richLog());
  a.run(`toggleStatsCard('dow')`);
  a.run(`toggleStatsCard('ratings')`);
  a.render();
  let st = cardState(a.html);
  assert.equal(st.dow.open, true);
  assert.equal(st.ratings.open, false);
  a.run(`analyticsYear = 2026`);
  a.render();
  st = cardState(a.html);
  assert.equal(st.dow.open, true);
  assert.equal(st.milestones.open, true);
  const fresh = cardState(statsApp(script, richLog()).html);
  assert.deepEqual(Object.keys(fresh).filter(k => fresh[k].open).sort(), ['milestones', 'ratings']);
});

test('ST9: open state lives in memory only', () => {
  for (const fn of ['statsCard', 'toggleStatsCard', 'buildStatsChart', 'renderAnalytics']) {
    assert.doesNotMatch(extractFunction(fn), /localStorage|sessionStorage/, fn);
  }
});

test('ST7: header styles — whole-card tap target, rotating chevron, hidden bodies take no space', () => {
  const { style } = require('./helpers');
  assert.match(style, /\.card-head \{[^}]*width: calc\(100% \+ 32px\); margin: -16px; padding: 16px;/);
  assert.match(style, /\.card-head\[aria-expanded="true"\] \.card-chevron \{ transform: rotate\(180deg\); \}/);
  assert.match(style, /\.card-body\[hidden\] \{ display: none; \}/);
});

// ── ST10 / ST4 / ST14 rebuild caching and setting changes ───────
// Stats open, scrolled to 1500, with the Monthly Pattern card (and its chart) open.
function onStats(opts) {
  const a = statsApp(script, richLog(), opts);
  a.run(`switchTab('analytics')`);
  a.run(`toggleStatsCard('monthly')`);
  a.flush();
  a.win.scrollY = 1500;
  return a;
}
const liveCharts = a => a.charts.filter(c => !c.destroyed);

test('ST10: the first visit builds Stats; coming back with no writes reuses the page and its charts', () => {
  const a = statsApp(script, richLog());
  a.run(`statsDirty = true`);                       // as on app load (the harness rendered once to resolve)
  const writes = a.inner.writes;
  a.run(`switchTab('analytics')`);
  assert.equal(a.inner.writes, writes + 1, 'first visit builds');
  assert.equal(a.run('statsDirty'), false);
  a.run(`toggleStatsCard('monthly')`);
  const chart = a.charts.at(-1);
  a.win.scrollY = 1500;
  a.run(`switchTab('profile')`);
  a.win.scrollY = 200;
  a.run(`switchTab('analytics')`);
  assert.equal(a.inner.writes, writes + 1, 'no rebuild');
  assert.equal(chart.destroyed, false, 'same live chart');
  assert.deepEqual(liveCharts(a), [chart]);
  assert.equal(a.win.scrollY, 1500, 'ST1 position restored');
});

test('ST10: after save(), the next visit rebuilds, keeping open cards and redrawing their charts', () => {
  const a = onStats();
  const writes = a.inner.writes, chart = a.charts.at(-1);
  a.run(`switchTab('checkin')`);
  a.run(`entries.push({ id: 'new', beer_name: 'New', brewery_name: 'B', beer_type: 'IPA', created_at: '2026-09-28T19:00' }); save()`);
  assert.equal(a.run('statsDirty'), true);
  a.run(`switchTab('analytics')`);
  assert.equal(a.inner.writes, writes + 1);
  assert.equal(chart.destroyed, true);
  assert.equal(cardState(a.html).monthly.open, true);
  a.flush();
  assert.deepEqual(liveCharts(a).map(c => c.canvas.id), ['chartMonth']);
  assert.equal(a.win.scrollY, 1500);
});

test('ST4: a year button rebuilds and jumps to the top, keeping open cards', () => {
  const a = onStats();
  const writes = a.inner.writes;
  a.run(`setAnalyticsYear(2026, { classList: { add() {} } })`);
  assert.equal(a.inner.writes, writes + 1);
  assert.equal(a.win.scrollY, 0);
  assert.deepEqual(a.scrolls.at(-1), { top: 0, behavior: 'instant' });
  assert.equal(cardState(a.html).monthly.open, true);
});

test('ST4: the Compare toggle rebuilds and jumps to the top', () => {
  const a = onStats({ year: 2026 });
  assert.match(a.html, /toggleAnalyticsCompare\(\)/, 'compare is offered for 2026');
  const writes = a.inner.writes;
  a.run(`toggleAnalyticsCompare()`);
  assert.equal(a.run('analyticsCompare'), true);
  assert.equal(a.inner.writes, writes + 1);
  assert.equal(a.win.scrollY, 0);
  assert.deepEqual(a.scrolls.at(-1), { top: 0, behavior: 'instant' });
  assert.equal(cardState(a.html).monthly.open, true);
});

test('ST14: the New vs. Repeat switch rebuilds and keeps the position', () => {
  const a = onStats();
  a.run(`toggleStatsCard('nvr')`);
  const writes = a.inner.writes;
  a.run(`setNvrField('beer_type')`);
  assert.equal(a.inner.writes, writes + 1);
  assert.equal(a.win.scrollY, 1500, 'restored after the rebuild clamped it');
  assert.equal(cardState(a.html).nvr.open, true);
  assert.match(a.html, /class="seg-btn active" onclick="setNvrField\('beer_type'\)"/);
});

test('ST10: a sync pull while on Stats rebuilds in place; off Stats it waits for the next visit', () => {
  const on = onStats();
  const writes = on.inner.writes;
  on.run(`save(); refreshAfterPull()`);
  assert.equal(on.inner.writes, writes + 1);
  assert.equal(on.win.scrollY, 1500);
  const off = onStats();
  off.run(`switchTab('discover')`);
  const offWrites = off.inner.writes;
  off.run(`save(); refreshAfterPull()`);
  assert.equal(off.inner.writes, offWrites, 'nothing renders off-tab');
  off.run(`switchTab('analytics')`);
  assert.equal(off.inner.writes, offWrites + 1);
});

test('ST10: re-tapping Stats jumps to the top without a rebuild', () => {
  const a = onStats();
  const writes = a.inner.writes;
  a.run(`switchTab('analytics')`);
  assert.equal(a.inner.writes, writes);
  assert.equal(a.win.scrollY, 0);
});

// ── Stat card subheads (STAT_CARDS_WORKPLAN.md SC1–SC33) ────────
const sc = (id, beer_name, brewery_name, beer_abv, beer_type, created_at) => ({ id, beer_name, brewery_name, beer_abv, beer_type, created_at });
function cardLog() {
  return [
    sc('q1', 'Old Ale', 'Brewery Z', '7', 'Altbier - Traditional', '2023-03-01T12:00'),
    sc('q2', 'Old Ale', 'Brewery Z', '7', 'Altbier - Traditional', '2023-04-01T12:00'),
    sc('q3', 'Old Ale', 'Brewery Z', '7', 'Altbier - Traditional', '2023-05-01T12:00'),
    sc('p1', 'Old Ale', 'Brewery Z', '5', 'Altbier - Traditional', '2024-06-01T12:00'),
    sc('p2', 'Keeper', 'Hill Farmstead', '5', '', '2024-07-01T12:00'),
    sc('a', 'Keeper', 'Hill Farmstead', '6', 'Belgian Tripel', '2025-01-10T12:00'),        // repeat
    sc('b', 'keeper ', 'hill farmstead ', '6', 'Dark Ale', '2025-02-10T12:00'),            // repeat, other spelling
    sc('c', 'IPA', 'Brewery A', '65', 'Dark Ale', '2025-03-10T12:00'),                     // typo ABV
    sc('d', 'IPA', 'Brewery B', '12', 'Dark Ale', '2025-04-10T12:00'),                     // a different IPA
    sc('e', 'Big Stout', 'Brewery B', '12.0', 'Belgian Dubbel', '2025-05-10T12:00'),       // ties d on ABV, later
    sc('f', '', 'Brewery A', '', 'Altbier - Traditional', '2025-06-10T12:00'),             // no beer name
  ];
}
// Card label → { text, cls } of the line under the label.
const subs = html => Object.fromEntries(html.split('\n').filter(l => l.includes('class="stat-card"')).map(l => {
  const m = l.match(/stat-label">([^<]+)<\/div>(.*)<\/div>$/);
  return [m[1], { text: m[2].replace(/<[^>]+>/g, ''), cls: (m[2].match(/^<div class="([^"]+)"/) || [])[1] || '' }];
}));
const statApp = (year, compare = false) => {
  const a = statsApp(script, cardLog(), { year });
  if (compare) a.run('analyticsCompare = true; renderAnalytics()');
  return subs(a.html);
};

test('SC4/SC5/SC6/SC7: All Time shows four superlatives and no deltas', () => {
  const s = statApp('all');
  assert.equal(s['Check-ins'].text, '5 unique beers · 50% repeats');      // 10 named check-ins, 5 beers
  assert.equal(s['Avg ABV'].text, 'Strongest: Big Stout · Brewery B · 12.0%');
  assert.equal(s['Breweries'].text, 'Top: Brewery Z · 4');
  assert.equal(s['Styles'].text, 'Go-to: Altbier · 71%');                // 5 of 7 eligible
  assert.ok(Object.values(s).every(x => !x.cls.includes('stat-delta')));
});

test('SC4–SC13: a single year scopes the superlatives; new-to-you uses full history', () => {
  const s = statApp(2025);
  assert.equal(s['Check-ins'].text, '3 new to you');                      // c, d, e; a/b repeat 2024's Keeper
  assert.equal(s['Avg ABV'].text, 'Strongest: Big Stout · Brewery B · 12.0%');   // 65% ignored; tie → later
  assert.equal(s['Breweries'].text, 'Top: Brewery A · 2');                // three-way tie → most recent (f)
  assert.equal(s['Styles'].text, 'Go-to: Belgian Ale · 67%');             // Dark Ale (null) skipped: 2 of 3 eligible
});

test('SC2/SC29: compare on replaces each superlative with a ▲ delta, ABV in points', () => {
  const s = statApp(2025, true);
  assert.deepEqual(Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v.text])), {
    'Check-ins': '▲ 200% vs 2024', 'Avg ABV': '▲ 4.0 pts vs 2024', 'Breweries': '▲ 50% vs 2024', 'Styles': '▲ 300% vs 2024',
  });
  assert.ok(Object.values(s).every(x => x.cls === 'stat-delta up'));
});

test('SC29: ▼ is red (down), zero reads 0% and is neutral', () => {
  const s = statApp(2024, true);
  assert.deepEqual(s['Check-ins'], { text: '▼ 33% vs 2023', cls: 'stat-delta down' });
  assert.deepEqual(s['Avg ABV'], { text: '▼ 2.0 pts vs 2023', cls: 'stat-delta down' });
  assert.deepEqual(s['Breweries'], { text: '▲ 100% vs 2023', cls: 'stat-delta up' });
  assert.deepEqual(s['Styles'], { text: '0% vs 2023', cls: 'stat-delta flat' });
  assert.match(style, /\.stat-delta\.up \{ color: var\(--lime\); \}/);
  assert.match(style, /\.stat-delta\.down \{ color: var\(--danger\); \}/);
  assert.doesNotMatch(Object.values(s).map(x => x.text).join(' '), /[+−-]\d/);
});

test('SC17: no prior year → no toggle and superlatives only, even if compare was left on', () => {
  const a = statsApp(script, cardLog(), { year: 2023 });
  assert.doesNotMatch(a.html, /toggleAnalyticsCompare\(\)/);
  a.run('analyticsCompare = true; renderAnalytics()');
  const s = subs(a.html);
  assert.equal(s['Avg ABV'].text, 'Strongest: Old Ale · Brewery Z · 7.0%');
  assert.ok(Object.values(s).every(x => !x.cls.includes('stat-delta')));
});

test('SC19/SC30: an empty superlative hides its line; a card with nothing to compare keeps its superlative', () => {
  const log = [
    sc('x1', 'Lager', 'Brewery Q', '', 'Dark Ale', '2024-03-01T12:00'),
    sc('x2', 'Lager', 'Brewery Q', '', 'Dark Ale', '2024-04-01T12:00'),
    sc('y1', 'Tripel', 'Brewery R', '9', 'Belgian Tripel', '2025-03-01T12:00'),
  ];
  const past = statsApp(script, log, { year: 2024 });
  const p = subs(past.html);
  assert.equal(p['Avg ABV'].text, '', 'no valid ABV → no Strongest line');
  assert.equal(p['Styles'].text, '', 'only null-family styles → no Go-to line');
  const cur = statsApp(script, log, { year: 2025 });
  cur.run('analyticsCompare = true; renderAnalytics()');
  const c = subs(cur.html);
  assert.equal(c['Check-ins'].text, '▼ 50% vs 2024');
  assert.equal(c['Avg ABV'].text, 'Strongest: Tripel · Brewery R · 9.0%', 'prior window has no valid ABV');
});

test('SC14: the current year labels its deltas "to date"', () => {
  const y = new Date().getFullYear();
  const log = [sc('n1', 'A', 'B', '5', 'Belgian Tripel', `${y - 1}-01-01T00:00`), sc('n2', 'C', 'D', '6', 'Belgian Tripel', `${y}-01-01T00:00`)];
  const a = statsApp(script, log, { year: y });
  a.run('analyticsCompare = true; renderAnalytics()');
  assert.equal(subs(a.html)['Check-ins'].text, `0% vs ${y - 1} to date`);
});

test('SC18: names sit in their own truncating span; label and count never shrink', () => {
  const html = statsApp(script, [sc('t', 'Hazy', 'SweetWater Brewing Company', '6', 'Belgian Tripel', '2025-01-01T12:00')], { year: 2025 }).html;
  assert.match(html, /<span>Top: <\/span><span class="sup-name">SweetWater Brewing Company<\/span><span> · 1<\/span>/);
  assert.match(style, /\.stat-sup > \.sup-name \{ white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; flex-shrink: 1; \}/);
  assert.match(style, /\.stat-sup > span \{ white-space: pre; flex-shrink: 0; \}/);
  assert.match(style, /\.stat-card \{[^}]*min-width: 0;/);
});

test('SC18: names are escaped', () => {
  const html = statsApp(script, [sc('t', '<b>x</b>', 'Brew & Co', '6', 'Belgian Tripel', '2025-01-01T12:00')], { year: 2025 }).html;
  assert.match(html, /Brew &amp; Co/);
  assert.doesNotMatch(html, /<b>x<\/b>/);
});
