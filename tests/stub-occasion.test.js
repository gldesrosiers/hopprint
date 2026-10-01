#!/usr/bin/env node
// My Beers ticket stubs + Occasion pills (STUB_OCCASION_WORKPLAN.md). Run:
//   node --test tests/stub-occasion.test.js
//
// Real-source-pulled: functions and module state are extracted verbatim from
// the inline <script> in index.html and run in a sandbox with a minimal DOM.

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');

const { html, script, style, extractFunction } = require('./helpers');

// The My Beers module state (HISTORY_BATCH + the history* lets), verbatim.
const historyState = () => [...script.matchAll(/^(?:const HISTORY_\w+|let history\w+) = [^\n]*;/gm)].map(m => m[0]);

// renderHistory with its real precompute, against a search box and list stub.
// Card markup is stubbed: only the precompute and its caching are under test.
function makeApp(entries) {
  const els = { historySearch: { value: '' }, historyList: { innerHTML: '' }, historyCount: { textContent: '' } };
  const ctx = vm.createContext({
    entries,
    document: { getElementById: id => els[id] || null },
    historyCard: () => '', historySentinel: () => '', watchHistorySentinel() {}, icon: () => '',
  });
  vm.runInContext([...historyState(), ...['historyTime', 'stubBeerKey', 'buildStubMeta', 'renderHistory'].map(extractFunction)].join('\n'), ctx);
  const get = name => vm.runInContext(name, ctx);
  const meta = () => get('historyStubMeta');
  return { ctx, els, get, meta };
}

const entry = (id, created_at, extra = {}) => ({ id, beer_name: `Beer ${id}`, brewery_name: 'Brewery', created_at, ...extra });

test('TK1: numbers run 1..N oldest first over every entry, whatever the array order', () => {
  const app = makeApp([entry('c', '2026-03-01T20:00'), entry('a', '2024-01-01T12:00'), entry('b', '2025-06-15T09:30')]);
  app.ctx.buildStubMeta();
  assert.deepEqual(['a', 'b', 'c'].map(id => app.meta().get(id).no), [1, 2, 3]);
});

test('TK1: a search filter never renumbers', () => {
  const app = makeApp([entry('a', '2024-01-01T12:00', { beer_name: 'Pils' }), entry('b', '2025-01-01T12:00', { beer_name: 'Stout' })]);
  app.ctx.renderHistory();
  app.els.historySearch.value = 'stout';
  app.ctx.renderHistory();
  assert.equal(app.get('historyFiltered').length, 1);
  assert.equal(app.meta().get('b').no, 2);
});

test('TK1: deleting an entry shifts later numbers down by one', () => {
  const app = makeApp([entry('a', '2024-01-01T12:00'), entry('b', '2025-01-01T12:00'), entry('c', '2026-01-01T12:00')]);
  app.ctx.buildStubMeta();
  assert.equal(app.meta().get('c').no, 3);
  vm.runInContext("entries = entries.filter(e => e.id !== 'a'); historyDirty = true;", app.ctx);
  app.ctx.renderHistory();
  assert.deepEqual(['b', 'c'].map(id => app.meta().get(id).no), [1, 2]);
  assert.equal(app.meta().has('a'), false);
});

test('IC2: undated entries get no number and no ordinal, and are skipped by both sequences', () => {
  const app = makeApp([
    entry('u1', ''), entry('a', '2024-01-01T12:00', { beer_name: 'Same' }),
    entry('u2', 'not a date', { beer_name: 'Same' }), entry('b', '2025-01-01T12:00', { beer_name: 'Same' }),
  ]);
  app.ctx.buildStubMeta();
  assert.equal(app.meta().has('u1'), false);
  assert.equal(app.meta().has('u2'), false);
  assert.deepEqual({ ...app.meta().get('a') }, { no: 1, ordinal: 1 });
  assert.deepEqual({ ...app.meta().get('b') }, { no: 2, ordinal: 2 });
});

