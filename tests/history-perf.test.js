#!/usr/bin/env node
// My Beers list performance + escaping (HISTORY_PERF_WORKPLAN.md HL1–HL11). Run:
//   node --test tests/history-perf.test.js
//
// Real-source-pulled: renderHistory() and everything it calls are extracted
// verbatim from index.html and run against a fake #historyList.

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const vm = require('vm');

const { ROOT, script, inlineScript, extractFunction, allFunctions } = require('./helpers');

// main at the start of the history-perf branch.
const BRANCH_BASE = 'f337221';

// Multi-line top-level consts (extractConst only handles single-line ones).
function constFrom(src, name) {
  const m = src.match(new RegExp(`^const ${name} = [\\s\\S]*?;\\n`, 'm'));
  if (!m) throw new Error(`const ${name} not found`);
  return m[0];
}

const SENTINEL = '<div class="history-sentinel" id="historySentinel" aria-hidden="true"></div>';

// A fresh app with the given entries and an empty My Beers screen. The list is
// a markup string; #historySentinel exists while that string contains it.
// `io` is a hand-driven IntersectionObserver: io.fire() reports every watched
// target as intersecting.
function app(entries, { query = '', observer = true } = {}) {
  const els = {
    historySearch: { value: query },
    historyList: { innerHTML: '' },
  };
  const sentinel = {
    insertAdjacentHTML(pos, markup) {
      assert.equal(pos, 'beforebegin');
      els.historyList.innerHTML = els.historyList.innerHTML.replace(SENTINEL, () => markup + SENTINEL);
    },
    remove() { els.historyList.innerHTML = els.historyList.innerHTML.replace(SENTINEL, ''); },
  };
  const io = { created: 0, observes: 0, watching: new Set(), options: null, callback: null,
    fire() { this.callback([...this.watching].map(target => ({ target, isIntersecting: true }))); } };
  class FakeIntersectionObserver {
    constructor(cb, options) { io.created++; io.callback = cb; io.options = options; }
    observe(t) { io.observes++; io.watching.add(t); }
    unobserve(t) { io.watching.delete(t); }
    disconnect() { io.watching.clear(); }
  }
  const ctx = vm.createContext({
    console,
    entries,
    ...(observer && { IntersectionObserver: FakeIntersectionObserver }),
    document: { getElementById: id => (id === 'historySentinel'
      ? (els.historyList.innerHTML.includes(SENTINEL) ? sentinel : null)
      : els[id] || null) },
  });
  vm.runInContext([
    constFrom(script, 'ICON_PATHS'),
    constFrom(script, 'OCCASIONS'),
    constFrom(script, 'RATING_BANDS'),
    ...historyState(),
    ...['icon', 'idArg', 'esc', ...HISTORY_FNS].map(extractFunction),
  ].join('\n'), ctx);
  const get = name => vm.runInContext(name, ctx);
  return { ctx, els, get, io, sentinel };
}

// The My Beers module state (HISTORY_BATCH + the history* lets), verbatim.
const historyState = () => [...script.matchAll(/^(?:const HISTORY_BATCH|let history\w+) = [^\n]*;/gm)].map(m => m[0]);
const HISTORY_FNS = ['historyTime', 'historySentinel', 'historyCard', 'renderHistory', 'appendHistoryBatch', 'watchHistorySentinel'];

// Rendered cards, in DOM order, by beer name.
const cards = html => [...html.matchAll(/<div class="entry-beer">([^<]*)<\/div>/g)].map(m => m[1]);
// n entries, stored oldest first so array order is the opposite of display order.
const log = n => Array.from({ length: n }, (_, i) => entry(i));

const entry = (i, extra = {}) => ({
  id: `id-${i}`, beer_name: `Beer ${i}`, brewery_name: `Brewery ${i}`,
  created_at: new Date(Date.UTC(2026, 0, 1) + i * 3600e3).toISOString(), ...extra,
});

// Text a browser would show for a fragment: strip tags, decode the entities esc() emits.
const shown = s => s.replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

// ── HL11 escaping ───────────────────────────────────────────────
test('HL11: user text with " \' < & renders as literal text on a card', () => {
  const nasty = `Tom's "Big" <b>Hops</b> & R&lt;D`;
  const { ctx, els } = app([entry(1, {
    beer_name: nasty, brewery_name: nasty, brewery_city: nasty, brewery_state: 'ST',
    beer_type: nasty, serving_type: nasty, beer_abv: '6.5', venue_name: nasty,
    purchase_venue: nasty, comment: nasty,
  })]);
  ctx.renderHistory();
  const html = els.historyList.innerHTML;
  assert.doesNotMatch(html, /<b>Hops<\/b>/, 'no raw user markup reaches the DOM');
  for (const cls of ['entry-beer', 'entry-brewery', 'etag style', 'etag serve', 'entry-notes-preview']) {
    const m = html.match(new RegExp(`<(?:div|span) class="${cls}">([\\s\\S]*?)</(?:div|span)>`));
    assert.ok(m, `${cls} present`);
    assert.ok(shown(m[1]).includes(nasty), `${cls} shows the literal text`);
  }
  assert.ok(shown(html).includes(`${nasty}, ST`), 'city/state');
  assert.ok(shown(html).includes(`· ${nasty}`), 'purchase venue');
  assert.match(html, /6\.5% ABV/);
});

