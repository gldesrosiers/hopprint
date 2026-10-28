// Phase E (c) share pipeline. SP1–SP2: radar geometry shared by the on-screen
// SVG and the canvas card (DE5).

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { execFileSync } = require('child_process');

const { ROOT, script, inlineScript, extractFunction, extractFunctionFrom } = require('./helpers');

// The last build before session (c) (Phase E (b) spike removal on main).
const PRE_SHARE = '0d6f207';

function constFrom(src, name) {
  const m = src.match(new RegExp(`^const ${name} = [\\s\\S]*?;(?:[ \\t]*//[^\\n]*)?\\n`, 'm'));
  if (!m) throw new Error(`const ${name} not found`);
  return m[0];
}

function radarSandbox(src) {
  const ctx = vm.createContext({ Math });
  const fns = ['buildHopprintSVG'];
  if (/^function hopprintGeometry\(/m.test(src)) fns.unshift('hopprintGeometry');
  vm.runInContext([
    ...['HOPPRINT_DIMS', 'HOPPRINT_DIM_LABELS'].map(n => constFrom(src, n)),
    ...fns.map(n => extractFunctionFrom(src, n)),
  ].join('\n'), ctx);
  return ctx;
}

// Edge values (clamped below 1 and above 5), fractions, flat and spiky shapes.
const VECTORS = [
  [1, 1, 1, 1, 1, 1, 1, 1],
  [5, 5, 5, 5, 5, 5, 5, 5],
  [0, 6, -2, 9, 3, 3, 3, 3],
  [3.27, 2.81, 1.04, 4.66, 2.5, 3.91, 1.73, 4.02],
  [4.9, 1.2, 1.1, 3.3, 4.4, 2.2, 3.8, 1.9],
  [2, 3, 4, 5, 4, 3, 2, 1],
];

let preScript = null;
try {
  preScript = inlineScript(execFileSync('git', ['show', `${PRE_SHARE}:index.html`], { cwd: ROOT, encoding: 'utf8' }));
} catch (e) { /* shallow clone: SP1 skips */ }

test('SP1: buildHopprintSVG output is identical to the pre-change build', { skip: preScript ? false : 'git history not available' }, () => {
  const now = radarSandbox(script), before = radarSandbox(preScript);
  assert.ok(/hopprintGeometry/.test(extractFunction('buildHopprintSVG')), 'buildHopprintSVG reads the shared helper');
  for (const a of VECTORS) {
    for (const t of [null, ...VECTORS]) {
      assert.equal(now.buildHopprintSVG(a, t), before.buildHopprintSVG(a, t));
    }
  }
});

test('SP2: hopprintGeometry scales cleanly to card size', () => {
  const { hopprintGeometry } = radarSandbox(script);
  const base = hopprintGeometry(160, 150, 96);
  const k = 3.25;
  const big = hopprintGeometry(160 * k, 150 * k, 96 * k);
  const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);
  assert.equal(base.rings.length, 5);
  assert.equal(base.spokes.length, 8);
  assert.equal(base.labels.length, 8);
  base.rings.forEach((ring, r) => ring.forEach(([x, y], i) => { close(big.rings[r][i][0], x * k); close(big.rings[r][i][1], y * k); }));
  VECTORS.forEach(v => big.shape(v).forEach(([x, y], i) => { close(x, base.shape(v)[i][0] * k); close(y, base.shape(v)[i][1] * k); }));
  base.labels.forEach((l, i) => {
    const b = big.labels[i];
    close(b.x, l.x * k); close(b.y, l.y * k);
    assert.equal(b.anchor, l.anchor); assert.equal(b.dyEm, l.dyEm); assert.equal(b.text, l.text);
  });
  // Top label centered and above, bottom below, sides level with the center.
  assert.deepEqual(JSON.parse(JSON.stringify(base.labels.map(l => [l.text, l.anchor, l.dyEm]))), [
    ['Bitter', 'middle', 0], ['Sweet', 'start', 0], ['Roast', 'start', 0.32], ['Body', 'start', 0.7],
    ['Fruit', 'middle', 0.7], ['Carb', 'end', 0.7], ['ABV', 'end', 0.32], ['Haze', 'end', 0],
  ]);
  // Values clamp to 1..5: outside the range lands on the inner/outer ring.
  const clamped = base.shape([0, 9, 1, 5, 1, 5, 1, 5]);
  close(clamped[0][1], base.rings[0][0][1]);
  close(clamped[1][0], base.rings[4][1][0]);
});

// ── SP3–SP10: runs, wrapping, fitting, SHARE_COPY (DE3, DE10) ────

function textSandbox() {
  const ctx = vm.createContext({ Math, String, JSON });
  vm.runInContext([
    constFrom(script, 'SHARE_COPY'),
    ...['esc', 'shareRuns', 'wrapShareRuns', 'fitShareText'].map(extractFunction),
    'this.SHARE_COPY = SHARE_COPY;',
  ].join('\n'), ctx);
  return ctx;
}
const plain = v => JSON.parse(JSON.stringify(v));
// Monospace stand-in: every char is 0.5em wide, bold 0.6em.
const mono = (text, bold, size) => text.length * size * (bold ? 0.6 : 0.5);
const lineText = l => l.segs.map(s => s.text).join('');

