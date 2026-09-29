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
    enterHistory: render('history'), enterAnalytics: render('analytics'),
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
//
// Stand-ins: #analyticsInner is a markup string (inner.writes counts full
// rebuilds); any other id present in that markup resolves to a fake element;
// Chart records every chart made; requestAnimationFrame queues until flush().
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
    renderWishlist: stub('renderWishlist'), renderProfile: stub('renderProfile'),
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
// A card's contents with the wrapper stripped and whitespace collapsed:
// title, sub, then body — comparable across the old and new markup.
const contents = card => {
  const t = card.match(/class="chart-title">([\s\S]*?)<\/(?:div|span)>/), s = card.match(/class="chart-sub">([\s\S]*?)<\/(?:div|span)>/);
  if (!t) return card.replace(/\s+/g, ' ').trim();
  const bodyStart = card.includes('class="card-body"') ? card.indexOf('>', card.indexOf('class="card-body"')) + 1 : s.index + s[0].length;
  let body = card.slice(bodyStart).replace(/\s*<\/div>\s*$/, '');
  if (card.includes('class="card-body"')) body = body.replace(/\s*<\/div>\s*$/, '');
  return [t[1], s[1], body].map(x => x.replace(/\s+/g, ' ').trim()).join(' | ');
};

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

test('ST5/ST7: every card\'s title, sub and contents match the branch base — only order and wrapper changed', { skip: baseScript() ? false : 'git history not available' }, () => {
  for (const year of ['all', 2026]) {
    const before = cardsOf(statsApp(baseScript(), richLog(), { year }).html).map(contents);
    const after = cardsOf(statsApp(script, richLog(), { year }).html).map(contents);
    assert.equal(after.length, before.length, `${year}: same number of cards`);
    assert.deepEqual([...after].sort(), [...before].sort(), `${year}: same contents`);
  }
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

// ── Byte-identical preservation against the branch base ─────────
const ST_ALLOWED = {
  switchTab: 'ST1/ST2 per-page scroll + restore after render; ST10 enterAnalytics()',
  enterHistory: 'ST1 scroll restore moves to switchTab',
  applyHistorySearch: 'ST1 off-tab pause writes tabScroll.history',
  handleImport: 'ST1 HL7 reset writes tabScroll.history',
  renderAnalytics: 'ST5 card order; ST7 statsCard(); ST11 per-card chart builders',
  buildBandCard: 'ST7 statsCard()',
  save: 'ST10 marks Stats dirty',
  setNvrField: 'ST14 refreshAnalytics() keeps the position',
  toggleAnalyticsCompare: 'ST4 jump to top',
  setAnalyticsYear: 'ST4 jump to top',
  refreshAfterPull: 'ST10 refreshAnalytics() keeps the position',
};

test('functions outside the workplan are byte-identical to the branch base', { skip: baseScript() ? false : 'git history not available' }, () => {
  const before = allFunctions(baseScript());
  const now = allFunctions(script);
  assert.deepEqual(Object.keys(before).filter(n => !(n in now)), [], 'no function removed');
  const changed = Object.keys(before).filter(n => before[n] !== now[n]);
  assert.deepEqual(changed.filter(n => !(n in ST_ALLOWED)), [], 'changed without a listed reason');
  assert.deepEqual(Object.keys(ST_ALLOWED).filter(n => !changed.includes(n)), [], 'listed but unchanged');
});