test('IC5: identical created_at breaks by id, independent of array order', () => {
  const t = '2025-05-05T18:00';
  for (const order of [['z', 'm', 'a'], ['a', 'z', 'm'], ['m', 'a', 'z']]) {
    const app = makeApp(order.map(id => entry(id, t, { beer_name: 'Same' })));
    app.ctx.buildStubMeta();
    assert.deepEqual(['a', 'm', 'z'].map(id => app.meta().get(id).no), [1, 2, 3], order.join());
    assert.deepEqual(['a', 'm', 'z'].map(id => app.meta().get(id).ordinal), [1, 2, 3], order.join());
  }
});

test('IC5: legacy numeric ids sort with the same rule as uuids', () => {
  const t = '2025-05-05T18:00';
  const app = makeApp([entry(20, t), entry(3, t)]);
  app.ctx.buildStubMeta();
  // String order: "20" < "3".
  assert.equal(app.meta().get(20).no, 1);
  assert.equal(app.meta().get(3).no, 2);
});

test('TK3: name and brewery are trimmed, lowercased, and inner spaces collapsed', () => {
  const app = makeApp([
    entry('a', '2024-01-01T12:00', { beer_name: 'Centennial IPA ', brewery_name: 'Founders' }),
    entry('b', '2024-02-01T12:00', { beer_name: 'centennial  ipa', brewery_name: ' FOUNDERS' }),
    entry('c', '2024-03-01T12:00', { beer_name: 'Centennial IPA', brewery_name: 'Other Brewing' }),
  ]);
  app.ctx.buildStubMeta();
  assert.equal(app.meta().get('a').ordinal, 1);
  assert.equal(app.meta().get('b').ordinal, 2);
  assert.equal(app.meta().get('c').ordinal, 1);   // same name, different brewery: a different beer
});

test('TK3: missing beer or brewery names do not throw', () => {
  const app = makeApp([entry('a', '2024-01-01T12:00', { beer_name: null, brewery_name: undefined })]);
  app.ctx.buildStubMeta();
  assert.deepEqual({ ...app.meta().get('a') }, { no: 1, ordinal: 1 });
});

test('TK3: the ordinal counts 1..N for one beer across a long log', () => {
  const app = makeApp(Array.from({ length: 250 }, (_, i) =>
    entry(`id-${i}`, new Date(Date.UTC(2020, 0, 1) + i * 3600e3).toISOString(), { beer_name: 'Same' })));
  app.ctx.buildStubMeta();
  assert.equal(app.meta().get('id-0').ordinal, 1);
  assert.equal(app.meta().get('id-99').ordinal, 100);
  assert.equal(app.meta().get('id-249').ordinal, 250);
});

test('TK-T2: the map is built once per dirty cycle, not per search keystroke', () => {
  const app = makeApp([entry('a', '2024-01-01T12:00'), entry('b', '2025-01-01T12:00')]);
  let builds = 0;
  const real = app.ctx.buildStubMeta;
  app.ctx.buildStubMeta = () => { builds++; real(); };
  app.ctx.renderHistory();                      // starts dirty
  assert.equal(builds, 1);
  for (const q of ['b', 'be', 'bee', '']) { app.els.historySearch.value = q; app.ctx.renderHistory(); }
  assert.equal(builds, 1);
  vm.runInContext('historyDirty = true;', app.ctx);   // what save() does
  app.ctx.renderHistory();
  assert.equal(builds, 2);
});

// ── TK-T3 helpers ─────────────────────────────────────────────

function helpers() {
  const ctx = vm.createContext({});
  vm.runInContext(['historyTime', 'stubDate', 'isRepeatMilestone', 'ordinalLabel'].map(extractFunction).join('\n'), ctx);
  return ctx;
}
// Engines differ on the space before AM/PM (some use U+202F); compare plain spaces.
const plain = s => s.replace(/\s/g, ' ');
const NOW = new Date(2026, 8, 30, 12, 0);   // Sep 30, 2026, local time

