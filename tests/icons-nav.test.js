#!/usr/bin/env node
// Line icons + bottom nav (ICONS_NAV_WORKPLAN.md IA-T1–IA-T8). Run:
//   node --test tests/icons-nav.test.js
//
// Real-source-pulled: functions and consts are extracted verbatim from the
// inline <script> in index.html and run in a sandbox with a minimal fake DOM.
// IA-T4 also runs the pre-change build from git history (needs the history).

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { execFileSync } = require('child_process');

const { ROOT, html, script, inlineScript, extractFunction, extractFunctionFrom } = require('./helpers');

// The last build before the icons + nav work (main at the start of the branch).
const PRE_ICONS = 'ff3644e';

// Multi-line top-level consts (extractConst only handles single-line ones).
function constFrom(src, name) {
  const m = src.match(new RegExp(`^const ${name} = [\\s\\S]*?;\\n`, 'm'));
  if (!m) throw new Error(`const ${name} not found`);
  return m[0];
}
const iconRuntime = () => constFrom(script, 'ICON_PATHS') + extractFunction('icon');

// Minimal element: classList, attributes, innerHTML, and a lastChild that
// stands in for the <span></span> an innerHTML write ends with.
function fakeEl(props = {}) {
  const classes = new Set(props.classes || []);
  const attrs = new Map(Object.entries(props.attrs || {}));
  let markup = '';
  return {
    id: props.id || '', tagName: props.tagName || 'DIV', type: props.type, dataset: props.dataset || {},
    isContentEditable: !!props.isContentEditable, lastChild: null,
    get innerHTML() { return markup; },
    set innerHTML(v) { markup = v; this.lastChild = /<span><\/span>$/.test(v) ? { textContent: '' } : null; },
    classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c) },
    setAttribute: (k, v) => attrs.set(k, String(v)), removeAttribute: k => attrs.delete(k), getAttribute: k => (attrs.has(k) ? attrs.get(k) : null),
  };
}

// ── IA-T1 icon() ────────────────────────────────────────────────

test('IA-T1: icon() returns an SVG at the requested size and stroke width', () => {
  const ctx = vm.createContext({ console });
  vm.runInContext(iconRuntime(), ctx);
  const svg = ctx.icon('stats', 19, 2.3);
  assert.match(svg, /^<svg class="ico" width="19" height="19" viewBox="0 0 20 20"/);
  assert.match(svg, / stroke-width="2.3" /);
  assert.match(ctx.icon('checkin'), /width="20" height="20".* stroke-width="2.2" /, 'defaults are 20 / 2.2');
});

test('IA-T1: per-path stroke widths in print and beers survive any weight', () => {
  const ctx = vm.createContext({ console });
  vm.runInContext(iconRuntime(), ctx);
  const print = ctx.icon('print', 19, 2.3);
  assert.match(print, /<svg[^>]* stroke-width="2.3"/);
  assert.match(print, /<path[^>]* stroke-width="1.3"/);
  assert.match(ctx.icon('beers', 20, 2.6), /<path[^>]* stroke-width="1.6"/);
});

// ── IA-T2 hydrateIcons() ────────────────────────────────────────

test('IA-T2: after hydrateIcons(), every static [data-icon] slot holds an <svg>', () => {
  const slots = [...html.matchAll(/data-icon="([^"]+)"(?: data-icon-size="([^"]+)")?(?: data-icon-weight="([^"]+)")?/g)]
    .map(m => fakeEl({ dataset: { icon: m[1], ...(m[2] && { iconSize: m[2] }), ...(m[3] && { iconWeight: m[3] }) } }));
  assert.ok(slots.length >= 17, `expected the inventory's static slots, found ${slots.length}`);
  const ctx = vm.createContext({ console, document: { querySelectorAll: sel => (sel === '[data-icon]' ? slots : []) } });
  vm.runInContext(iconRuntime() + extractFunction('hydrateIcons'), ctx);
  ctx.hydrateIcons();
  for (const el of slots) {
    assert.match(el.innerHTML, /^<svg [\s\S]+<\/svg>$/, `slot ${el.dataset.icon} is empty`);
    if (el.dataset.iconSize) assert.match(el.innerHTML, new RegExp(`width="${el.dataset.iconSize}"`));
  }
});

// ── IA-T3 / IA-T4 milestones + analytics context ────────────────

function analyticsSandbox(src) {
  const ctx = vm.createContext({ console, Math, JSON, Date });
  vm.runInContext([
    ...['MS_CHECKIN_STEPS', 'MS_BREWERY_STEPS', 'MS_STYLE_STEPS', 'RATING_BANDS'].map(n => constFrom(src, n)),
    ...['computeMilestones', 'computeAnalyticsContext', 'firstOccurrenceIds', 'computeBandAnalytics', 'bandOf'].map(n => extractFunctionFrom(src, n)),
    'var entries = [];',
  ].join('\n'), ctx);
  return ctx;
}

