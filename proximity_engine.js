// ============================================================
// Hopprint Style Proximity Engine
// Connects the 153-style attribute matrix to the signal model
// to produce novelty-adjusted, explainable recommendations.
// ============================================================

const FLAVOR_DIMS = ['bitterness', 'sweetness', 'roast', 'body', 'fruit', 'carbonation', 'alcohol', 'haze'];

// Euclidean distance between two styles' attribute vectors
function styleDistance(a, b) {
  return Math.sqrt(
    FLAVOR_DIMS.reduce((sum, dim) => sum + (a[dim] - b[dim]) ** 2, 0)
  );
}

// Precompute nearest neighbors for every style once (cache this at app load,
// not per-recommendation-call — 153x153 pairwise distances is cheap but
// there's no reason to redo it every time Discover opens)
function buildNeighborIndex(styleMatrix, k = 6) {
  const index = {};
  const styleNames = Object.keys(styleMatrix);

  for (const style of styleNames) {
    const target = styleMatrix[style];
    const distances = styleNames
      .filter(s => s !== style)
      .map(s => ({ style: s, distance: styleDistance(target, styleMatrix[s]) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, k);
    index[style] = distances;
  }
  return index;
}

// Given a style and the user's known affinity scores, compute a
// neighbor-weighted "predicted affinity" — how much the user would
// likely enjoy this style based on proximity to styles they already like.
//
// If the initial k neighbors don't overlap with anything the user has
// affinity data for (common for users with narrow drinking histories),
// progressively widen the search rather than giving up at k=6. This is
// a real limitation worth knowing about: a user who's only ever logged
// 5-10 styles will have genuine blind spots the function can't fill in
// no matter how it's tuned — that's a data problem, not a code problem.
function transferredAffinity(styleName, userAffinityMap, neighborIndex, styleMatrix) {
  let neighbors = neighborIndex[styleName] || [];
  let knownNeighbors = neighbors.filter(n => userAffinityMap[n.style] !== undefined);

  if (knownNeighbors.length === 0 && styleMatrix) {
    // Widen search up to k=20 before giving up
    const allDistances = Object.keys(styleMatrix)
      .filter(s => s !== styleName)
      .map(s => ({ style: s, distance: styleDistance(styleMatrix[styleName], styleMatrix[s]) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 20);
    knownNeighbors = allDistances.filter(n => userAffinityMap[n.style] !== undefined);
  }

  if (knownNeighbors.length === 0) {
    return { score: 0, contributors: [], insufficientData: true };
  }


  const EPSILON = 0.5; // prevents divide-by-zero for near-identical styles
  let weightedSum = 0;
  let weightTotal = 0;
  const contributors = [];

  for (const n of knownNeighbors) {
    const weight = 1 / (n.distance + EPSILON);
    weightedSum += userAffinityMap[n.style] * weight;
    weightTotal += weight;
    contributors.push({
      style: n.style,
      distance: n.distance,
      affinity: userAffinityMap[n.style],
      weight,
    });
  }

  contributors.sort((a, b) => b.weight - a.weight);
  return { score: weightTotal > 0 ? weightedSum / weightTotal : 0, contributors };
}

// Combines transferred affinity with the user's real signal data (if any)
// and novelty, weighted per recommendation mode.
const MODE_WEIGHTS = {
  // Occasion (DISCOVER_REDESIGN_HANDOFF.md §5): the retired Wheelhouse
  // weighting — a "what should I order now" pick, where the occasion filter,
  // not novelty, keeps it from repeating the usual favorites.
  occasion: { affinity: 0.75, novelty: 0.25 },
};

// DIRECT_SIGNAL_THRESHOLD: familiarity above which we trust the user's own
// affinity score over neighbor-transferred prediction. Below this, the
// direct signal is too thin to stand alone, so it gets blended with
// neighbor data instead of discarded.
const DIRECT_SIGNAL_THRESHOLD = 1.5;

function scoreRecommendation(styleName, signalData, userAffinityMap, neighborIndex, mode, styleMatrix) {
  const known = signalData[styleName]; // may be undefined for never-tried styles
  const transfer = transferredAffinity(styleName, userAffinityMap, neighborIndex, styleMatrix);

  let predictedAffinity;
  let source; // 'direct' | 'blended' | 'transferred'

  if (known && known.familiarity >= DIRECT_SIGNAL_THRESHOLD) {
    predictedAffinity = known.affinity;
    source = 'direct';
  } else if (known) {
    predictedAffinity = transfer.contributors.length > 0
      ? (transfer.score + known.affinity) / 2
      : known.affinity;
    source = 'blended';
  } else {
    predictedAffinity = transfer.score;
    source = 'transferred';
  }

  const novelty = known ? known.novelty : 1.0; // fully novel if never tried
  const weights = MODE_WEIGHTS[mode];

  return {
    style: styleName,
    score: predictedAffinity * weights.affinity + novelty * weights.novelty,
    predictedAffinity,
    novelty,
    source,
    contributors: transfer.contributors,
  };
}

// Affinity midpoint used to judge whether a contributor represents a style
// the user actually enjoys, vs. one they merely drink. Calibrate against
// whatever scale the signal model's affinity scores land in.
const POSITIVE_AFFINITY_THRESHOLD = 2.5;

// Exported for use in the Discover tab
if (typeof module !== 'undefined') {
  module.exports = { buildNeighborIndex, transferredAffinity, scoreRecommendation, styleDistance };
}