test('TK2: a current-year date leaves the year off', () => {
  assert.equal(plain(helpers().stubDate({ created_at: '2026-09-02T20:42' }, NOW)), 'Sep 2 · 8:42 PM');
});

test('TK2: another year shows the year', () => {
  assert.equal(plain(helpers().stubDate({ created_at: '2024-09-02T20:42' }, NOW)), 'Sep 2, 2024 · 8:42 PM');
  assert.equal(plain(helpers().stubDate({ created_at: '2027-01-05T09:05' }, NOW)), 'Jan 5, 2027 · 9:05 AM');
});

test('TK2: midnight still shows its time', () => {
  assert.equal(plain(helpers().stubDate({ created_at: '2026-03-01T00:00' }, NOW)), 'Mar 1 · 12:00 AM');
});

test('TK2: "current year" defaults to the device clock', () => {
  const thisYear = new Date().getFullYear();
  assert.doesNotMatch(helpers().stubDate({ created_at: `${thisYear}-06-01T18:00` }), /,/);
  assert.match(helpers().stubDate({ created_at: `${thisYear - 1}-06-01T18:00` }), new RegExp(`, ${thisYear - 1} `));
});

test('IC2: an entry with no usable date reads "Undated"', () => {
  for (const created_at of ['', null, undefined, 'not a date']) {
    assert.equal(helpers().stubDate({ created_at }, NOW), 'Undated', String(created_at));
  }
});

test('TK3: the chip shows on 1, 5, 10, 25, 50, 100, 200, 300 only', () => {
  const h = helpers();
  const shown = Array.from({ length: 1000 }, (_, i) => i + 1).filter(n => h.ordinalLabel(n) !== null);
  assert.deepEqual(shown, [1, 5, 10, 25, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]);
  for (const n of [2, 4, 6, 99, 101, 150]) assert.equal(h.ordinalLabel(n), null, String(n));
});

test('TK3: labels read "First time", then "Nth time"', () => {
  const h = helpers();
  assert.equal(h.ordinalLabel(1), 'First time');
  assert.equal(h.ordinalLabel(5), '5th time');
  assert.equal(h.ordinalLabel(25), '25th time');
  assert.equal(h.ordinalLabel(100), '100th time');
  assert.equal(h.ordinalLabel(1200), '1200th time');
});

test('TK3: isRepeatMilestone excludes the first visit (it is labeled separately)', () => {
  const h = helpers();
  assert.equal(h.isRepeatMilestone(1), false);
  assert.equal(h.isRepeatMilestone(5), true);
  assert.equal(h.isRepeatMilestone(150), false);
  assert.equal(h.isRepeatMilestone(200), true);
});

// ── TK-T1 icons ──────────────────────────────────────────────

test('TK-T1: ICON_PATHS in index.html matches design/icons/icons.js', () => {
  const fs = require('fs');
  const path = require('path');
  const block = src => src.match(/^const ICON_PATHS = \{[\s\S]*?^\};/m)[0];
  const ref = fs.readFileSync(path.join(__dirname, '..', 'design', 'icons', 'icons.js'), 'utf8');
  assert.equal(block(script), block(ref));
  assert.match(block(script), /^ {2}'purchase': /m);
  assert.match(block(script), /^ {2}'rating-unrated': '<circle cx="10" cy="10" r="7.2"><\/circle>',$/m);
});

// ── TK-T4 card ───────────────────────────────────────────────

// Multi-line top-level consts (extractConst only handles single-line ones).
const constFrom = name => script.match(new RegExp(`^const ${name} = [\\[{][\\s\\S]*?^[\\]}];`, 'm'))[0];
// Text a browser would show for a fragment: strip tags, decode the entities esc() emits.
const shown = s => s.replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

