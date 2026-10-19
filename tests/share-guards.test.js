// Phase E (c) share guardrails (DE10, D1). SG1–SG2: length budget — every
// registry line eligible for a card, filled with realistic worst-case names,
// must fit its card slot in both formats, measured with the real fonts' glyph
// widths (tests/fixtures/share-font-widths.json). SG3: no fixed strings in the
// render code (they live in SHARE_COPY). SG4: no raw 0–100 rating on a card.

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const path = require('path');

const { script, extractFunction } = require('./helpers');
const STYLE_MATRIX = require('../style_matrix.js');
const WIDTHS = require(path.join(__dirname, 'fixtures', 'share-font-widths.json'));

function constFrom(name) {
  const m = script.match(new RegExp(`^const ${name} = [\\s\\S]*?;(?:[ \\t]*//[^\\n]*)?\\n`, 'm'));
  if (!m) throw new Error(`const ${name} not found`);
  return m[0];
}

function sandbox() {
  const ctx = vm.createContext({ Math, String, JSON, Date, Object, Array, Set, STYLE_MATRIX, console });
  vm.runInContext([
    ...['HOPPRINT_DIMS', 'HOPPRINT_DIM_LABELS', 'RATING_BANDS', 'HOME_VENUE', 'WRAPPED_MIN', 'MS_CHECKIN_STEPS',
      'MS_BREWERY_STEPS', 'MS_STYLE_STEPS', 'SHARE_COPY', 'SHARE_FORMATS', 'SHARE_PAD', 'SHARE_ROLES',
      'PROFILE_COPY', 'PROFILE_ZONE_ORDER', 'PROFILE_MAX_EARNED', 'WRAPPED_ZONE_ORDER', 'WRAPPED_MAX_EARNED',
      'WRAPPED_COPY'].map(constFrom),
    'let STYLE_KEY_INDEX = null;',
    ...['normalizeStyleKey', 'resolveMatrixStyle', 'computeHopprint', 'countBy', 'bandOf', 'computeBandAnalytics',
      'isHomeEntry', 'computeProfileContext', 'esc', 'selectCopy', 'buildProfileHeroCopy', 'computeMilestones',
      'milestonesCrossedIn', 'firstOccurrenceIds', 'wrappedTop', 'computeWrappedContext', 'buildWrappedCopy',
      'wrappedSentences', 'hopprintGeometry', 'shareRuns', 'wrapShareRuns', 'fitShareText', 'shareFont',
      'shareSpacedWidth', 'layoutShareCard', 'buildHopprintCardSpec', 'buildWrappedCardSpec'].map(extractFunction),
    'var entries = [];',
    'Object.assign(this, { SHARE_COPY, SHARE_FORMATS, SHARE_PAD, SHARE_ROLES, PROFILE_COPY, WRAPPED_COPY });',
  ].join('\n'), ctx);
  return ctx;
}

// Real-font measure from the fixture: per-char advance widths at 100px.
// Unknown characters count as the face's widest letter (W).
const FONTS = { headline: 'Big Shoulders', display: 'Unica One', body: 'Arial Narrow' };
function measure(text, font) {
  const m = font.match(/^(\d+) ([\d.]+)px (.+)$/);
  const [, weight, size, family] = m;
  let face;
  if (family === 'Arial Narrow') face = `body-${weight >= 700 ? 700 : 400}`;
  else if (family === 'Big Shoulders') face = `headline-${weight >= 800 ? 800 : 700}`;
  else face = 'body-700'; // Unica One isn't fitted by DE10; only hero/radar labels use it
  const w = WIDTHS.faces[face];
  const scale = (family === 'Unica One' ? 1.25 : 1) * size / WIDTHS.size;
  return [...text].reduce((t, ch) => t + (w[ch] ?? w.W), 0) * scale;
}

