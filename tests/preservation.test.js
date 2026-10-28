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
  submitCheckin: 'SY4 uuid id + SY6 queue; OC1 occasion_ctx: []; VR9a normalizeVenue',
  saveRating: 'SY6 queue; HL6 refreshHistory()',
  submitRating: 'rating modal closes through closeRatingModal() (deferred "Checked in!" toast)',
  skipRating: 'rating modal closes through closeRatingModal() (deferred "Checked in!" toast)',
  saveEdit: 'SY6 queue; HL6 refreshHistory(); VR9a normalizeVenue, VR12 buildLiveLists()',
  deleteEntry: 'SY6 queue delete; HL6 refreshHistory(); VR12 buildLiveLists()',
  handleImport: 'SY4 uuids, SY7(d) undated skip + report, SY6 queue; HL7 reset My Beers position; PT6 refresh Print; VR3 normalizeVenue; Discover redesign: diagnostic comment no longer names retired modes',
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
  buildModeGrid: 'IN20 mode icon(); DS4 per-mode gates, greyed reasons, DS5 all-gated locked state',
  // IT4 — milestones keyed by kind (IN19)
  computeMilestones: 'IN19 kind replaces emoji icon',
  renderAnalytics: 'IN19 milestone icon from kind; ST5 card order; ST7/ST11 collapsible cards, lazy charts; SC10 beerKeyOf for New vs Repeat Beers, SC21 validAbv',
  buildBandCard: 'ST7 collapsible card via statsCard()',
  setNvrField: 'ST14 keep position on rebuild',
  toggleAnalyticsCompare: 'ST4 jump to top',
  setAnalyticsYear: 'ST4 jump to top',
  // Stat cards (STAT_CARDS_WORKPLAN.md)
  firstOccurrenceIds: 'SC10 accepts a key function (beerKeyOf) as well as a field name',
  computeProfileContext: 'SC21/SC22 validAbv for Avg ABV and the ABV trajectory',
  computeAnalyticsContext: 'IN19 compare on kind; Phase E (a) milestone ranking moved to milestonesCrossedIn()',
  // IT6 — template icon slots (IN1)
  setPrompt: 'IN1 note icon + textContent span',
  buildAnalyticsInsightCard: 'IN1 insight icon',
  buildHopprintSVG: 'Phase E (c) DE5 geometry moved to hopprintGeometry() for the canvas share card; SVG output identical (SP1)',
  renderProfile: 'IN1 empty state, ABV trend, trend rows; PT1/PT5 clears dirty, records the build date; Phase E (a) Wrapped entry card + Earlier years; Phase E (c) Hopprint Share pill in the hero kicker row; SC21 validAbv in the ABV trend',
  generateRecs: 'IN1/IN18 empty state + CTA; DS1/DS6 dispatches to the selected mode\'s build(), after its precheck()',
  renderNextRec: 'IN1/IN18 empty state, Show Another; DS6 per-mode card renderer, suppression key, footer actions',
  // IT7 — showToast(msg, iconName) (IN8)
  showToast: 'IN8 icon + textContent span',
  submitFeedback: 'IN8 toast iconName',
  exportCSV: 'IN8 toast iconName',
  exportJSON: 'IN8 toast iconName',
  // IT9 — bottom nav (IN16)
  switchTab: 'IN16 .bn-item selector + aria-current; HL5 scroll save, HL4 enterHistory(); ST1/ST2 per-page scroll; ST10 enterAnalytics(); PT2 enterProfile(); DS4 enterDiscover() re-evaluates mode gates',
  // Autofill details rebuilt from every check-in (tests/autofill.test.js)
  buildLiveLists: 'autofill BEER_DB/BREWERY_DB from entries on every rebuild; VR12 venue/purchase frecency scores',
  // History perf (HISTORY_PERF_WORKPLAN.md)
  esc: 'HL11 escapes & too; String() so numeric values do not throw',
  save: 'HL4 marks the My Beers list dirty; ST10 and Stats; PT1 and Print',
  // Stub + occasion (STUB_OCCASION_WORKPLAN.md) — OC1 context tags leave the form
  init: 'OC1 drops the buildCtxPills() call; VR4 calls migrateHomeVenue(); VR18 venue/purchase rankers (see the init() test below)',
  setupAC: 'VR18 optional rank argument, passed through to showDrop',
  showDrop: 'VR18 optional rank sorts matches before the cap of 8',
  resetForm: 'OC1 drops the two context-tag reset lines; VR16 re-shows the recall chips',
  // Discover redesign (DISCOVER_REDESIGN_HANDOFF.md) — per-mode suppression keys (§8), gating (DS4)
  recordShown: '§8 rows are { mode, key, timestamp }; 31-day prune',
  notInterestedRec: '§8 param renamed style → key (body unchanged in behavior)',
  selectMode: 'DS4 gated modes cannot be selected; renders the mode\'s sub-picker',
};

// Original functions deliberately deleted, each with the decision that removed it.
const ALLOWED_REMOVALS = {
  // (listed in source order — the test compares against the baseline's order)
  // Discover redesign — DS1 retires Wheelhouse / Slightly Outside / Way Outside / Random (§8)
  isStyleSuppressed: '§8 replaced by isSuppressed(key, mode, …)',
  buildFamiliarityFallbackSignal: 'Occasion task — unused once the old modes went; Occasion is gated on rated check-ins',
  pickStyleRanking: 'DS1 retired with the old modes',
  buildAffinityRecs: 'DS1 retired with the old modes',
  wildcardConfidence: 'DS1 retired with the old modes',
  rationaleFor: 'DS1 retired with the old modes',
  buildCtxPills: 'OC1 context tags removed from the check-in form',
  toggleCtx: 'OC1 context tags removed from the check-in form',
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
  assert.deepEqual(missing, Object.keys(ALLOWED_REMOVALS));
});

test('original functions are byte-identical except the listed, justified ones', { skip: !baselineScript }, () => {
  const before = allFunctions(baselineScript);
  const now = allFunctions(script);
  const changed = Object.keys(before).filter(n => before[n] !== now[n]);
  const unexpected = changed.filter(n => !(n in ALLOWED_CHANGES) && !(n in ALLOWED_REMOVALS));
  assert.deepEqual(unexpected, [], `changed without a listed reason: ${unexpected.join(', ')}`);
  // Keep the list honest: an entry that no longer differs should be removed.
  const stale = Object.keys(ALLOWED_CHANGES).filter(n => !changed.includes(n));
  assert.deepEqual(stale, [], `listed but unchanged: ${stale.join(', ')}`);
});

test('init() is untouched but for OC1, VR4 and VR18 — the gate calls it, it does not call the gate', { skip: !baselineScript }, () => {
  const vrInit = allFunctions(script).init
    .replace('  migrateHomeVenue();\n\n', '')
    .replace("setupAC('venueWhere', SEED.venues, null, placeRanker(() => venueScores));", "setupAC('venueWhere', SEED.venues);")
    .replace("setupAC('purchaseVenue', SEED.purchase, null, placeRanker(() => purchaseScores));\n  RECALL_FIELDS.forEach(setupRecallChips);", "setupAC('purchaseVenue', SEED.purchase);");
  assert.equal(vrInit, allFunctions(baselineScript).init.replace('  buildCtxPills();\n', ''));
  assert.match(script, /\nauthBoot\(\);\n/);
  assert.doesNotMatch(script, /\ninit\(\);\n/);
});

test('whole inline script compiles (node --check equivalent)', () => {
  const vm = require('vm');
  assert.doesNotThrow(() => new vm.Script(script, { filename: 'index.html#inline' }));
});