// Build the stub map over `entries`, then render one card by id.
function cardApp(entries) {
  const ctx = vm.createContext({ entries });
  vm.runInContext([
    ...historyState(), constFrom('ICON_PATHS'), constFrom('RATING_BANDS'),
    ...['icon', 'idArg', 'esc', 'historyTime', 'stubBeerKey', 'buildStubMeta', 'stubDate',
        'isRepeatMilestone', 'ordinalLabel', 'historyCard'].map(extractFunction),
  ].join('\n'), ctx);
  ctx.buildStubMeta();
  return { ctx, card: id => ctx.historyCard(entries.find(e => e.id === id), false) };
}
const part = (html, cls) => (html.match(new RegExp(`<(div|span) class="${cls}"[^>]*>([\\s\\S]*?)</\\1>`)) || [])[2];
const chipsOf = html => [...html.matchAll(/<span class="stub-chip( \w+)?">([\s\S]*?)<\/span>/g)].map(m => shown(m[2]));

test('TK-T4: header strip shows the stub date and the comma-formatted number', () => {
  const log = Array.from({ length: 1284 }, (_, i) => entry(`id-${i}`, new Date(Date.UTC(2020, 0, 1) + i * 3600e3).toISOString()));
  const html = cardApp(log).card('id-1283');
  assert.equal(shown(part(html, 'stub-no')), 'No. 1,284');
  assert.match(shown(part(html, 'stub-date')), /^\w{3} \d{1,2}, 2020 · \d{1,2}:\d{2} [AP]M$/);
});

test('IC2: an undated card reads "Undated", with no number and no repeat chip', () => {
  const html = cardApp([entry('u', '', { beer_abv: '5' })]).card('u');
  assert.equal(part(html, 'stub-date'), 'Undated');
  assert.equal(part(html, 'stub-no'), '');
  assert.deepEqual(chipsOf(html), ['5%']);
});

test('TK4: each band renders its icon, short label, and band class', () => {
  for (const [rating, id, label] of [[10, 'never', 'Never'], [50, 'maybe', 'Maybe'], [90, 'definitely', 'Def.']]) {
    const { ctx, card } = cardApp([entry('a', '2025-01-01T12:00', { rating })]);
    const html = card('a');
    const slot = html.match(/<div class="stub-rating (\w+)" onclick="([^"]*)">([\s\S]*?)<\/div>/);
    assert.equal(slot[1], id);
    assert.ok(slot[3].includes(ctx.icon(`rating-${id}`, 18, 2.4)), `${id} icon`);
    assert.equal(shown(slot[3]), label);
  }
});

test('TK4: an unrated card shows the unrated icon and "Rate it"', () => {
  const { ctx, card } = cardApp([entry('a', '2025-01-01T12:00')]);
  const slot = card('a').match(/<div class="stub-rating (\w+)" onclick="([^"]*)">([\s\S]*?)<\/div>/);
  assert.equal(slot[1], 'unrated');
  assert.ok(slot[3].includes(ctx.icon('rating-unrated', 18, 2.4)));
  assert.equal(shown(slot[3]), 'Rate it');
});

test('TK4: the rating slot stops the card tap and opens the rating modal', () => {
  for (const rating of [undefined, 70]) {
    const html = cardApp([entry('a', '2025-01-01T12:00', { rating })]).card('a');
    assert.match(html, /^<div class="entry-card" onclick="openEdit\('a'\)">/);
    assert.match(html, /<div class="stub-rating \w+" onclick="event\.stopPropagation\(\); openRatingModal\('a'\)">/);
  }
});

test('TK4: the 0–100 rating value never renders', () => {
  const html = cardApp([entry('a', '2025-01-01T12:00', { rating: 87 })]).card('a');
  assert.doesNotMatch(shown(html), /87/);
});