test('SP3: shareRuns splits <b> runs, drops other tags, decodes esc() entities', () => {
  const { shareRuns, esc } = textSandbox();
  assert.deepEqual(plain(shareRuns('A <b>bigger year</b> than 2024 — <b>27%</b> more')), [
    { text: 'A ', bold: false }, { text: 'bigger year', bold: true }, { text: ' than 2024 — ', bold: false },
    { text: '27%', bold: true }, { text: ' more', bold: false },
  ]);
  assert.deepEqual(plain(shareRuns(`<b>${esc('Tired Hands & "Co" <3')}</b> held`)), [
    { text: 'Tired Hands & "Co" <3', bold: true }, { text: ' held', bold: false },
  ]);
  // &amp; decodes last, so an escaped entity stays literal text.
  assert.deepEqual(plain(shareRuns(esc('&lt;'))), [{ text: '&lt;', bold: false }]);
  assert.deepEqual(plain(shareRuns('<i>x</i><span>y</span> <b>z</b><b>w</b>')), [
    { text: 'xy ', bold: false }, { text: 'zw', bold: true },
  ]);
  assert.deepEqual(plain(shareRuns('')), []);
  assert.deepEqual(plain(shareRuns(null)), []);
});

test('SP4: wrapShareRuns breaks at spaces, positions segments, keeps mixed-weight words whole', () => {
  const { shareRuns, wrapShareRuns } = textSandbox();
  const lines = wrapShareRuns(shareRuns('You tried <b>9 styles</b> for the first time'), 60, 10, mono);
  assert.deepEqual(plain(lines.map(lineText)), ['You tried 9', 'styles for', 'the first', 'time']);
  lines.forEach(l => {
    assert.ok(l.width <= 60);
    let x = 0;
    l.segs.forEach(s => { assert.ok(Math.abs(s.x - x) < 1e-9); x += mono(s.text, s.bold, 10); });
    assert.ok(Math.abs(l.width - x) < 1e-9);
    assert.notEqual(l.segs[0].text, ' ');
    assert.notEqual(l.segs[l.segs.length - 1].text, ' ');
  });
  assert.deepEqual(plain(lines[0].segs.filter(s => s.bold).map(s => s.text)), ['9']);
  // "27%," is one word made of a bold and a plain piece: it never splits.
  const glued = wrapShareRuns(shareRuns('ab <b>27%</b>, cd'), 30, 10, mono);
  assert.deepEqual(plain(glued.map(lineText)), ['ab', '27%,', 'cd']);
  // Whitespace collapses; a word wider than the slot can't wrap.
  assert.deepEqual(plain(wrapShareRuns(shareRuns("a  \n b"), 100, 10, mono).map(lineText)), ['a b']);
  assert.equal(wrapShareRuns(shareRuns('incomprehensibilities'), 50, 10, mono), null);
});

test('SP5: fitShareText keeps the starting size when the text fits', () => {
  const { shareRuns, fitShareText } = textSandbox();
  const fit = fitShareText(shareRuns('Hazy IPA enthusiast'), { width: 400, maxLines: 2, size: 40, minSize: 28 }, mono);
  assert.equal(fit.size, 40);
  assert.equal(fit.lines.length, 1);
});

test('SP6: fitShareText steps the size down to meet maxLines', () => {
  const { shareRuns, fitShareText } = textSandbox();
  const runs = shareRuns('A <b>bigger year</b> than 2024 — <b>27%</b> more check-ins');
  const fit = fitShareText(runs, { width: 400, maxLines: 2, size: 40, minSize: 20, step: 2 }, mono);
  assert.ok(fit.size < 40 && fit.size >= 20);
  assert.ok(fit.lines.length <= 2);
  // One size up would have needed a third line (or broken a word).
  const { wrapShareRuns } = textSandbox();
  const bigger = wrapShareRuns(runs, 400, fit.size + 2, mono);
  assert.ok(!bigger || bigger.length > 2);
});

test('SP7: fitShareText omits (null) rather than overflow or ellipsize', () => {
  const { shareRuns, fitShareText } = textSandbox();
  const long = shareRuns('word '.repeat(60));
  assert.equal(fitShareText(long, { width: 300, maxLines: 2, size: 40, minSize: 30 }, mono), null);
  assert.equal(fitShareText(shareRuns('Supercalifragilistic'), { width: 100, maxLines: 3, size: 40, minSize: 20 }, mono), null);
  assert.equal(fitShareText([], { width: 300, maxLines: 2, size: 40 }, mono), null);
});