// n entries, half last year and half this year. brewery/style ids repeat on the
// given cycle, or (late) only turn new in the second half so their milestones
// land inside the year.
function fixture(n, { breweries = 5, styles = 5, late } = {}, year = 2025) {
  return Array.from({ length: n }, (_, i) => ({
    id: 'e' + i, beer_name: 'B' + i,
    brewery_name: late === 'brewery' ? (i >= n / 2 ? 'Br' + i : 'Br0') : 'Br' + (i % breweries),
    beer_type: late === 'style' ? (i >= n / 2 ? 'S' + i : 'S0') : 'S' + (i % styles),
    created_at: new Date(Date.UTC(i < n / 2 ? year - 1 : year, i % 12, 1 + (i % 27))).toISOString(),
    rating: (i * 7) % 101, occasion: 'home-solo',
  }));
}
const FIXTURES = {
  checkins: fixture(260, { breweries: 60, styles: 30 }),
  breweries: fixture(80, { late: 'brewery' }),
  styles: fixture(80, { late: 'style' }),
  none: fixture(40),
};

test('IA-T3: computeMilestones gives every item a valid kind and no emoji icon field', () => {
  const ctx = analyticsSandbox(script);
  const seen = new Set();
  for (const es of Object.values(FIXTURES)) {
    ctx.entries = es;
    for (const m of ctx.computeMilestones()) {
      assert.ok(['checkins', 'breweries', 'styles'].includes(m.kind), `bad kind ${m.kind}`);
      assert.equal('icon' in m, false);
      seen.add(m.kind);
    }
  }
  assert.deepEqual([...seen].sort(), ['breweries', 'checkins', 'styles']);
});

let preScript = null;
try {
  preScript = inlineScript(execFileSync('git', ['show', `${PRE_ICONS}:index.html`], { cwd: ROOT, encoding: 'utf8' }));
} catch (e) { /* no history: IA-T4 skips */ }

test('IA-T4: computeAnalyticsContext output matches the pre-change build', { skip: preScript ? false : 'git history not available' }, () => {
  const before = analyticsSandbox(preScript), now = analyticsSandbox(script);
  const kinds = new Set();
  for (const [name, es] of Object.entries(FIXTURES)) {
    for (const year of [2025, 'all']) {
      for (const compare of [false, true]) {
        before.entries = es; now.entries = es;
        const a = JSON.stringify(before.computeAnalyticsContext(es, [], year, compare));
        const b = now.computeAnalyticsContext(es, [], year, compare);
        assert.equal(JSON.stringify(b), a, `${name} / ${year} / compare=${compare}`);
        if (b.milestone) kinds.add(b.milestone.kind);
      }
    }
  }
  assert.deepEqual([...kinds].sort(), ['breweries', 'checkins', 'styles'], 'fixtures reach every milestone kind');
});

// ── IA-T5 showToast ─────────────────────────────────────────────

test('IA-T5: showToast renders one icon plus the message as literal text', () => {
  const toast = fakeEl({ id: 'toast' });
  const ctx = vm.createContext({ console, document: { getElementById: id => (id === 'toast' ? toast : null) }, setTimeout: () => 0 });
  vm.runInContext(iconRuntime() + extractFunction('showToast'), ctx);
  ctx.showToast('<b>x</b>', 'warning');
  assert.equal((toast.innerHTML.match(/<svg/g) || []).length, 1);
  assert.equal(toast.innerHTML.includes('<b>'), false, 'message never goes through innerHTML');
  assert.equal(toast.lastChild.textContent, '<b>x</b>');
  assert.ok(toast.classList.contains('show'));
  ctx.showToast('plain');
  assert.equal(/<svg/.test(toast.innerHTML), false, 'no icon when iconName is omitted');
});

// ── IA-T6 switchTab + nav markup ────────────────────────────────

const navMarkup = html.match(/<nav class="bottom-nav"[^>]*>([\s\S]*?)<\/nav>/)[1];
const TAB_KEYS = ['checkin', 'history', 'analytics', 'profile', 'discover'];

function navSandbox() {
  const items = [...navMarkup.matchAll(/<button class="bn-item( active)?" id="([^"]+)"[^>]*?( aria-current="page")?>/g)]
    .map(m => fakeEl({ id: m[2], classes: ['bn-item', ...(m[1] ? ['active'] : [])], attrs: m[3] ? { 'aria-current': 'page' } : {} }));
  const screens = TAB_KEYS.map(k => fakeEl({ id: 'screen-' + k, classes: ['screen'] }));
  const byId = Object.fromEntries([...items, ...screens].map(e => [e.id, e]));
  const ctx = vm.createContext({
    console, items, window: { scrollY: 0 },
    document: { getElementById: id => byId[id] || null, querySelectorAll: sel => (sel === '.bn-item' ? items : sel === '.screen' ? screens : []) },
  });
  vm.runInContext([
    'var currentTab = "checkin";',
    'function enterHistory() {} function renderAnalytics() {} function renderProfile() {} function renderWishlist() {}',
    extractFunction('switchTab'),
  ].join('\n'), ctx);
  return ctx;
}

