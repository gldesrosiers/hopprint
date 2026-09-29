#!/usr/bin/env node
// Print page rebuild caching (PRINT_WORKPLAN.md PT1–PT7). Run:
//   node --test tests/print-page.test.js
//
// Real-source-pulled: renderProfile() and everything it touches are extracted
// verbatim from index.html (style_matrix.js is loaded as the page loads it),
// resolved on demand from ReferenceErrors so no helper is listed by hand.
// Stand-ins: #profileInner is a markup string (writes counts rebuilds), the
// clock is settable, and a write to the visible page clamps the scroll.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const nodeCrypto = require('crypto');
const { execFileSync } = require('child_process');
const vm = require('vm');

const { ROOT, script, inlineScript, extractFunctionFrom, allFunctions } = require('./helpers');

// main at the start of the print-cache branch.
const BRANCH_BASE = '217c18f';
const TABS = ['checkin', 'history', 'analytics', 'profile', 'discover'];
const STYLE_MATRIX_JS = fs.readFileSync(path.join(ROOT, 'style_matrix.js'), 'utf8');

// Reached only after the first render (tab switches, pulls, imports), so the
// render-time resolution never sees them.
const LATE = ['enterProfile', 'refreshProfile', 'switchTab', 'save', 'refreshAfterPull', 'handleImport', 'newId',
  'restoreScroll', 'localDateKey', 'currentTab', 'tabScroll', 'historyDirty', 'statsDirty', 'historyLoaded', 'historyPreSearch'];

let resolved = null;
function pullFrom(src, name) {
  try { return extractFunctionFrom(src, name); } catch (e) {
    const m = src.match(new RegExp(`^(?:const|let) ${name} = [^\\n]*;(?:[ \\t]*//[^\\n]*)?$`, 'm'))
      || src.match(new RegExp(`^(?:const|let) ${name} = [\\s\\S]*?;\\n`, 'm'));
    if (!m) throw new Error(`cannot resolve ${name}`);
    return m[0];
  }
}

// A fresh app on Check In with the given log, the clock at `now`.
function printApp(entries, { now = '2026-09-28T12:00:00' } = {}) {
  const clock = { now: new Date(now).getTime() };
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...args) { if (args.length) super(...args); else super(clock.now); }
    static now() { return clock.now; }
  }
  let markup = '';
  const win = { scrollY: 0, scrolls: [], scrollTo(o) { this.scrolls.push({ ...o }); this.scrollY = o.top; } };
  const inner = {
    writes: 0,
    get innerHTML() { return markup; },
    set innerHTML(v) { markup = v; inner.writes++; if (els['screen-profile'].classList.contains('active')) win.scrollY = 0; },
  };
  const els = {};
  for (const t of TABS) {
    for (const id of [`tab-${t}`, `screen-${t}`]) {
      const classes = new Set();
      els[id] = { classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c) }, setAttribute() {}, removeAttribute() {} };
    }
  }
  els['screen-checkin'].classList.add('active');
  const stubs = [];
  const stub = name => () => { stubs.push(name); };
  const makeCtx = () => vm.createContext({
    console, entries, Date: FakeDate,
    document: {
      getElementById: id => (id === 'profileInner' ? inner : els[id] || null),
      querySelectorAll: sel => (sel === '.bn-item' ? TABS.map(t => els[`tab-${t}`]) : sel === '.screen' ? TABS.map(t => els[`screen-${t}`]) : []),
      documentElement: {},
    },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    window: win,
    localStorage: { setItem() {} },
    crypto: nodeCrypto.webcrypto,
    FileReader: function () { this.readAsText = () => this.onload({ target: { result: ctx.csv } }); },
    // Other pages and side effects a tab switch, pull or import touches.
    enterHistory: stub('enterHistory'), enterAnalytics: stub('enterAnalytics'), renderWishlist: stub('renderWishlist'),
    refreshHistory: stub('refreshHistory'), refreshAnalytics: stub('refreshAnalytics'),
    buildLiveLists: stub('buildLiveLists'), updateHeaderMeta: stub('updateHeaderMeta'), showToast: stub('showToast'),
    queueSyncMany: stub('queueSyncMany'), upsertBeerDB() {}, upsertBreweryDB() {},
  });
  let ctx;
  const code = resolved ? [...resolved] : [pullFrom(script, 'renderProfile'), ...LATE.map(n => pullFrom(script, n))];
  const have = new Set(code.map(c => c.match(/^(?:async\s+)?(?:function|const|let)\s+(\w+)/)[1]));
  for (let i = 0; i < 80; i++) {
    ctx = makeCtx();
    try {
      vm.runInContext(STYLE_MATRIX_JS, ctx);
      vm.runInContext(code.join('\n'), ctx);
      // Resolve against a full page (the <10 empty state returns early and
      // would leave helpers unresolved), then back to the app-load state.
      ctx.fullLog = log(120);
      vm.runInContext('{ const own = entries; entries = fullLog; renderProfile(); entries = own; } profileDirty = true; profileDay = "";', ctx);
      break;
    } catch (e) {
      const m = String(e).match(/ReferenceError: (\w+) is not defined/);
      if (!m || have.has(m[1])) throw e;
      have.add(m[1]); code.unshift(pullFrom(script, m[1]));
    }
  }
  resolved = code;
  markup = ''; inner.writes = 0;
  const run = js => vm.runInContext(js, ctx);
  const setNow = iso => { clock.now = new Date(iso).getTime(); };
  return { ctx, run, inner, win, stubs, setNow, get html() { return markup; } };
}