test('SP8: fitShareText never returns text beyond the width or line cap', () => {
  const { shareRuns, fitShareText } = textSandbox();
  const samples = ['Tried <b>14 new breweries</b>, more than any year before',
    'Brewery loyalist with a <b>hazy</b> lean', 'An eclectic drinker — no single style owns you yet'];
  for (const html of samples) {
    for (const width of [180, 320, 600, 888]) {
      for (const maxLines of [1, 2, 3]) {
        const fit = fitShareText(shareRuns(html), { width, maxLines, size: 48, minSize: 30, step: 2 }, mono);
        if (!fit) continue;
        assert.ok(fit.size <= 48 && fit.size >= 30);
        assert.ok(fit.lines.length <= maxLines);
        fit.lines.forEach(l => assert.ok(l.width <= width + 1e-9));
        assert.equal(fit.lines.map(lineText).join(' '), shareRuns(html).map(r => r.text).join('').replace(/\s+/g, ' ').trim());
      }
    }
  }
});

test('SP9: without minSize the slot is fixed-size (fit or omit)', () => {
  const { shareRuns, fitShareText } = textSandbox();
  const runs = shareRuns('one two three four');
  assert.equal(fitShareText(runs, { width: 300, maxLines: 1, size: 40 }, mono), null);
  assert.equal(fitShareText(runs, { width: 300, maxLines: 2, size: 40 }, mono).size, 40);
});

test('SP10: SHARE_COPY holds the card and preview strings, no trailing whitespace or markup', () => {
  const { SHARE_COPY } = textSandbox();
  const required = ['wordmark', 'url', 'hopprintKicker', 'wrappedKicker', 'statCheckins', 'statBreweries',
    'statStyles', 'statNewBreweries', 'topVenue', 'previewTitle', 'formatStory', 'formatPortrait',
    'toggleVenue', 'shareButton', 'saveButton', 'rendering', 'renderFailed', 'privacyLine'];
  for (const k of required) assert.ok(k in SHARE_COPY, `SHARE_COPY.${k}`);
  assert.equal(SHARE_COPY.url, 'hopprint.app');
  assert.equal(SHARE_COPY.privacyLine, 'Made on this device. Nothing is uploaded.');
  assert.equal(SHARE_COPY.wrappedKicker(2025), '2025 WRAPPED');
  for (const [k, v] of Object.entries(SHARE_COPY)) {
    const s = typeof v === 'function' ? v(2025) : v;
    assert.equal(typeof s, 'string', k);
    assert.equal(s, s.trim(), k);
    assert.ok(!/[<>&]/.test(s), `${k} carries no markup`);
  }
});

// ── SP11–SP17: card layout, share/download (DE4, DE6, DE9, DE10) ──

function layoutSandbox(extra = {}) {
  const ctx = vm.createContext({ Math, String, JSON, Promise, setTimeout: f => f(), ...extra });
  vm.runInContext([
    ...['HOPPRINT_DIMS', 'HOPPRINT_DIM_LABELS', 'SHARE_COPY', 'SHARE_FORMATS', 'SHARE_PAD', 'SHARE_ROLES'].map(n => constFrom(script, n)),
    ...['hopprintGeometry', 'shareRuns', 'wrapShareRuns', 'fitShareText', 'shareFont', 'shareSpacedWidth',
      'layoutShareCard', 'shareFileName', 'downloadShareFile', 'shareOrDownload'].map(extractFunction),
    'this.SHARE_COPY = SHARE_COPY; this.SHARE_FORMATS = SHARE_FORMATS;',
  ].join('\n'), ctx);
  return ctx;
}
const FONTS = { headline: 'Big Shoulders', display: 'Unica One', body: 'Arial Narrow' };
// Stand-in measure: 0.5em per char (0.56em at 700+).
const fmeasure = (text, font) => {
  const size = parseFloat(font.match(/([\d.]+)px/)[1]);
  return [...text].length * size * (/^[78]00 /.test(font) ? 0.56 : 0.5);
};
const VEC = [3.2, 2.8, 1.4, 3.6, 3.1, 3.3, 2.2, 3.8];
const hopSpec = (identity = '“IPA drinker with a Massachusetts streak”') => ({ kicker: 'MY HOPPRINT', blocks: [
  { type: 'radar', vector: VEC },
  { type: 'text', role: 'identity', html: identity },
  { type: 'stats', items: [{ value: '2,841', label: 'Check-ins' }, { value: 155, label: 'Styles' }, { value: 283, label: 'Breweries' }] },
] });
const wrSpec = (body = 'A <b>bigger year</b> than 2024 — <b>27%</b> more check-ins.', venue = 'Moby Dick Brewing Co.') => ({ kicker: '2025 WRAPPED', blocks: [
  { type: 'hero', value: '786', label: 'beers logged' },
  { type: 'radar', vector: VEC },
  { type: 'stats', items: [{ value: 92, label: 'Breweries' }, { value: 70, label: 'Styles' }, { value: 22, label: 'New breweries' }] },
  { type: 'rows', optional: 2, formats: ['story'], items: [
    { label: 'Top brewery', value: 'Narragansett Brewing Company' }, { label: 'Top style', value: 'IPA - New England / Hazy' },
    { label: 'Top beer', value: 'Fresh Squeezed' },
    ...(venue ? [{ label: 'Top venue', value: venue }] : []),
  ] },
  { type: 'text', role: 'body', html: body, optional: 1 },
] });
const textOps = L => L.ops.filter(o => o.op === 'text');