test('TK5: chips run ABV · serve · venue · purchase · repeat; style sits in the subline', () => {
  const html = cardApp([entry('a', '2025-01-01T12:00', {
    beer_abv: '7.2', serving_type: 'Draft', venue_name: 'The Taproom', purchase_venue: 'Bottle Shop', beer_type: 'IPA',
  })]).card('a');
  assert.deepEqual(chipsOf(html), ['7.2%', 'Draft', 'The Taproom', 'Bottle Shop', 'First time']);
  const { icon } = cardApp([]).ctx;
  assert.ok(html.includes(`<span class="stub-chip">${icon('venue', 12, 2.2)}The Taproom</span>`), 'venue icon');
  assert.ok(html.includes(`<span class="stub-chip">${icon('purchase', 12, 2.2)}Bottle Shop</span>`), 'purchase icon');
  assert.equal(shown(part(html, 'stub-sub')), 'Brewery · IPA');
});

test('TK5: each chip is absent when its field is empty; no chips means no chip row', () => {
  const a = cardApp([entry('a', '2025-01-01T12:00', { venue_name: 'Pub' })]).card('a');
  assert.deepEqual(chipsOf(a), ['Pub', 'First time']);
  const undated = cardApp([entry('u', '')]).card('u');
  assert.doesNotMatch(undated, /stub-chips/);
});

test('TK5: subline drops the separator when brewery or style is missing', () => {
  const { card } = cardApp([
    entry('a', '2025-01-01T12:00', { brewery_name: '', beer_type: 'Stout' }),
    entry('b', '2025-01-02T12:00', { beer_type: '' }),
  ]);
  assert.equal(shown(part(card('a'), 'stub-sub')), 'Stout');
  assert.equal(shown(part(card('b'), 'stub-sub')), 'Brewery');
});

test('TK3 on the card: "First time" is lime-classed, milestones orange-classed, others get none', () => {
  const log = Array.from({ length: 6 }, (_, i) => entry(`id-${i}`, `2025-01-0${i + 1}T12:00`, { beer_name: 'Same' }));
  const { card } = cardApp(log);
  assert.match(card('id-0'), /<span class="stub-chip first">First time<\/span>/);
  assert.match(card('id-4'), /<span class="stub-chip milestone">5th time<\/span>/);
  for (const id of ['id-1', 'id-2', 'id-3', 'id-5']) assert.doesNotMatch(card(id), /stub-chip (first|milestone)/, id);
});

test('TK5: brewery city/state and the occasion never render on the card', () => {
  const html = cardApp([entry('a', '2025-01-01T12:00', { brewery_city: 'Chico', brewery_state: 'CA', occasion: 'bar' })]).card('a');
  assert.doesNotMatch(shown(html), /Chico|CA\b|Bar/);
});

test('TK6: notes keep the 120-char cutoff, upright, without quote marks', () => {
  const { card } = cardApp([
    entry('a', '2025-01-01T12:00', { comment: 'y'.repeat(130) }),
    entry('b', '2025-01-02T12:00', { comment: 'Short and sweet' }),
    entry('c', '2025-01-03T12:00'),
  ]);
  assert.equal(shown(part(card('a'), 'stub-notes')), 'y'.repeat(120) + '…');
  assert.equal(shown(part(card('b'), 'stub-notes')), 'Short and sweet');
  assert.doesNotMatch(card('c'), /stub-notes/);
});

test('TK-T4: two notch circles sit in the stub body', () => {
  const html = cardApp([entry('a', '2025-01-01T12:00')]).card('a');
  assert.match(html, /<div class="stub-body">\s*<span class="stub-notch left"><\/span><span class="stub-notch right"><\/span>/);
});

// ── TK-T5 CSS ────────────────────────────────────────────────

// The declarations of one exact selector in the <style> block.
const rule = sel => {
  const m = style.match(new RegExp(`(?:^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`));
  assert.ok(m, `rule ${sel} exists`);
  return m[1].replace(/\s+/g, ' ');
};