// n entries spread over the two years before 2026-09-28.
function log(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `id-${i}`, beer_name: `Beer ${i % 50}`, brewery_name: `Brewery ${i % 20}`, brewery_state: ['VT', 'ME', 'NY'][i % 3],
    beer_type: ['IPA - American', 'Stout - Imperial', 'Lager - Pilsner', 'Sour - Gose'][i % 4], serving_type: 'Draft',
    beer_abv: String(4 + (i % 50) / 10), venue_name: `Bar ${i % 6}`, comment: i % 3 ? 'nice' : '', rating: i % 2 ? 80 : null,
    created_at: new Date(Date.UTC(2024, 9, 1) + i * 86400e3 * (720 / Math.max(n, 1))).toISOString().slice(0, 16),
  }));
}

// Print open, scrolled to 600.
function onPrint(entries = log(120), opts) {
  const a = printApp(entries, opts);
  a.run(`switchTab('profile')`);
  a.win.scrollY = 600;
  return a;
}

// ── PT1 / PT2 ───────────────────────────────────────────────────
test('PT1: the flag starts set, so the first visit builds', () => {
  const a = printApp(log(120));
  assert.equal(a.run('profileDirty'), true);
  a.run(`switchTab('profile')`);
  assert.equal(a.inner.writes, 1);
  assert.match(a.html, /YOUR HOPPRINT/);
  assert.equal(a.run('profileDirty'), false);
  assert.equal(a.run('profileDay'), '2026-09-28');
});

test('PT1/PT2: coming back with no writes reuses the page and restores the scroll', () => {
  const a = onPrint();
  const html = a.html;
  a.run(`switchTab('analytics')`);
  a.win.scrollY = 2000;
  a.run(`switchTab('profile')`);
  assert.equal(a.inner.writes, 1, 'no rebuild');
  assert.equal(a.html, html);
  assert.equal(a.win.scrollY, 600);
});

test('PT1: after save(), the next visit rebuilds with the new numbers, scroll restored', () => {
  const a = onPrint();
  a.run(`switchTab('checkin')`);
  a.run(`entries.push({ id: 'new', beer_name: 'New', brewery_name: 'Brand New Brewery', beer_type: 'IPA - American', created_at: '2026-09-28T11:00' }); save()`);
  assert.equal(a.run('profileDirty'), true);
  a.run(`switchTab('profile')`);
  assert.equal(a.inner.writes, 2);
  assert.match(a.html, /<div class="pstat-num">121<\/div><div class="pstat-label">Check-ins<\/div>/);
  assert.equal(a.win.scrollY, 600);
});

test('PT2: re-tapping Print jumps to the top without a rebuild', () => {
  const a = onPrint();
  a.run(`switchTab('profile')`);
  assert.equal(a.inner.writes, 1);
  assert.equal(a.win.scrollY, 0);
});

test('PT1: the fewer-than-10 empty state still renders, and saves turn it into the full page', () => {
  const a = printApp(log(4));
  a.run(`switchTab('profile')`);
  assert.match(a.html, /Log at least 10 beers to unlock your flavor profile\.\n4\/10 so far/);
  a.run(`switchTab('checkin')`);
  a.run(`entries.push(...${JSON.stringify(log(10).slice(4))}); save()`);
  a.run(`switchTab('profile')`);
  assert.match(a.html, /YOUR HOPPRINT/);
});

// ── PT3 pull ────────────────────────────────────────────────────
test('PT3: a pull while on Print rebuilds in place and keeps the position', () => {
  const a = onPrint();
  a.run(`save(); refreshAfterPull()`);
  assert.equal(a.inner.writes, 2);
  assert.equal(a.win.scrollY, 600, 'restored after the rebuild clamped it');
});

test('PT3: a pull elsewhere waits for the next Print visit', () => {
  const a = onPrint();
  a.run(`switchTab('discover')`);
  a.run(`save(); refreshAfterPull()`);
  assert.equal(a.inner.writes, 1, 'nothing renders off Print');
  a.run(`switchTab('profile')`);
  assert.equal(a.inner.writes, 2);
});