test('SP11: every op lands inside the card, footer always drawn, kicker first', () => {
  const { layoutShareCard, SHARE_FORMATS } = layoutSandbox();
  for (const fmt of ['story', 'portrait']) {
    for (const spec of [hopSpec(), wrSpec(), wrSpec(undefined, null)]) {
      const L = layoutShareCard(spec, fmt, fmeasure, FONTS);
      assert.equal(L.w, 1080);
      assert.equal(L.h, SHARE_FORMATS[fmt].h);
      for (const o of L.ops) {
        if (o.op === 'glow') continue;
        if (o.op === 'radar') {
          assert.ok(o.cy - o.R > 0 && o.cy + o.R < L.h);
          continue;
        }
        assert.ok(o.x >= 0 && o.x <= L.w, `${fmt} ${o.op} x=${o.x}`);
        assert.ok(o.y >= 0 && o.y <= L.h, `${fmt} ${o.op} y=${o.y}`);
        if (o.op === 'text' && (o.align || 'left') === 'left') {
          assert.ok(o.x + fmeasure(o.text, o.font) <= L.w - 96 + 1, `${fmt} "${o.text}" overflows the right margin`);
        }
      }
      const texts = textOps(L).map(o => o.text);
      assert.equal(texts[0], spec.kicker);
      assert.ok(texts.includes('HOPPRINT') && texts.includes('hopprint.app'));
      assert.ok(L.ops.some(o => o.op === 'image' && o.key === 'logo'));
      // Footer sits below every content op.
      const footTop = L.ops.find(o => o.op === 'image').y;
      L.ops.filter(o => o.op === 'rect' || o.op === 'radar').forEach(o => assert.ok((o.y || o.cy + o.R) < footTop));
    }
  }
});

test('SP12: radar flexes within its bounds and gets more room on story', () => {
  const { layoutShareCard, SHARE_FORMATS } = layoutSandbox();
  const noRows = wrSpec();
  noRows.blocks = noRows.blocks.filter(b => b.type !== 'rows');
  for (const spec of [hopSpec(), noRows, wrSpec()]) {
    const s = layoutShareCard(spec, 'story', fmeasure, FONTS), p = layoutShareCard(spec, 'portrait', fmeasure, FONTS);
    if (spec !== noRows && spec.blocks.some(b => b.type === 'rows')) assert.ok(s.radius >= 170);
    else assert.ok(s.radius > p.radius);
    assert.ok(s.radius <= SHARE_FORMATS.story.rMax && p.radius <= SHARE_FORMATS.portrait.rMax);
    assert.ok(p.radius >= 170 * SHARE_FORMATS.portrait.scale);
    assert.equal(s.ops.filter(o => o.op === 'radar').length, 1);
  }
  const noRadar = layoutShareCard({ kicker: 'K', blocks: [{ type: 'radar', vector: null }] }, 'story', fmeasure, FONTS);
  assert.equal(noRadar.ops.filter(o => o.op === 'radar').length, 0);
  assert.equal(noRadar.omitted.length, 1);
});

test('SP13: text that cannot fit its role is omitted, never drawn past its lines', () => {
  const ctx = layoutSandbox();
  vm.runInContext('this.SHARE_ROLES = SHARE_ROLES;', ctx);
  const { layoutShareCard, SHARE_ROLES } = ctx;
  const long = 'word '.repeat(80).trim();
  for (const fmt of ['story', 'portrait']) {
    const L = layoutShareCard(wrSpec(long), fmt, fmeasure, FONTS);
    assert.ok(!textOps(L).some(o => o.text === 'word'), 'overlong body omitted');
    assert.ok(L.omitted.some(b => b.type === 'text'));
    const ok = layoutShareCard(wrSpec(), fmt, fmeasure, FONTS);
    const bodyOps = textOps(ok).filter(o => /px Arial Narrow$/.test(o.font) && o.fill === '--text-muted');
    const lines = new Set(bodyOps.map(o => o.y));
    assert.ok(lines.size >= 1 && lines.size <= SHARE_ROLES.body.maxLines);
  }
});

test('SP14: overflow drops optional blocks last-first, keeps required ones', () => {
  const { layoutShareCard } = layoutSandbox();
  const crowded = { kicker: 'K', blocks: [
    { type: 'radar', vector: VEC },
    { type: 'stats', items: [{ value: 1, label: 'A' }] },
    { type: 'stats', items: [{ value: 2, label: 'B' }] },
    { type: 'stats', items: [{ value: 3, label: 'C' }], optional: true },
    { type: 'stats', items: [{ value: 4, label: 'D' }], optional: true },
    { type: 'stats', items: [{ value: 5, label: 'E' }], optional: true },
  ] };
  const L = layoutShareCard(crowded, 'portrait', fmeasure, FONTS);
  const shown = textOps(L).map(o => o.text);
  assert.ok(shown.includes('A') && shown.includes('B'));
  assert.ok(L.omitted.length >= 1);
  // Dropped from the end: whatever survives among the optionals is a prefix.
  const opt = ['C', 'D', 'E'].map(t => shown.includes(t));
  assert.deepEqual(opt, [...opt].sort((a, b) => b - a));
  assert.ok(!opt[2], 'last optional dropped first');
  // A roomy spec drops nothing.
  assert.equal(layoutShareCard(hopSpec(), 'portrait', fmeasure, FONTS).omitted.length, 0);
});