test('IC1: band colors on the rating slot (Maybe uses --creamsicle, the mockup #eda547)', () => {
  assert.match(rule('.stub-rating.definitely'), /color: var\(--lime\)/);
  assert.match(rule('.stub-rating.maybe'), /color: var\(--creamsicle\)/);
  assert.match(rule('.stub-rating.never, .stub-rating.unrated'), /color: var\(--text-dim\)/);
  assert.match(rule('.stub-rating.unrated span'), /color: var\(--orange\)/);
  assert.match(style, /--creamsicle: #eda547;/);
});

test('TK3: First time chip is lime-tinted, milestones orange-tinted', () => {
  assert.match(rule('.stub-chip.first'), /background: rgba\(143,198,64,0\.15\); border-color: rgba\(143,198,64,0\.3\); color: var\(--lime\)/);
  assert.match(rule('.stub-chip.milestone'), /background: var\(--orange-glow\); border-color: var\(--border-orange\); color: var\(--orange\)/);
});

test('TK-T5: the card clips its notches, which match the page background', () => {
  assert.match(rule('.entry-card'), /overflow: hidden/);
  assert.match(rule('.stub-notch'), /top: -9px; width: 18px; height: 18px; border-radius: 50%; background: var\(--charcoal\)/);
  assert.match(rule('.stub-head'), /border-bottom: 1px dashed rgba\(245,240,232,0\.22\)/);
});

test('TK6: notes are upright with no top border', () => {
  assert.doesNotMatch(rule('.stub-notes'), /italic|border/);
});

test('TK-T5: old-card CSS is gone; rules still in use elsewhere stay', () => {
  for (const sel of ['.entry-top', '.entry-brewery', '.entry-tags', '.entry-foot', '.entry-date', '.entry-occ',
                     '.entry-notes-preview', '.etag.venue', '.etag.serve', '.etag.rated']) {
    assert.ok(!style.includes(sel), `${sel} removed`);
  }
  rule('.rate-badge');   // edit modal "Change / Rate it →"
  rule('.etag.style');   // Discover random-beer card
});

// ── TK-T6 heading + count ────────────────────────────────────

test('IC3: the count is the whole log, comma-formatted, and ignores search', () => {
  const log = Array.from({ length: 1284 }, (_, i) => entry(`id-${i}`, new Date(Date.UTC(2020, 0, 1) + i * 3600e3).toISOString()));
  const app = makeApp(log);
  app.ctx.renderHistory();
  assert.equal(app.els.historyCount.textContent, '1,284');
  app.els.historySearch.value = 'beer id-12';
  app.ctx.renderHistory();
  assert.ok(app.get('historyFiltered').length < 1284);
  assert.equal(app.els.historyCount.textContent, '1,284');
});

test('TK-T6: the count follows writes, and an empty log shows 0', () => {
  const app = makeApp([entry('a', '2024-01-01T12:00'), entry('b', '2025-01-01T12:00')]);
  app.ctx.renderHistory();
  assert.equal(app.els.historyCount.textContent, '2');
  vm.runInContext('entries = []; historyDirty = true;', app.ctx);
  app.ctx.renderHistory();
  assert.equal(app.els.historyCount.textContent, '0');
});

test('TK-T6: the heading sits first on My Beers and first sync does not hide it', () => {
  const screen = html.match(/<div class="screen" id="screen-history">([\s\S]*?)<div id="historyList"><\/div>/)[1];
  const at = s => screen.indexOf(s);
  assert.ok(at('class="history-heading"') >= 0);
  assert.ok(at('class="history-heading"') < at('class="first-sync-note"'));
  assert.ok(at('class="first-sync-note"') < at('class="search-wrap'));
  assert.match(screen, /<div class="history-title">My Beers<\/div><div class="history-count" id="historyCount">0<\/div>/);
  assert.doesNotMatch(style, /first-sync[^{]*history-(heading|title|count)/);
});

test('TK7: heading uses the headline font with an under-fill stroke; count is orange', () => {
  assert.match(rule('.history-title'), /font-family: var\(--font-headline\).*text-transform: uppercase.*-webkit-text-stroke: 5px [^;]+; paint-order: stroke fill/);
  assert.match(rule('.history-count'), /font-family: var\(--font-headline\).*color: var\(--orange\)/);
});