// Realistic worst cases: at or past the longest names in a 2,800-check-in
// history (beer p99 43 chars, brewery max 45, style max 42), wide letters.
const BREWERY = 'Lawson’s Finest Liquids & Mountain Brewing Co'; // 45
const STYLE = 'IPA - Imperial / Double New England / Hazy';      // 42
const STYLE2 = 'Historical Beer - Pre-Prohibition Lager';        // 39
const BEER = 'Mother of All Storms Barrel-Aged Barleywine 25';   // 46
const WORST_WRAPPED = {
  year: 2025, prevYear: 2024, total: 9999, prevTotal: 999, deltaVolumePct: 999,
  breweries: 9999, styles: 999, notes: 9999, newBreweryCount: 9999, newStyleCount: 999,
  newBreweryPct: 100, newStylePct: 100, busiestMonthName: 'September', busiestMonthCount: 999, activeMonths: 12,
  topBrewery: { name: BREWERY, count: 9999 }, topStyle: { name: STYLE, count: 9999 },
  topBeer: { name: BEER, brewery: BREWERY, count: 999 }, topVenue: { name: BREWERY + ' Taproom', count: 999 },
  homeCount: 9999, homePct: 100, hpVector: [5, 1, 5, 1, 5, 1, 5, 1], hpMatchedStyles: 99, showRadar: true,
  prevHpVector: null, showPrior: false, milestones: [], ratedTotal: 999,
  mostLogged: STYLE, wheelhouse: STYLE2, lovedBeer: BEER, unfinishedStyle: STYLE,
};
const WORST_PROFILE = { regionName: 'New Hampshire', styleParent: 'Strong Bitter / Extra Special', topStatePct: 100 };

function fitsSlot(ctx, html, role, format) {
  const R = ctx.SHARE_ROLES[role], F = ctx.SHARE_FORMATS[format], k = F.scale;
  const m = (t, bold, size) => measure(t, ctx.shareFont(FONTS, R.family, bold ? R.boldWeight : R.weight, size));
  return ctx.fitShareText(ctx.shareRuns(html), {
    width: F.w - ctx.SHARE_PAD * 2, maxLines: R.maxLines, size: R.size * k, minSize: R.minSize * k, step: 2,
  }, m);
}

test('SG1: DE10 length budget — every shareSlot WRAPPED_COPY line fits the body slot in both formats', () => {
  const ctx = sandbox();
  const eligible = ctx.WRAPPED_COPY.filter(c => c.shareSlot);
  assert.ok(eligible.length >= 10);
  // The budget bites: a line three times the longest real one is rejected.
  const longest = eligible.map(c => ctx.wrappedSentences([{ html: c.render(WORST_WRAPPED) }])).sort((x, y) => y.length - x.length)[0];
  assert.equal(fitsSlot(ctx, `${longest} ${longest} ${longest}`, 'body', 'portrait'), null);
  for (const c of eligible) {
    const line = ctx.wrappedSentences([{ html: c.render(WORST_WRAPPED) }]);
    for (const fmt of ['story', 'portrait']) {
      const fit = fitsSlot(ctx, line, 'body', fmt);
      assert.ok(fit, `${c.id} (${fmt}) can't fit the card: "${line}"`);
    }
  }
});

test('SG2: DE10 length budget — every shareSlot PROFILE_COPY identity line fits in both formats', () => {
  const ctx = sandbox();
  const eligible = ctx.PROFILE_COPY.filter(c => c.shareSlot);
  assert.equal(eligible.length, 4);
  for (const c of eligible) {
    const line = `“${c.render(WORST_PROFILE)}”`;
    for (const fmt of ['story', 'portrait']) {
      assert.ok(fitsSlot(ctx, line, 'identity', fmt), `${c.id} (${fmt}) can't fit the card: ${line}`);
    }
  }
});

test('SG2b: worst-case full cards keep every block, favorites rows included', () => {
  const ctx = sandbox();
  for (const fmt of ['story', 'portrait']) {
    const picked = ctx.WRAPPED_COPY.filter(c => c.shareSlot);
    // Try every shareable line as the card's line, with the venue toggle on.
    for (const cand of picked) {
      const spec = ctx.buildWrappedCardSpec(WORST_WRAPPED, fmt, { venue: true });
      const text = spec.blocks.find(b => b.type === 'text');
      text.html = ctx.wrappedSentences([{ html: cand.render(WORST_WRAPPED) }]);
      const L = ctx.layoutShareCard(spec, fmt, measure, FONTS);
      assert.equal(JSON.stringify(L.omitted.map(b => b.label || b.type)), '[]', `${fmt} ${cand.id}`);
      const shown = L.ops.filter(o => o.op === 'text').map(o => o.text);
      assert.ok(shown.includes('TOP VENUE'), `${fmt} venue row drawn`);
      if (fmt === 'story') assert.ok(shown.includes(BEER) && shown.includes(BREWERY), 'favorites drawn');
    }
  }
});