test('SP15: card text comes only from the spec and SHARE_COPY', () => {
  const { layoutShareCard, SHARE_COPY } = layoutSandbox();
  const fixed = new Set(Object.values(SHARE_COPY).filter(v => typeof v === 'string'));
  for (const fmt of ['story', 'portrait']) {
    for (const spec of [hopSpec(), wrSpec()]) {
      const L = layoutShareCard(spec, fmt, fmeasure, FONTS);
      const allowed = new Set([...fixed, spec.kicker]);
      spec.blocks.forEach(b => {
        if (b.type === 'hero') { allowed.add(String(b.value)); allowed.add(b.label); }
        if (b.type === 'stats') b.items.forEach(it => { allowed.add(String(it.value)); allowed.add(String(it.label).toUpperCase()); });
        if (b.type === 'rows') b.items.forEach(it => { allowed.add(String(it.label).toUpperCase()); allowed.add(String(it.value)); });
        if (b.type === 'text') b.html.replace(/<[^>]+>/g, '').split(/\s+/).forEach(w => allowed.add(w));
      });
      textOps(L).forEach(o => {
        const ok = allowed.has(o.text) || o.text.split(/\s+/).every(w => allowed.has(w));
        assert.ok(ok, `unexpected card text "${o.text}"`);
      });
    }
  }
});

test('SP16: shareOrDownload shares in the tap, cancels silently, else downloads', async () => {
  const clicks = [];
  const doc = {
    createElement: () => ({ click() { clicks.push(this.download); }, remove() {} }),
    body: { appendChild() {} },
  };
  const URLs = { createObjectURL: () => 'blob:x', revokeObjectURL() {} };
  const file = { name: 'hopprint-print-story.png' };
  const run = async nav => {
    clicks.length = 0;
    const ctx = layoutSandbox({ navigator: nav, document: doc, URL: URLs });
    let calledSync = false;
    const p = ctx.shareOrDownload(file);
    calledSync = nav.shared === 1;
    return { result: await p, calledSync, downloads: clicks.slice() };
  };
  const nav = impl => ({ shared: 0, canShare: () => true, share(d) { this.shared++; return impl(d); } });
  let r = await run(nav(() => Promise.resolve()));
  assert.deepEqual([r.result, r.calledSync, r.downloads.length], ['shared', true, 0]);
  r = await run(nav(() => Promise.reject({ name: 'AbortError' })));
  assert.deepEqual([r.result, r.downloads.length], ['cancelled', 0]);
  r = await run(nav(() => Promise.reject({ name: 'NotAllowedError' })));
  assert.deepEqual([r.result, r.downloads], ['downloaded', [file.name]]);
  r = await run({ canShare: () => false, share() { throw new Error('should not share'); } });
  assert.deepEqual([r.result, r.downloads], ['downloaded', [file.name]]);
  r = await run({ canShare() { throw new TypeError('bad'); }, share() { throw new Error('should not share'); } });
  assert.deepEqual([r.result, r.downloads], ['downloaded', [file.name]]);
  r = await run({});
  assert.deepEqual([r.result, r.downloads], ['downloaded', [file.name]]);
});

test('SP17: share filenames follow §3.5', () => {
  const { shareFileName } = layoutSandbox();
  assert.equal(shareFileName('wrapped', 'story', 2025), 'hopprint-wrapped-2025-story.png');
  assert.equal(shareFileName('wrapped', 'portrait', 2024), 'hopprint-wrapped-2024-portrait.png');
  assert.equal(shareFileName('print', 'story'), 'hopprint-print-story.png');
  assert.equal(shareFileName('print', 'portrait'), 'hopprint-print-portrait.png');
});

test('SP18: favorites rows draw label/value pairs; a value too long for its row drops alone', () => {
  const { layoutShareCard } = layoutSandbox();
  const L = layoutShareCard(wrSpec(), 'story', fmeasure, FONTS);
  const t = textOps(L);
  for (const [label, value] of [['TOP BREWERY', 'Narragansett Brewing Company'], ['TOP BEER', 'Fresh Squeezed'], ['TOP VENUE', 'Moby Dick Brewing Co.']]) {
    const l = t.find(o => o.text === label), v = t.find(o => o.text === value);
    assert.ok(l && v, label);
    assert.equal(v.align, 'right');
    assert.ok(Math.abs(l.y - v.y) < 4, 'label and value share a line');
  }
  const long = { kicker: 'K', blocks: [{ type: 'rows', items: [
    { label: 'Top beer', value: 'x'.repeat(200) }, { label: 'Top style', value: 'Stout' }, { label: 'Top venue', value: '' }] }] };
  const L2 = layoutShareCard(long, 'story', fmeasure, FONTS);
  assert.ok(!textOps(L2).some(o => /^x+$/.test(o.text)));
  assert.ok(textOps(L2).some(o => o.text === 'Stout'));
  assert.ok(L2.omitted.some(b => b.type === 'row' && b.label === 'Top beer'));
  assert.ok(!textOps(L2).some(o => o.text === 'TOP VENUE'), 'empty value skipped');
  const none = layoutShareCard({ kicker: 'K', blocks: [{ type: 'rows', items: [{ label: 'A', value: '' }] }, { type: 'mystery' }] }, 'story', fmeasure, FONTS);
  assert.equal(none.omitted.length, 2, 'empty rows block and unknown block types are omitted');
});

