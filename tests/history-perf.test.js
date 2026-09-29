#!/usr/bin/env node
// My Beers list performance + escaping (HISTORY_PERF_WORKPLAN.md HL1–HL11). Run:
//   node --test tests/history-perf.test.js
//
// Real-source-pulled: renderHistory() and everything it calls are extracted
// verbatim from index.html and run against a fake #historyList.

const test = require('node:test');
const nodeCrypto = require('crypto');
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
// `win` is the window: scrollY can be set by a test; scrollTo records each
// call and moves scrollY. Each full write of #historyList bumps els.builds.
const TABS = ['checkin', 'history', 'analytics', 'profile', 'discover'];
function fakeEl() {
  const classes = new Set();
  return { classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c) },
    setAttribute() {}, removeAttribute() {} };
}
function app(entries, { query = '', observer = true } = {}) {
  let markup = '';
  const els = {
    builds: 0,
    historySearch: { value: query },
    historyList: {
      get innerHTML() { return markup; },
      // A real list write can clamp the page's scroll; model the worst case.
      set innerHTML(v) { markup = v; els.builds++; win.scrollY = 0; },
    },
    importDiagnostic: null,
  };
  for (const f of EDIT_FIELDS) els[f] = { value: '' };
  els.editModal = fakeEl();
  for (const t of TABS) { els[`tab-${t}`] = fakeEl(); els[`screen-${t}`] = fakeEl(); }
  els['screen-checkin'].classList.add('active');
  const win = { scrollY: 0, scrolls: [], readWhileVisible: [],
    scrollTo(opts) { this.scrolls.push(opts); this.scrollY = opts.top; } };
  const rendered = [];
  const sentinel = {   // edits the markup in place — not a full list write
    insertAdjacentHTML(pos, html) {
      assert.equal(pos, 'beforebegin');
      markup = markup.replace(SENTINEL, () => html + SENTINEL);
    },
    remove() { markup = markup.replace(SENTINEL, ''); },
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
    window: {
      get scrollY() { win.readWhileVisible.push(els['screen-history'].classList.contains('active')); return win.scrollY; },
      scrollTo: o => win.scrollTo(o),
    },
    localStorage: { setItem() {} },
    renderAnalytics: () => rendered.push('analytics'),
    renderProfile: () => rendered.push('profile'),
    renderWishlist: () => rendered.push('discover'),
    queueSync() {}, queueSyncMany() {}, showToast() {}, updateHeaderMeta() {}, buildLiveLists() {},
    upsertBeerDB() {}, upsertBreweryDB() {}, resolveMatrixStyle: () => true,
    confirm: () => true,
    FileReader: function () { this.readAsText = () => this.onload({ target: { result: ctx.csv } }); },
    crypto: nodeCrypto.webcrypto,
    document: {
      getElementById: id => (id === 'historySentinel' ? (markup.includes(SENTINEL) ? sentinel : null) : els[id] || null),
      querySelectorAll: sel => (sel === '.bn-item' ? TABS.map(t => els[`tab-${t}`]) : sel === '.screen' ? TABS.map(t => els[`screen-${t}`]) : []),
    },
  });
  vm.runInContext([
    ...['currentTab', 'editingId', 'ratingEntryId', 'editServe'].map(n => script.match(new RegExp(`^let ${n} = [^\\n]*;`, 'm'))[0]),
    constFrom(script, 'ICON_PATHS'),
    constFrom(script, 'OCCASIONS'),
    constFrom(script, 'RATING_BANDS'),
    ...historyState(),
    ...['icon', 'idArg', 'esc', ...HISTORY_FNS].map(extractFunction),
  ].join('\n'), ctx);
  const get = name => vm.runInContext(name, ctx);
  return { ctx, els, get, io, sentinel, win, rendered };
}

// The My Beers module state (HISTORY_BATCH + the history* lets), verbatim.
const historyState = () => [...script.matchAll(/^(?:const HISTORY_BATCH|let history\w+) = [^\n]*;/gm)].map(m => m[0]);
const HISTORY_FNS = ['historyTime', 'historySentinel', 'historyCard', 'renderHistory', 'appendHistoryBatch',
  'watchHistorySentinel', 'restoreScroll', 'enterHistory', 'save', 'switchTab',
  'refreshHistory', 'closeModal', 'saveEdit', 'deleteEntry', 'saveRating', 'refreshAfterPull', 'newId', 'handleImport'];
const EDIT_FIELDS = ['e_beerName', 'e_breweryName', 'e_city', 'e_state', 'e_style', 'e_abv', 'e_venue', 'e_purchase', 'e_date', 'e_notes'];

// Rendered cards, in DOM order, by beer name.
const cards = html => [...html.matchAll(/<div class="entry-beer">([^<]*)<\/div>/g)].map(m => m[1]);
// n entries, stored oldest first so array order is the opposite of display order.
const log = n => Array.from({ length: n }, (_, i) => entry(i));

