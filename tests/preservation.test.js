#!/usr/bin/env node
// Byte-identical preservation (SYNC_REVERSAL_WORKPLAN.md Phase 6). Every
// function that existed in the last pre-sync build (eb1a746, the brand-refresh
// merge) must be unchanged today, except the ones a phase deliberately edited —
// each listed below with the decision that required it. A new edit to any
// other original function fails here until it is justified and listed.
//
//   node --test tests/preservation.test.js      (needs the git history)

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const { ROOT, script, inlineScript, allFunctions } = require('./helpers');

const BASELINE = 'eb1a746';

const ALLOWED_CHANGES = {
  // Phase 2 — write sites queue uploads (SY6), client uuids (SY4), import skips undated rows (SY7d)
  submitCheckin: 'SY4 uuid id + SY6 queue',
  saveRating: 'SY6 queue; HL6 refreshHistory()',
  saveEdit: 'SY6 queue; HL6 refreshHistory()',
  deleteEntry: 'SY6 queue delete; HL6 refreshHistory()',
  handleImport: 'SY4 uuids, SY7(d) undated skip + report, SY6 queue; HL7 reset My Beers position',
  addWishlistItem: 'SY11 uuid id + SY6 queue',
  removeWish: 'SY11 remove by id + SY6 queue delete',
  // Phase 2 — quoted ids in inline handlers (SY4 build-time catch)
  renderHistory: 'SY4 idArg at two sites; HL11 esc(); HL9/HL2 sort + batch, markup moved to historyCard; HL3 watch sentinel; HL4 clears dirty, animate flag',
  openEdit: 'SY4 idArg at one site',
  renderWishlist: 'SY11 remove by id',
  // Phase 4 — OS1
  maybeShowWelcome: 'OS1 wait for the first pull',
  // Icons + nav (ICONS_NAV_WORKPLAN.md) — IT3 icon → iconName consumers (IN20)
  buildOccasionGrid: 'IN20 occasion icon()',
  openRatingModal: 'IN20 rating band icon()',
  buildFeedbackCatGrid: 'IN20 feedback category icon()',
  drillBandSection: 'IN20 band segment icon() (IN7)',
  buildModeGrid: 'IN20 mode icon()',
  // IT4 — milestones keyed by kind (IN19)
  computeMilestones: 'IN19 kind replaces emoji icon',
  renderAnalytics: 'IN19 milestone icon from kind; ST5 card order; ST7/ST11 collapsible cards, lazy charts',
  buildBandCard: 'ST7 collapsible card via statsCard()',
  setNvrField: 'ST14 keep position on rebuild',
  toggleAnalyticsCompare: 'ST4 jump to top',
  setAnalyticsYear: 'ST4 jump to top',
  computeAnalyticsContext: 'IN19 compare on kind',
  // IT6 — template icon slots (IN1)
  setPrompt: 'IN1 note icon + textContent span',
  buildAnalyticsInsightCard: 'IN1 insight icon',
  renderProfile: 'IN1 empty state, ABV trend, trend rows',
  generateRecs: 'IN1/IN18 empty state + CTA',
  renderNextRec: 'IN1/IN18 empty state, Show Another',
  // IT7 — showToast(msg, iconName) (IN8)
  showToast: 'IN8 icon + textContent span',
  submitFeedback: 'IN8 toast iconName',
  exportCSV: 'IN8 toast iconName',
  exportJSON: 'IN8 toast iconName',
  // IT9 — bottom nav (IN16)
  switchTab: 'IN16 .bn-item selector + aria-current; HL5 scroll save, HL4 enterHistory(); ST1/ST2 per-page scroll; ST10 enterAnalytics()',
  // Autofill details rebuilt from every check-in (tests/autofill.test.js)
  buildLiveLists: 'autofill BEER_DB/BREWERY_DB from entries on every rebuild',
  // History perf (HISTORY_PERF_WORKPLAN.md)
  esc: 'HL11 escapes & too; String() so numeric values do not throw',
  save: 'HL4 marks the My Beers list dirty; ST10 and Stats',
};

let baselineScript;
try {
  baselineScript = inlineScript(execFileSync('git', ['show', `${BASELINE}:index.html`], { cwd: ROOT, encoding: 'utf8' }));
} catch (e) {
  baselineScript = null;
}

test('baseline build is available', { skip: baselineScript ? false : 'git history not available' }, () => {
  assert.ok(baselineScript.length > 1000);
});

test('every original function still exists', { skip: !baselineScript }, () => {
  const now = allFunctions(script);
  const missing = Object.keys(allFunctions(baselineScript)).filter(n => !(n in now));
  assert.deepEqual(missing, []);
});

test('original functions are byte-identical except the listed, justified ones', { skip: !baselineScript }, () => {
  const before = allFunctions(baselineScript);
  const now = allFunctions(script);
  const changed = Object.keys(before).filter(n => before[n] !== now[n]);
  const unexpected = changed.filter(n => !(n in ALLOWED_CHANGES));
  assert.deepEqual(unexpected, [], `changed without a listed reason: ${unexpected.join(', ')}`);
  // Keep the list honest: an entry that no longer differs should be removed.
  const stale = Object.keys(ALLOWED_CHANGES).filter(n => !changed.includes(n));
  assert.deepEqual(stale, [], `listed but unchanged: ${stale.join(', ')}`);
});

test('init() is untouched — the gate calls it, it does not call the gate', { skip: !baselineScript }, () => {
  assert.equal(allFunctions(script).init, allFunctions(baselineScript).init);
  assert.match(script, /\nauthBoot\(\);\n/);
  assert.doesNotMatch(script, /\ninit\(\);\n/);
});

test('whole inline script compiles (node --check equivalent)', () => {
  const vm = require('vm');
  assert.doesNotThrow(() => new vm.Script(script, { filename: 'index.html#inline' }));
});
