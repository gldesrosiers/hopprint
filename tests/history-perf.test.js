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

// A fresh app with the given entries and an empty My Beers screen.
function app(entries, { query = '' } = {}) {
  const els = {
    historySearch: { value: query },
    historyList: { innerHTML: '' },
  };
  const ctx = vm.createContext({
    console,
    entries,
    document: { getElementById: id => els[id] || null },
  });
  vm.runInContext([
    constFrom(script, 'ICON_PATHS'),
    constFrom(script, 'OCCASIONS'),
    constFrom(script, 'RATING_BANDS'),
    ...['icon', 'idArg', 'esc', 'renderHistory'].map(extractFunction),
  ].join('\n'), ctx);
  return { ctx, els };
}

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

// ── Byte-identical preservation against the branch base ─────────
// Only functions this workplan deliberately touches may differ.
const HL_ALLOWED = {
  renderHistory: 'HL11 esc() on user text',
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