// created_at is a wall-clock 'YYYY-MM-DDTHH:MM' string, as the app stores it (SY5).
const entry = (i, extra = {}) => ({
  id: `id-${i}`, beer_name: `Beer ${i}`, brewery_name: `Brewery ${i}`,
  created_at: new Date(Date.UTC(2026, 0, 1) + i * 3600e3).toISOString().slice(0, 16), ...extra,
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

// ── HL4 / HL5 dirty flag + scroll ───────────────────────────────
test('HL4: the list starts dirty, so the first visit builds one fading batch', () => {
  const { ctx, els, get } = app(log(130));
  assert.equal(get('historyDirty'), true);
  ctx.switchTab('history');
  assert.equal(els.builds, 1);
  assert.equal(cards(els.historyList.innerHTML).length, 50);
  assert.match(els.historyList.innerHTML, /class="entry-card fade-up"/);
  assert.equal(get('historyDirty'), false);
});

test('HL4: switching away and back with no writes reuses the list', () => {
  const { ctx, els, io } = app(log(130));
  ctx.switchTab('history');
  io.fire();                                         // 100 cards loaded
  const built = els.historyList.innerHTML;
  ctx.switchTab('analytics');
  ctx.switchTab('history');
  assert.equal(els.builds, 1, 'no rebuild');
  assert.equal(els.historyList.innerHTML, built, 'same cards, same order');
});

test('HL4: after save(), the next visit rebuilds at the loaded count, without fade', () => {
  const { ctx, els, get, io } = app(log(200));
  ctx.switchTab('history');
  io.fire(); io.fire();                              // 150 cards loaded
  ctx.switchTab('checkin');
  ctx.entries.push(entry(500));
  ctx.save();
  assert.equal(get('historyDirty'), true);
  ctx.switchTab('history');
  assert.equal(els.builds, 2);
  const names = cards(els.historyList.innerHTML);
  assert.equal(names.length, 150);
  assert.equal(names[0], 'Beer 500');
  assert.doesNotMatch(els.historyList.innerHTML, /fade-up/);
  assert.equal(get('historyDirty'), false);
});

test('HL5: scroll is saved while My Beers is still showing and restored on return', () => {
  const { ctx, win, get } = app(log(130));
  ctx.switchTab('history');
  win.scrollY = 1234;
  ctx.switchTab('profile');
  assert.equal(get('historyScroll'), 1234);
  assert.deepEqual(win.readWhileVisible, [true], 'read before the screen is hidden');
  win.scrollY = 40;                                  // Profile scrolled somewhere else
  ctx.switchTab('history');
  assert.deepEqual({ ...win.scrolls.at(-1) }, { top: 1234, behavior: 'instant' });
  assert.equal(win.scrollY, 1234);
});

test('HL5: scroll is restored after a dirty rebuild too', () => {
  const { ctx, win } = app(log(130));
  ctx.switchTab('history');
  win.scrollY = 900;
  ctx.switchTab('checkin');
  ctx.save();
  win.scrollY = 0;
  ctx.switchTab('history');
  assert.equal(win.scrollY, 900);
});

test('HL5: tapping Beers while on My Beers jumps to the top without a rebuild', () => {
  const { ctx, els, win, io } = app(log(130));
  ctx.switchTab('history');
  io.fire();                                         // 100 cards loaded
  win.scrollY = 700;
  ctx.switchTab('history');
  assert.equal(win.scrollY, 0);
  assert.equal(els.builds, 1);
  assert.equal(cards(els.historyList.innerHTML).length, 100);
  ctx.switchTab('analytics');                        // and the top is what is saved
  ctx.switchTab('history');
  assert.equal(win.scrollY, 0);
});

test('HL5: leaving another tab does not overwrite the saved My Beers scroll', () => {
  const { ctx, win, get } = app(log(130));
  ctx.switchTab('history');
  win.scrollY = 500;
  ctx.switchTab('analytics');
  win.scrollY = 3000;
  ctx.switchTab('profile');
  assert.equal(get('historyScroll'), 500);
});

test('switchTab still renders the other tabs', () => {
  const { ctx, rendered } = app([]);
  ['analytics', 'profile', 'discover'].forEach(t => ctx.switchTab(t));
  assert.deepEqual(rendered, ['analytics', 'profile', 'discover']);
});

// ── HL6 / HL7 write flows ───────────────────────────────────────
// My Beers open with 150 of 200 cards loaded, scrolled to 4000.
function scrolledDeep() {
  const a = app(log(200));
  a.ctx.switchTab('history');
  a.io.fire(); a.io.fire();
  a.win.scrollY = 4000;
  return a;
}
// What openEdit() leaves in the edit form for an entry.
function openForm(a, id) {
  const e = a.ctx.entries.find(x => x.id === id);
  vm.runInContext(`editingId = ${JSON.stringify(id)}`, a.ctx);
  Object.assign(a.els, Object.fromEntries(EDIT_FIELDS.map(f => [f, { value: '' }])));
  a.els.e_beerName.value = e.beer_name; a.els.e_breweryName.value = e.brewery_name;
  a.els.e_date.value = e.created_at.slice(0, 16);
}

test('HL6: edit at loaded count 150 → 150 cards afterward, scroll restored, no fade', () => {
  const a = scrolledDeep();
  openForm(a, 'id-120');
  a.els.e_beerName.value = 'Renamed';
  a.ctx.saveEdit();
  const names = cards(a.els.historyList.innerHTML);
  assert.equal(names.length, 150);
  assert.equal(names[199 - 120], 'Renamed', 'same place in the list');
  assert.equal(a.win.scrollY, 4000);
  assert.doesNotMatch(a.els.historyList.innerHTML, /fade-up/);
  assert.equal(a.get('historyDirty'), false);
});

test('HL6: delete at 150 keeps 150 cards (the next one moves up), scroll restored', () => {
  const a = scrolledDeep();
  openForm(a, 'id-120');
  a.ctx.deleteEntry();
  const names = cards(a.els.historyList.innerHTML);
  assert.equal(names.length, 150);
  assert.ok(!names.includes('Beer 120'));
  assert.equal(names.at(-1), 'Beer 49');
  assert.equal(a.win.scrollY, 4000);
});

test('HL6: rating a card from My Beers keeps the loaded count and scroll', () => {
  const a = scrolledDeep();
  vm.runInContext('ratingEntryId = "id-100"', a.ctx);
  a.ctx.saveRating(90, 'live_button');
  assert.equal(cards(a.els.historyList.innerHTML).length, 150);
  assert.match(a.els.historyList.innerHTML, /onclick="openEdit\('id-100'\)">[\s\S]*?etag rated/);
  assert.equal(a.win.scrollY, 4000);
});

test('HL6: a sync pull while on My Beers keeps the loaded count and scroll', () => {
  const a = scrolledDeep();
  a.ctx.entries.unshift(entry(900));
  a.ctx.save();
  a.ctx.refreshAfterPull();
  const names = cards(a.els.historyList.innerHTML);
  assert.equal(names.length, 150);
  assert.equal(names[0], 'Beer 900');
  assert.equal(a.win.scrollY, 4000);
});

test('HL6: a write made off My Beers does not render now; the next visit rebuilds in place', () => {
  const a = scrolledDeep();
  a.ctx.switchTab('checkin');
  const builds = a.els.builds;
  a.ctx.entries.unshift(entry(900));             // HL7: a new check-in keeps position
  a.ctx.save();
  vm.runInContext('ratingEntryId = "id-900"', a.ctx);
  a.ctx.saveRating(10, 'live_slider');           // the rating prompt after a check-in
  assert.equal(a.els.builds, builds, 'no off-tab render');
  a.ctx.switchTab('history');
  assert.equal(a.els.builds, builds + 1);
  assert.equal(cards(a.els.historyList.innerHTML).length, 150);
  assert.equal(cards(a.els.historyList.innerHTML)[0], 'Beer 900');
  assert.equal(a.win.scrollY, 4000);
});

test('HL7: import → My Beers reopens with one fresh batch at the top', () => {
  const a = scrolledDeep();
  a.ctx.switchTab('profile');
  a.ctx.csv = ['beer_name,brewery_name,created_at', 'Imported,Somewhere,2020-01-01 12:00:00'].join('\n');
  a.ctx.handleImport({ target: { files: [{}], value: 'x' } });
  assert.equal(a.get('historyScroll'), 0);
  a.win.scrollY = 300;                            // wherever Print was scrolled
  a.ctx.switchTab('history');
  assert.equal(cards(a.els.historyList.innerHTML).length, 50);
  assert.equal(a.get('historyLoaded'), 50);
  assert.equal(a.win.scrollY, 0);
  assert.match(a.els.historyList.innerHTML, /class="entry-card fade-up"/);
});

// ── Byte-identical preservation against the branch base ─────────
// Only functions this workplan deliberately touches may differ.
const HL_ALLOWED = {
  renderHistory: 'HL11 esc() on user text; HL9 sort + HL2 first batch (card markup moved to historyCard); HL3 watch sentinel; HL4 clears dirty, animate flag',
  esc: 'HL11 escapes &',
  save: 'HL4 marks the list dirty',
  switchTab: 'HL5 save scroll on leave; HL4/HL5 enterHistory()',
  saveEdit: 'HL6 refreshHistory()',
  deleteEntry: 'HL6 refreshHistory()',
  saveRating: 'HL6 refreshHistory()',
  refreshAfterPull: 'HL6 refreshHistory()',
  handleImport: 'HL7 reset to one batch at the top',
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