test('HL11: comment is escaped after truncation, so an entity is never split', () => {
  const comment = 'x'.repeat(118) + '&&&&';
  const { ctx, els } = app([entry(1, { comment })]);
  ctx.renderHistory();
  const preview = els.historyList.innerHTML.match(/<div class="entry-notes-preview">([\s\S]*?)<\/div>/)[1];
  assert.equal(shown(preview), `"${'x'.repeat(118)}&&…"`);
  assert.doesNotMatch(preview, /&(?!amp;|quot;|lt;)/, 'every & is a whole entity');
});

test('HL11: esc() handles & first, falsy → empty, numbers → text', () => {
  const { ctx } = app([]);
  assert.equal(ctx.esc('a & "b" <c>'), 'a &amp; &quot;b&quot; &lt;c>');
  assert.equal(ctx.esc('&lt;'), '&amp;lt;');
  assert.equal(ctx.esc(undefined), '');
  assert.equal(ctx.esc(null), '');
  assert.equal(ctx.esc(6.5), '6.5');
});

// ── HL2 / HL9 batching and sort ─────────────────────────────────
test('HL2: initial render shows exactly one batch of 50, newest first, with a sentinel', () => {
  const { ctx, els, get } = app(log(130));
  ctx.renderHistory();
  const names = cards(els.historyList.innerHTML);
  assert.equal(get('HISTORY_BATCH'), 50);
  assert.equal(names.length, 50);
  assert.deepEqual(names.slice(0, 3), ['Beer 129', 'Beer 128', 'Beer 127']);
  assert.equal(names[49], 'Beer 80');
  assert.equal(get('historyLoaded'), 50);
  assert.equal(get('historyFiltered').length, 130);
  assert.match(els.historyList.innerHTML, /<div class="history-sentinel" id="historySentinel" aria-hidden="true"><\/div>$/);
});

test('HL2: a log smaller than a batch renders every card and no sentinel', () => {
  const { ctx, els, get } = app(log(12));
  ctx.renderHistory();
  assert.equal(cards(els.historyList.innerHTML).length, 12);
  assert.equal(get('historyLoaded'), 12);
  assert.doesNotMatch(els.historyList.innerHTML, /history-sentinel/);
});

test('HL2: exactly one batch renders all 50 with no sentinel', () => {
  const { ctx, els } = app(log(50));
  ctx.renderHistory();
  assert.equal(cards(els.historyList.innerHTML).length, 50);
  assert.doesNotMatch(els.historyList.innerHTML, /history-sentinel/);
});

test('HL2: renderHistory(count) renders up to count, never less than a batch', () => {
  const { ctx, els, get } = app(log(200));
  ctx.renderHistory(150);
  assert.equal(cards(els.historyList.innerHTML).length, 150);
  ctx.renderHistory(10);
  assert.equal(get('historyLoaded'), 50);
  ctx.renderHistory(999);
  assert.equal(get('historyLoaded'), 200);
  assert.doesNotMatch(els.historyList.innerHTML, /history-sentinel/);
});

test('HL2: first-render cards fade up', () => {
  const { ctx, els } = app(log(3));
  ctx.renderHistory();
  assert.equal((els.historyList.innerHTML.match(/class="entry-card fade-up"/g) || []).length, 3);
});

test('empty log and no-match states are unchanged', () => {
  const empty = app([]);
  empty.ctx.renderHistory();
  assert.match(empty.els.historyList.innerHTML, /Your beer log starts here/);
  assert.match(empty.els.historyList.innerHTML, /Log Your First Beer/);
  assert.equal(empty.get('historyLoaded'), 0);
  const none = app(log(5), { query: 'zzz' });
  none.ctx.renderHistory();
  assert.match(none.els.historyList.innerHTML, /No matches found\./);
  assert.doesNotMatch(none.els.historyList.innerHTML, /history-sentinel/);
});

test('search filters the full log, then batches the matches', () => {
  const entries = log(300);
  entries[3].venue_name = 'Taproom';          // old enough to be far past the first batch
  const { ctx, els, get } = app(entries, { query: 'tAPROOM' });
  ctx.renderHistory();
  assert.deepEqual(cards(els.historyList.innerHTML), ['Beer 3']);
  assert.equal(get('historyFiltered').length, 1);
});