test('SP19: favorites are story-only; overflow drops rank 2 before rank 1', () => {
  const { layoutShareCard } = layoutSandbox();
  const portrait = textOps(layoutShareCard(wrSpec(), 'portrait', fmeasure, FONTS)).map(o => o.text);
  assert.ok(!portrait.includes('TOP BREWERY'), 'no favorites on portrait');
  assert.ok(portrait.includes('bigger'), 'copy line kept on portrait');
  const story = textOps(layoutShareCard(wrSpec(), 'story', fmeasure, FONTS)).map(o => o.text);
  assert.ok(story.includes('TOP BREWERY') && story.includes('bigger'));
  // Squeeze story: the favorites (rank 2) go before the copy line (rank 1).
  const spec = wrSpec();
  spec.blocks.splice(3, 0, { type: 'stats', items: [{ value: 1, label: 'X' }] }, { type: 'stats', items: [{ value: 2, label: 'Y' }] });
  const L = layoutShareCard(spec, 'story', fmeasure, FONTS);
  const t = textOps(L).map(o => o.text);
  assert.ok(!t.includes('TOP BREWERY') || t.includes('bigger'), 'favorites never outlive the copy line');
  assert.equal(L.omitted[0].type, 'rows', 'rows dropped first');
});

// ── SP20–SP23: preview → share flow (DE12) ───────────────────────

function previewSandbox({ nav = {}, renders } = {}) {
  const els = {};
  // Only the modal's own ids exist; the preview's inner nodes come from
  // innerHTML, so every paint here takes the first-paint path.
  const KNOWN = ['shareModal', 'shareTitle', 'shareClose', 'shareBody'];
  const el = id => !KNOWN.includes(id) ? null : els[id] || (els[id] = {
    id, innerHTML: '', textContent: '', attrs: {}, classes: new Set(),
    classList: { add(c) { els[id].classes.add(c); }, remove(c) { els[id].classes.delete(c); } },
    setAttribute(k, v) { els[id].attrs[k] = v; },
  });
  const calls = { share: [], toasts: [], revoked: [] };
  let urlSeq = 0;
  const ctx = vm.createContext({
    Math, String, JSON, Promise, Object,
    document: { getElementById: el },
    navigator: nav,
    URL: { createObjectURL: () => `blob:${++urlSeq}`, revokeObjectURL: u => calls.revoked.push(u) },
    File: class { constructor(parts, name, opts) { this.parts = parts; this.name = name; this.type = opts.type; } },
    renderShareCard: (spec, fmt) => renders(spec, fmt),
    shareOrDownload: file => { calls.share.push(file.name); return calls.next || Promise.resolve('shared'); },
    showToast: (m, i) => calls.toasts.push([m, i]),
    icon: n => `<i data-icon="${n}"></i>`,
  });
  vm.runInContext([
    ...['SHARE_COPY', 'SHARE_FORMATS'].map(n => constFrom(script, n)),
    ...['esc', 'shareFileName', 'sharePreviewHTML', 'paintSharePreview', 'renderSharePreview', 'openSharePreview',
      'closeSharePreview', 'setShareFormat', 'setShareToggle', 'shareNow'].map(extractFunction),
    'let shareState = null;',
    'this.state = () => shareState; this.SHARE_COPY = SHARE_COPY;',
  ].join('\n'), ctx);
  return { ctx, els, calls };
}
const tick = () => new Promise(r => setImmediate(r));
const consumer = (over = {}) => ({ kind: 'wrapped', year: 2025, buildSpec: (f, t) => ({ f, t }), toggles: [{ key: 'venue', label: 'Show top venue' }], ...over });