// ── SG3: SHARE_COPY hygiene ───────────────────────────────────────

const RENDER_FNS = ['layoutShareCard', 'drawShareText', 'drawShareRadar', 'drawShareOps', 'renderShareCard',
  'shareFontFaces', 'shareFileName', 'downloadShareFile', 'shareOrDownload', 'sharePreviewHTML', 'paintSharePreview',
  'renderSharePreview', 'openSharePreview', 'closeSharePreview', 'setShareFormat', 'setShareToggle', 'shareNow',
  'buildHopprintCardSpec', 'shareHopprint', 'buildWrappedCardSpec', 'shareWrapped'];
// Internal, never shown: the rejection reason inside renderShareCard.
const INTERNAL = new Set(['toBlob failed']);

function humanText(src) {
  const found = [];
  // Template literals: drop ${…} (innermost first), then tags; any words left are visible copy.
  for (const m of src.matchAll(/`((?:[^`\\]|\\.)*)`/g)) {
    let t = m[1], prev;
    do { prev = t; t = t.replace(/\$\{[^{}]*\}/g, ' '); } while (t !== prev);
    t = t.replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/g, ' ');
    t = t.trim();
    if (/[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(t) || /(^|\s)[A-Z][a-z]+(\s|$)/.test(t)) found.push(t);
  }
  // Quoted strings: two words, or one capitalized word, reads as copy.
  for (const m of src.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"/g)) {
    const t = m[1] ?? m[2];
    if (INTERNAL.has(t)) continue;
    if (src[m.index - 1] === '=') continue; // an HTML attribute value (class names)
    if (/^[a-z][a-z0-9]*-[a-z0-9-]+( [a-z][a-z0-9-]*)*$/.test(t)) continue; // a class list, e.g. 'share-img entering'
    if (/[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(t) || /^[A-Z][a-z]+$/.test(t)) found.push(t);
  }
  return found;
}

test('SG3: share render code carries no fixed user-facing strings (all in SHARE_COPY)', () => {
  for (const name of RENDER_FNS) {
    assert.deepEqual(humanText(extractFunction(name)), [], `${name} has inline copy`);
  }
  // The guard bites.
  assert.ok(humanText("ctx.fillText('Your year', x, y)").length === 1);
  assert.ok(humanText('const h = `<div>Share now</div>`;').length === 1);
  assert.ok(humanText("o.label = 'Breweries'").length === 1);
});

// ── SG4: D1 on cards ───────────────────────────────────────────────

test('SG4: D1 — raw 0–100 ratings never reach either card', () => {
  const ctx = sandbox();
  const styles = Object.keys(STYLE_MATRIX);
  let seq = 0;
  const at = (y, m) => new Date(y, m, 10, 18).toISOString();
  const ck = (y, i) => ({ id: 'g' + (seq++), beer_name: i < 8 ? 'Loved' : 'B' + i, brewery_name: 'Br' + (i % 5),
    brewery_state: 'MA', beer_type: styles[i % 6], venue_name: i % 2 ? 'Home' : 'Tap', source: 'live',
    rating: 77, rating_mode: 'band', created_at: at(y, i % 12) });
  const year = Array.from({ length: 33 }, (_, i) => ck(2025, i));
  const prev = Array.from({ length: 24 }, (_, i) => ck(2024, i));
  ctx.entries = [...prev, ...year];
  const c = ctx.computeWrappedContext(year, prev, 2025);
  const texts = [];
  for (const fmt of ['story', 'portrait']) {
    for (const venue of [false, true]) {
      for (const spec of [ctx.buildWrappedCardSpec(c, fmt, { venue }), ctx.buildHopprintCardSpec(ctx.entries)]) {
        const L = ctx.layoutShareCard(spec, fmt, measure, FONTS);
        texts.push(...L.ops.filter(o => o.op === 'text').map(o => o.text));
      }
    }
  }
  const all = texts.join(' ');
  assert.ok(all.includes('2025 WRAPPED') && all.includes('MY HOPPRINT'));
  assert.doesNotMatch(all, /\b77\b/);
});
