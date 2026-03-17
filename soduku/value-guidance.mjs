export const DEFAULT_VALUE_GUIDANCE_POLICY = Object.freeze({
  greedyConfidenceLift: 0.18,
  greedyMargin: 0.1,
  beamConfidenceLift: 0.06,
  beamMargin: 0.04,
  beamWidth: 2,
});

function clampBeamWidth(candidateCount, requestedWidth) {
  if (candidateCount <= 0) {
    return 1;
  }
  const width = Number.isFinite(requestedWidth) ? Math.trunc(requestedWidth) : 2;
  return Math.max(1, Math.min(candidateCount, width));
}

function normalizePredictionScore(predictions) {
  const total = predictions.reduce((sum, prediction) => sum + prediction.score, 0);
  if (!(total > 0)) {
    const uniformScore = predictions.length > 0 ? 1 / predictions.length : 0;
    return predictions.map((prediction) => ({
      ...prediction,
      rawScore: prediction.score,
      score: uniformScore,
    }));
  }

  return predictions.map((prediction) => ({
    ...prediction,
    rawScore: prediction.score,
    score: prediction.score / total,
  }));
}

function collectLegalPredictions(predictions, legalCandidates) {
  const legal = new Set(legalCandidates);
  const rankedPredictions = [];
  const seen = new Set();

  if (Array.isArray(predictions)) {
    predictions.forEach((prediction) => {
      const value = prediction?.value;
      if (!legal.has(value) || seen.has(value)) {
        return;
      }
      seen.add(value);
      rankedPredictions.push({
        value,
        score: Number.isFinite(prediction?.score) ? Math.max(prediction.score, 0) : 0,
      });
    });
  }

  return normalizePredictionScore(rankedPredictions);
}

export function chooseValueGuidanceDecision({
  predictions,
  candidates,
  policy = DEFAULT_VALUE_GUIDANCE_POLICY,
}) {
  const heuristicOrder = Array.isArray(candidates) ? [...candidates] : [];
  const rankedPredictions = collectLegalPredictions(predictions, heuristicOrder);
  const beamWidth = clampBeamWidth(heuristicOrder.length, policy.beamWidth);

  const topPrediction = rankedPredictions[0] ?? null;
  const secondPrediction = rankedPredictions[1] ?? null;
  const confidence = topPrediction ? topPrediction.score : 0;
  const margin = topPrediction
    ? confidence - (secondPrediction ? secondPrediction.score : 0)
    : 0;
  const confidenceLift =
    heuristicOrder.length > 0 ? confidence - 1 / heuristicOrder.length : 0;
  const orderedCandidates = rankedPredictions.map((prediction) => prediction.value);

  if (
    orderedCandidates.length > 0 &&
    confidenceLift >= policy.greedyConfidenceLift &&
    margin >= policy.greedyMargin
  ) {
    return {
      strategy: "greedy",
      orderedCandidates,
      confidence,
      margin,
      confidenceLift,
      beamWidth: 1,
    };
  }

  // A "beam-2" prefix only makes sense when at least one candidate still stays
  // under deterministic fallback ordering. On 2-way branches it collapses into
  // trusting the full model order, which is just weak greedy.
  const canUseBeam = heuristicOrder.length > beamWidth;

  if (
    canUseBeam &&
    orderedCandidates.length > 0 &&
    confidenceLift >= policy.beamConfidenceLift &&
    margin >= policy.beamMargin
  ) {
    return {
      strategy: "beam-2",
      orderedCandidates,
      confidence,
      margin,
      confidenceLift,
      beamWidth,
    };
  }

  return {
    strategy: "fallback",
    orderedCandidates: heuristicOrder,
    confidence,
    margin,
    confidenceLift,
    beamWidth: clampBeamWidth(heuristicOrder.length, policy.beamWidth),
  };
}