test('SP20: preview markup: story first, toggles off, Share disabled until the image is ready', () => {
  const { ctx } = previewSandbox();
  const st = { consumer: consumer({ toggles: [{ key: 'venue', label: 'Venue <&>' }] }), format: 'story', toggles: { venue: false },
    file: null, url: null, busy: true, error: false, canShare: null };
  let h = ctx.sharePreviewHTML(st);
  assert.match(h, /class="seg-btn active"[^>]*aria-pressed="true"[^>]*>Story</);
  assert.match(h, /aria-pressed="false"[^>]*>Portrait</);
  assert.match(h, /type="checkbox" data-toggle="venue"  onchange/, 'venue toggle unchecked');
  assert.match(h, /id="shareStage"/);
  assert.match(h, /data-fmt="story"/);
  assert.match(h, /Venue &lt;&amp;>/);
  assert.match(h, /id="shareGo"[^>]*disabled/);
  assert.ok(h.includes(ctx.SHARE_COPY.rendering));
  assert.ok(h.includes(ctx.SHARE_COPY.privacyLine));
  Object.assign(st, { file: { name: 'x' }, url: 'blob:1', busy: false, canShare: true });
  h = ctx.sharePreviewHTML(st);
  assert.ok(!/id="shareGo"[^>]*disabled/.test(h));
  assert.match(h, /<img class="share-img" src="blob:1"/);
  assert.ok(h.includes(`<span>${ctx.SHARE_COPY.shareButton}</span>`));
  st.canShare = false;
  assert.ok(ctx.sharePreviewHTML(st).includes(`<span>${ctx.SHARE_COPY.saveButton}</span>`), 'no share sheet → Save image');
  st.error = true;
  assert.ok(ctx.sharePreviewHTML(st).includes(ctx.SHARE_COPY.renderFailed));
});

test('SP21: opening renders at once with toggles off; changes re-render; filenames follow the format', async () => {
  const seen = [];
  const { ctx, els } = previewSandbox({ nav: { share() {}, canShare: () => true }, renders: (spec, fmt) => { seen.push([fmt, spec.t.venue]); return Promise.resolve({ size: 1 }); } });
  ctx.openSharePreview(consumer());
  assert.ok(els.shareModal.classes.has('open'));
  assert.equal(els.shareTitle.textContent, 'Share');
  await tick();
  assert.equal(ctx.state().file.name, 'hopprint-wrapped-2025-story.png');
  assert.equal(ctx.state().canShare, true);
  ctx.setShareToggle('venue', true); await tick();
  ctx.setShareFormat('portrait'); await tick();
  ctx.setShareFormat('portrait'); await tick(); // no-op
  ctx.setShareFormat('square'); await tick();   // unknown format ignored
  ctx.setShareToggle('nope', true); await tick();
  assert.deepEqual(JSON.parse(JSON.stringify(seen)), [['story', false], ['story', true], ['portrait', true]]);
  assert.equal(ctx.state().file.name, 'hopprint-wrapped-2025-portrait.png');
  ctx.closeSharePreview();
  assert.ok(!els.shareModal.classes.has('open'));
  assert.equal(ctx.state(), null);
});

test('SP22: a slower older render never replaces a newer one; a failed render shows the error', async () => {
  const pending = [];
  const { ctx, els } = previewSandbox({ renders: (spec, fmt) => new Promise((res, rej) => pending.push({ fmt, res, rej })) });
  ctx.openSharePreview(consumer({ kind: 'print', year: undefined, toggles: [] }));
  ctx.setShareFormat('portrait');
  pending[1].res({ size: 2 }); await tick();
  pending[0].res({ size: 1 }); await tick();
  assert.equal(ctx.state().file.name, 'hopprint-print-portrait.png');
  assert.ok(!ctx.state().busy);
  ctx.setShareFormat('story');
  pending[2].rej(new Error('boom')); await tick();
  assert.equal(ctx.state().error, true);
  assert.equal(ctx.state().file, null);
  assert.ok(els.shareBody.innerHTML.includes(ctx.SHARE_COPY.renderFailed));
});

test('SP23: Share hands the pre-rendered file over synchronously; result handling', async () => {
  const { ctx, calls, els } = previewSandbox({ renders: () => Promise.resolve({ size: 1 }) });
  ctx.shareNow(); // nothing open
  ctx.openSharePreview(consumer());
  ctx.shareNow(); // still rendering → ignored
  assert.equal(calls.share.length, 0);
  await tick();
  ctx.shareNow();
  assert.deepEqual(calls.share, ['hopprint-wrapped-2025-story.png'], 'called in the same tick as the tap');
  await tick();
  assert.ok(!els.shareModal.classes.has('open'), 'closes after a completed share');
  ctx.openSharePreview(consumer()); await tick();
  calls.next = Promise.resolve('downloaded');
  ctx.shareNow(); await tick();
  assert.deepEqual(JSON.parse(JSON.stringify(calls.toasts)), [['Image saved', 'success']]);
  assert.ok(els.shareModal.classes.has('open'));
  calls.next = Promise.resolve('cancelled');
  ctx.shareNow(); await tick();
  assert.equal(calls.toasts.length, 1, 'cancel is silent');
  assert.ok(els.shareModal.classes.has('open'));
});

// ── SP24–SP27: Hopprint identity card (DE11, §3.6) ────────────────