test('HL9: an entry whose date was edited to be the newest sorts to the top', () => {
  const entries = log(80).reverse();           // newest first, as stored after a pull
  entries[70].created_at = '2027-03-01T18:30'; // saveEdit writes datetime-local, no re-sort
  const { ctx, els } = app(entries);
  ctx.renderHistory();
  assert.equal(cards(els.historyList.innerHTML)[0], 'Beer 9');
});

test('HL9: undated entries sort last', () => {
  const entries = log(3);
  entries[2].created_at = '';
  const { ctx, get } = app(entries);
  ctx.renderHistory();
  assert.deepEqual(get('historyFiltered').map(e => e.beer_name), ['Beer 1', 'Beer 0', 'Beer 2']);
});

// ── HL3 append on scroll ────────────────────────────────────────
test('HL3: first render watches the sentinel with a lookahead margin', () => {
  const { ctx, io, sentinel } = app(log(130));
  ctx.renderHistory();
  assert.equal(io.created, 1);
  assert.deepEqual([...io.watching], [sentinel]);
  assert.equal(io.options.rootMargin, '0px 0px 800px 0px');
});

test('HL3: appending a batch yields 100 cards, in order, no duplicates, old cards untouched', () => {
  const { ctx, els, get, io } = app(log(130));
  ctx.renderHistory();
  const firstBatch = els.historyList.innerHTML.replace(SENTINEL, '');
  io.fire();
  const names = cards(els.historyList.innerHTML);
  assert.equal(names.length, 100);
  assert.equal(new Set(names).size, 100);
  assert.deepEqual(names, Array.from({ length: 100 }, (_, i) => `Beer ${129 - i}`));
  assert.equal(get('historyLoaded'), 100);
  assert.ok(els.historyList.innerHTML.startsWith(firstBatch), 'first 50 cards are not re-rendered');
  assert.ok(els.historyList.innerHTML.endsWith(SENTINEL), 'sentinel stays last');
  const appended = els.historyList.innerHTML.slice(firstBatch.length);
  assert.equal((appended.match(/class="entry-card fade-up"/g) || []).length, 50, 'appended batch fades up');
});

test('HL3: the last batch removes the sentinel and stops observing', () => {
  const { ctx, els, get, io } = app(log(130));
  ctx.renderHistory();
  io.fire();
  io.fire();
  assert.equal(cards(els.historyList.innerHTML).length, 130);
  assert.equal(get('historyLoaded'), 130);
  assert.doesNotMatch(els.historyList.innerHTML, /history-sentinel/);
  assert.equal(io.watching.size, 0);
  io.fire();                                   // a stray callback is harmless
  assert.equal(cards(els.historyList.innerHTML).length, 130);
});

test('HL3: after an append the sentinel is re-observed, so one still in range fires again', () => {
  const { ctx, io, sentinel } = app(log(200));
  ctx.renderHistory();
  const before = io.observes;
  io.fire();
  assert.equal(io.observes, before + 1);
  assert.deepEqual([...io.watching], [sentinel]);
});

test('HL3: a non-intersecting report loads nothing', () => {
  const { ctx, els, io } = app(log(130));
  ctx.renderHistory();
  io.callback([...io.watching].map(target => ({ target, isIntersecting: false })));
  assert.equal(cards(els.historyList.innerHTML).length, 50);
});

test('HL3: a re-render reuses one observer and watches only the new sentinel', () => {
  const { ctx, io } = app(log(130));
  ctx.renderHistory();
  ctx.renderHistory();
  assert.equal(io.created, 1);
  assert.equal(io.watching.size, 1);
});

test('HL3: a list that fits in one batch, or is empty, watches nothing', () => {
  const small = app(log(10));
  small.ctx.renderHistory();
  assert.equal(small.io.watching.size, 0);
  const big = app(log(130), { query: 'zzz' });
  big.ctx.renderHistory();
  assert.equal(big.io.watching.size, 0);
});

test('HL3: without IntersectionObserver every card renders', () => {
  const { ctx, els, get } = app(log(130), { observer: false });
  ctx.renderHistory();
  assert.equal(cards(els.historyList.innerHTML).length, 130);
  assert.equal(get('historyLoaded'), 130);
  assert.doesNotMatch(els.historyList.innerHTML, /history-sentinel/);
});

// ── Byte-identical preservation against the branch base ─────────
// Only functions this workplan deliberately touches may differ.
const HL_ALLOWED = {
  renderHistory: 'HL11 esc() on user text; HL9 sort + HL2 first batch (card markup moved to historyCard); HL3 watch sentinel',
  esc: 'HL11 escapes &',
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
  const missing = Object.keys(before).filter(n => !(n in now));
  assert.deepEqual(missing, [], 'no function removed');
  const changed = Object.keys(before).filter(n => before[n] !== now[n]);
  assert.deepEqual(changed.filter(n => !(n in HL_ALLOWED)), [], 'changed without a listed reason');
  assert.deepEqual(Object.keys(HL_ALLOWED).filter(n => !changed.includes(n)), [], 'listed but unchanged');
});