test('IA-T6: the nav markup has five button items, Check In active and current', () => {
  const s = navSandbox();
  assert.deepEqual(s.items.map(i => i.id), TAB_KEYS.map(k => 'tab-' + k));
  assert.deepEqual(s.items.filter(i => i.classList.contains('active')).map(i => i.id), ['tab-checkin']);
  assert.deepEqual(s.items.filter(i => i.getAttribute('aria-current') === 'page').map(i => i.id), ['tab-checkin']);
  assert.deepEqual([...navMarkup.matchAll(/<span>([^<]+)<\/span><\/button>/g)].map(m => m[1]), ['Check In', 'Beers', 'Stats', 'Print', 'Discover']);
});

test('IA-T6: switchTab(k) leaves exactly one active item and one aria-current, both k', () => {
  const s = navSandbox();
  for (const k of [...TAB_KEYS, 'checkin']) {
    s.switchTab(k);
    assert.deepEqual(s.items.filter(i => i.classList.contains('active')).map(i => i.id), ['tab-' + k]);
    assert.deepEqual(s.items.filter(i => i.getAttribute('aria-current') !== null).map(i => i.id), ['tab-' + k]);
    assert.equal(s.items.find(i => i.id === 'tab-' + k).getAttribute('aria-current'), 'page');
  }
});

// ── IA-T7 keyboard hide ─────────────────────────────────────────

function focusSandbox() {
  const start = script.indexOf('const NON_TEXT_INPUT_TYPES');
  const end = script.indexOf('\n});\n', script.indexOf("document.addEventListener('focusout'")) + 5;
  const handlers = {}, timers = [], removals = [];
  const bodyEl = fakeEl({ tagName: 'BODY' });
  const origRemove = bodyEl.classList.remove;
  bodyEl.classList.remove = c => { removals.push(c); origRemove(c); };
  const ctx = vm.createContext({
    console, timers, removals,
    document: { body: bodyEl, activeElement: bodyEl, addEventListener: (t, fn) => { handlers[t] = fn; } },
    setTimeout: fn => timers.push(fn),
  });
  vm.runInContext(script.slice(start, end), ctx);
  const flush = () => { while (timers.length) timers.shift()(); };
  const focus = el => {                          // browser order: focusout (activeElement = body), focusin, then settle
    if (ctx.document.activeElement !== bodyEl) { const prev = ctx.document.activeElement; ctx.document.activeElement = bodyEl; handlers.focusout({ target: prev }); }
    ctx.document.activeElement = el; handlers.focusin({ target: el });
  };
  const blur = () => { const prev = ctx.document.activeElement; ctx.document.activeElement = bodyEl; handlers.focusout({ target: prev }); };
  return { ctx, focus, blur, flush, on: () => bodyEl.classList.contains('input-focused') };
}
const input = type => fakeEl({ tagName: 'INPUT', type });

test('IA-T7: focusing a text input sets body.input-focused; a range slider does not', () => {
  const f = focusSandbox();
  f.focus(input('text')); f.flush();
  assert.equal(f.on(), true);
  const g = focusSandbox();
  g.focus(input('range')); g.flush();
  assert.equal(g.on(), false);
  for (const type of ['checkbox', 'radio', 'button', 'submit', 'file']) {
    const h = focusSandbox(); h.focus(input(type)); h.flush();
    assert.equal(h.on(), false, type);
  }
  for (const el of [fakeEl({ tagName: 'TEXTAREA' }), fakeEl({ tagName: 'SELECT' }), fakeEl({ isContentEditable: true }), input('email')]) {
    const h = focusSandbox(); h.focus(el); h.flush();
    assert.equal(h.on(), true, el.tagName);
  }
});

test('IA-T7: blurring clears it; moving between two text inputs never clears it', () => {
  const f = focusSandbox();
  f.focus(input('text')); f.flush();
  f.ctx.removals.length = 0;
  f.focus(input('text')); f.flush();
  f.focus(fakeEl({ tagName: 'TEXTAREA' })); f.flush();
  assert.equal(f.on(), true);
  assert.deepEqual([...f.ctx.removals], [], 'class was never removed in between');
  f.blur(); f.flush();
  assert.equal(f.on(), false);
  f.focus(input('text')); f.flush();
  f.focus(input('range')); f.flush();
  assert.equal(f.on(), false, 'moving to a slider clears it');
});

// ── IA-T8 naming ────────────────────────────────────────────────

test('IA-T8: the fourth welcome row and TAB_LABELS.profile read "Your Hopprint"; the key stays profile', () => {
  const rows = [...html.matchAll(/<div class="welcome-tab-row">[\s\S]*?<strong>([^<]+)<\/strong>/g)].map(m => m[1]);
  assert.equal(rows[3], 'Your Hopprint');
  const ctx = vm.createContext({});
  vm.runInContext(constFrom(script, 'TAB_LABELS') + 'this.TAB_LABELS = TAB_LABELS;', ctx);
  assert.equal(ctx.TAB_LABELS.profile, 'Your Hopprint');
  const s = navSandbox();
  s.switchTab('profile');
  assert.equal(vm.runInContext('currentTab', s), 'profile');
  assert.match(navMarkup, /id="tab-profile" onclick="switchTab\('profile'\)"/);
});