const STYLE_MATRIX = require('../style_matrix.js');
function hopCardSandbox() {
  const ctx = vm.createContext({ Math, String, JSON, Date, Object, Array, Set, STYLE_MATRIX, console });
  vm.runInContext([
    ...['HOPPRINT_DIMS', 'RATING_BANDS', 'HOME_VENUE', 'SHARE_COPY', 'PROFILE_COPY', 'PROFILE_ZONE_ORDER', 'PROFILE_MAX_EARNED'].map(n => constFrom(script, n)),
    'let STYLE_KEY_INDEX = null;',
    ...['normalizeStyleKey', 'resolveMatrixStyle', 'computeHopprint', 'countBy', 'bandOf', 'computeBandAnalytics',
      'isHomeEntry', 'validAbv', 'computeProfileContext', 'esc', 'selectCopy', 'buildProfileHeroCopy', 'buildHopprintCardSpec'].map(extractFunction),
    'var entries = [];',
    'this.PROFILE_COPY = PROFILE_COPY; this.SHARE_COPY = SHARE_COPY;',
  ].join('\n'), ctx);
  return ctx;
}
const MSTYLES = Object.keys(STYLE_MATRIX);
let hseq = 0;
const hck = (o = {}) => ({ id: 'h' + (hseq++), beer_name: 'B', brewery_name: 'Br', brewery_state: 'MA', beer_type: MSTYLES[0],
  source: 'live', created_at: '2025-05-10T18:00:00Z', ...o });
const withStyles = (n, per = 3, extra = {}) => Array.from({ length: n * per }, (_, i) =>
  hck({ beer_type: MSTYLES[i % n], brewery_name: 'Br' + (i % 7), ...extra }));

test('SP24: anchor candidates (and only they) carry shareSlot in PROFILE_COPY', () => {
  const { PROFILE_COPY } = hopCardSandbox();
  PROFILE_COPY.forEach(c => assert.equal(!!c.shareSlot, c.zone === 'anchor', c.id));
  assert.equal(PROFILE_COPY.filter(c => c.shareSlot).length, 4);
});

test('SP25: card gate matches the radar gate — 3 matched styles: no card, 4: card', () => {
  const ctx = hopCardSandbox();
  const three = withStyles(3);
  ctx.entries = three;
  assert.equal(ctx.computeHopprint(three).matchedStyles, 3);
  assert.equal(ctx.buildHopprintCardSpec(three), null);
  const four = withStyles(4);
  ctx.entries = four;
  assert.equal(ctx.computeHopprint(four).matchedStyles, 4);
  const spec = ctx.buildHopprintCardSpec(four);
  assert.ok(spec);
  assert.equal(spec.kicker, ctx.SHARE_COPY.hopprintKicker);
  assert.deepEqual(JSON.parse(JSON.stringify(spec.blocks.map(b => b.type))), ['radar', 'text', 'stats']);
  assert.equal(JSON.stringify(spec.blocks[0].vector), JSON.stringify(ctx.computeHopprint(four).vector));
});

test('SP26: identity line matches the hero, quoted; stats are all-time incl. imports; no venue', () => {
  const ctx = hopCardSandbox();
  const old = withStyles(4, 3, { created_at: '2019-03-01T18:00:00Z', source: 'import', venue_name: 'Secret Bar' });
  const recent = withStyles(5, 4, { venue_name: 'Secret Bar' });
  const all = [...old, ...recent];
  ctx.entries = all;
  const spec = ctx.buildHopprintCardSpec(all);
  const hero = ctx.buildProfileHeroCopy(ctx.computeProfileContext(all));
  const text = spec.blocks.find(b => b.type === 'text');
  assert.equal(text.role, 'identity');
  assert.equal(text.html, `“${hero.identity}”`);
  const stats = spec.blocks.find(b => b.type === 'stats').items;
  assert.deepEqual(JSON.parse(JSON.stringify(stats)), [
    { value: String(all.length), label: 'Check-ins' },
    { value: String(new Set(all.map(e => e.beer_type)).size), label: 'Styles' },
    { value: String(new Set(all.map(e => e.brewery_name)).size), label: 'Breweries' },
  ]);
  assert.ok(!JSON.stringify(spec).includes('Secret Bar'), 'no venue on the identity card');
  assert.ok(!spec.blocks.some(b => b.type === 'rows'));
  // Thousands separator for big histories.
  const big = withStyles(4, 300);
  ctx.entries = big;
  assert.equal(ctx.buildHopprintCardSpec(big).blocks[2].items[0].value, '1,200');
});

test('SP27: Hopprint Share pill renders only past the radar gate and opens the print preview', () => {
  const rp = extractFunction('renderProfile');
  assert.match(rp, /allTimeHP\.matchedStyles >= 4 \? `<button class="share-pill" onclick="shareHopprint\(\)">/);
  assert.match(rp, /SHARE_COPY\.shareButton/);
  const sh = extractFunction('shareHopprint');
  assert.match(sh, /kind: 'print'/);
  assert.match(sh, /toggles: \[\]/);
  assert.match(sh, /if \(!buildHopprintCardSpec\(entries\)\) return;/);
});

test('SP28: an open modal locks the page behind it (all modals)', () => {
  const { style } = require('./helpers');
  assert.match(style, /html:has\(\.modal-backdrop\.open\) \{ overflow: hidden; \}/);
  assert.match(style, /\.modal \{[^}]*overscroll-behavior: contain;/);
});