// ── PT5 date change ─────────────────────────────────────────────
test('PT5: the same day reuses the page; a new day rebuilds even with no writes', () => {
  const a = onPrint();
  a.run(`switchTab('checkin')`);
  a.setNow('2026-09-28T23:59:00');
  a.run(`switchTab('profile')`);
  assert.equal(a.inner.writes, 1, 'same day');
  a.run(`switchTab('checkin')`);
  a.setNow('2026-09-29T00:01:00');
  a.run(`switchTab('profile')`);
  assert.equal(a.inner.writes, 2, 'new day');
  assert.equal(a.run('profileDay'), '2026-09-29');
  assert.equal(a.win.scrollY, 600);
});

test('PT5: New Year\'s Eve into January 1 rolls "in review" over to the new year', () => {
  const entries = [...log(40), ...Array.from({ length: 6 }, (_, i) => ({
    id: `dec-${i}`, beer_name: `Dec ${i}`, brewery_name: 'Winter', beer_type: 'Stout - Imperial', created_at: `2026-12-0${i + 1}T20:00`,
  }))];
  const a = printApp(entries, { now: '2026-12-31T22:00:00' });
  a.run(`switchTab('profile')`);
  assert.match(a.html, /2026 IN REVIEW/);
  a.run(`switchTab('checkin')`);
  a.setNow('2027-01-01T00:30:00');
  a.run(`switchTab('profile')`);
  assert.equal(a.inner.writes, 2);
  assert.doesNotMatch(a.html, /2026 IN REVIEW/, 'no 2027 check-ins yet, so no stale 2026 card either');
});

// ── PT6 import ──────────────────────────────────────────────────
test('PT6: an import on Print redraws it in place and keeps the position', () => {
  const a = onPrint(log(4));
  assert.match(a.html, /4\/10 so far/);
  a.run(`csv = ${JSON.stringify(['beer_name,brewery_name,beer_type,created_at',
    ...Array.from({ length: 12 }, (_, i) => `Imported ${i},Import Co,IPA - American,2025-0${1 + (i % 9)}-1${i % 9} 12:00:00`)].join('\n'))}`);
  a.run(`handleImport({ target: { files: [{}], value: 'x' } })`);
  assert.equal(a.inner.writes, 2);
  assert.match(a.html, /YOUR HOPPRINT/, 'the empty state became the full page');
  assert.equal(a.win.scrollY, 600);
  assert.equal(a.run('profileDirty'), false);
});

test('PT6: an import made while Print is not showing only marks it dirty', () => {
  const a = onPrint(log(4));
  a.run(`switchTab('checkin')`);
  a.run(`csv = 'beer_name,brewery_name,created_at\\nOne,Co,2025-03-01 12:00:00'`);
  a.run(`handleImport({ target: { files: [{}], value: 'x' } })`);
  assert.equal(a.inner.writes, 1);
  assert.equal(a.run('profileDirty'), true);
});

// ── PT7 fade ────────────────────────────────────────────────────
test('PT7: a rebuilt Print keeps its fade-up cards', () => {
  const a = onPrint();
  a.run(`save(); refreshAfterPull()`);
  assert.match(a.html, /<div class="profile-hero fade-up">/);
  assert.match(a.html, /<div class="chart-card fade-up">\s*<div class="chart-title">Taste Trends/);
});

// ── Byte-identical preservation against the branch base ─────────
// Retire after merge (as with history-perf and stats-page).
const PT_ALLOWED = {
  save: 'PT1 marks Print dirty',
  renderProfile: 'PT1/PT5 clears dirty, records the build date',
  switchTab: 'PT2 enterProfile()',
  refreshAfterPull: 'PT3 refreshProfile()',
  handleImport: 'PT6 refreshProfile()',
};

let baseScript;
try {
  baseScript = inlineScript(execFileSync('git', ['show', `${BRANCH_BASE}:index.html`], { cwd: ROOT, encoding: 'utf8' }));
} catch (e) {
  baseScript = null;
}

test('functions outside the workplan are byte-identical to the branch base', { skip: baseScript ? false : 'git history not available' }, () => {
  const before = allFunctions(baseScript);
  const now = allFunctions(script);
  assert.deepEqual(Object.keys(before).filter(n => !(n in now)), [], 'no function removed');
  const changed = Object.keys(before).filter(n => before[n] !== now[n]);
  assert.deepEqual(changed.filter(n => !(n in PT_ALLOWED)), [], 'changed without a listed reason');
  assert.deepEqual(Object.keys(PT_ALLOWED).filter(n => !changed.includes(n)), [], 'listed but unchanged');
});
