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
  wheelhouse: { affinity: 0.75, novelty: 0.25 },
  adjacent:   { affinity: 0.45, novelty: 0.55 },
  wildcard:   { affinity: 0.15, novelty: 0.85 },
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

// Minimum number of known-affinity neighbors required before the function
// will make a confident positive/negative claim. Below this, say so honestly
// rather than generalizing from a single data point.
const MIN_CONTRIBUTORS_FOR_CONFIDENCE = 2;

// Rationale sentence generator — uses actual contributor data, never
// generic filler. This is the trust-building layer.
function generateRationale(result, mode) {
  const { contributors, source, predictedAffinity } = result;

  if (source === 'direct') {
    return null; // handled by the existing wheelhouse/adjacent rationale logic from the signal model
  }

  if (contributors.length === 0) {
    return `New territory — nothing in your history is close enough to predict how you'd feel about this one.`;
  }

  // Only cite neighbors that actually support the claim being made —
  // positive neighbors for a positive rationale, negative for a negative one.
  const positiveNeighbors = contributors.filter(c => c.affinity >= POSITIVE_AFFINITY_THRESHOLD);
  const negativeNeighbors = contributors.filter(c => c.affinity < POSITIVE_AFFINITY_THRESHOLD);

  const nameList = (list) => {
    const names = list.slice(0, 2).map(c => c.style);
    return names.length === 2 ? `${names[0]} and ${names[1]}` : names[0];
  };

  if (predictedAffinity >= POSITIVE_AFFINITY_THRESHOLD && positiveNeighbors.length > 0) {
    if (positiveNeighbors.length < MIN_CONTRIBUTORS_FOR_CONFIDENCE) {
      return `Limited data, but it's close to ${nameList(positiveNeighbors)}, which you've rated well — worth a cautious try.`;
    }
    return mode === 'wildcard'
      ? `You haven't tried this, but it shares real flavor overlap with ${nameList(positiveNeighbors)} — styles you rate well.`
      : `Close in flavor profile to ${nameList(positiveNeighbors)}, which you've enjoyed. Worth a try.`;
  }

  if (predictedAffinity < POSITIVE_AFFINITY_THRESHOLD && negativeNeighbors.length > 0) {
    return `Skip this one — it's closest to ${nameList(negativeNeighbors)}, which hasn't been a favorite of yours.`;
  }

  return `Not enough signal to say either way — this sits between styles you like and styles you don't.`;
}


// Exported for use in the Discover tab
if (typeof module !== 'undefined') {
  module.exports = { buildNeighborIndex, transferredAffinity, scoreRecommendation, generateRationale, styleDistance };
}
