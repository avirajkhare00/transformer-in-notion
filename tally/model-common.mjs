export const TALLY_FIELD_SELECTOR_MODEL_ID = "tally-field-selector";
export const TALLY_FIELD_SELECTOR_LABELS = Object.freeze(["NOT_SELECTED", "SELECTED"]);

import { canonicalizeDateText, canonicalizeStateName } from "./normalization.mjs";
import { resolveTallyFieldSelection } from "./resolver.mjs";

function collapseWhitespace(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function sortRankedCandidates(candidates) {
  return [...candidates].sort((left, right) => {
    if ((right.rankingScore ?? 0) !== (left.rankingScore ?? 0)) {
      return (right.rankingScore ?? 0) - (left.rankingScore ?? 0);
    }
    if ((right.selectedScore ?? 0) !== (left.selectedScore ?? 0)) {
      return (right.selectedScore ?? 0) - (left.selectedScore ?? 0);
    }
    if ((right.score ?? 0) !== (left.score ?? 0)) {
      return (right.score ?? 0) - (left.score ?? 0);
    }
    if ((left.lineIndex ?? Number.MAX_SAFE_INTEGER) !== (right.lineIndex ?? Number.MAX_SAFE_INTEGER)) {
      return (left.lineIndex ?? Number.MAX_SAFE_INTEGER) - (right.lineIndex ?? Number.MAX_SAFE_INTEGER);
    }
    return String(left.displayValue ?? left.value ?? "").localeCompare(
      String(right.displayValue ?? right.value ?? ""),
    );
  });
}

export function flattenTallySchemaFields(schema) {
  return Object.values(schema.fields).flat();
}

export function normalizeTallyFieldValue(fieldId, value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (fieldId === "document.place_of_supply") {
    return (canonicalizeStateName(value) ?? collapseWhitespace(String(value))).toUpperCase();
  }

  if (fieldId === "document.date") {
    return (canonicalizeDateText(value) ?? collapseWhitespace(String(value))).toUpperCase();
  }

  if (fieldId.endsWith("_cents") || fieldId.endsWith("_percent") || fieldId.endsWith(".quantity")) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.round(numeric) : null;
  }

  return collapseWhitespace(String(value)).toUpperCase();
}

export function tallyFieldValueMatches(fieldId, left, right) {
  return normalizeTallyFieldValue(fieldId, left) === normalizeTallyFieldValue(fieldId, right);
}

export function buildTallyFieldCandidateContext(field, candidate, state) {
  const parts = [
    `field=${field.id}`,
    `label=${field.label}`,
    `group=${field.group}`,
    `voucher=${state.voucherFamily}`,
    `industry=${state.industry}`,
    `source=${candidate.source ?? "runtime"}`,
    `base_score=${candidate.score ?? 0}`,
    `line_index=${candidate.lineIndex ?? -1}`,
    `value=${collapseWhitespace(candidate.displayValue ?? candidate.value ?? "")}`,
  ];

  if (candidate.reason) {
    parts.push(`reason=${collapseWhitespace(candidate.reason)}`);
  }
  if (candidate.lineText) {
    parts.push(`line=${collapseWhitespace(candidate.lineText)}`);
  }
  if (
    candidate.normalizedValue !== null &&
    candidate.normalizedValue !== undefined &&
    String(candidate.normalizedValue) !== String(candidate.displayValue ?? candidate.value ?? "")
  ) {
    parts.push(`normalized=${collapseWhitespace(candidate.normalizedValue)}`);
  }

  return parts.join(" | ");
}

export function buildTallyFieldModelExamples(state) {
  const examples = [];

  for (const field of flattenTallySchemaFields(state.schema)) {
    if (field.repeatable || field.id === "document.voucher_family") {
      continue;
    }

    const candidates = state.fieldCandidates[field.id] ?? [];
    candidates.forEach((candidate, candidateIndex) => {
      examples.push({
        fieldId: field.id,
        fieldLabel: field.label,
        candidateIndex,
        candidate,
        context: buildTallyFieldCandidateContext(field, candidate, state),
      });
    });
  }

  return examples;
}

export function applyTallyFieldPredictions(state, examples, predictions) {
  if (examples.length !== predictions.length) {
    throw new Error(
      `Prediction count ${predictions.length} did not match example count ${examples.length}.`,
    );
  }

  const rankedFieldCandidates = {};
  for (const [fieldId, candidates] of Object.entries(state.fieldCandidates)) {
    rankedFieldCandidates[fieldId] = candidates.map((candidate) => ({
      ...candidate,
      selectedScore: null,
      notSelectedScore: null,
      scores: [],
    }));
  }

  examples.forEach((example, index) => {
    const scores = predictions[index];
    const rankedCandidates = rankedFieldCandidates[example.fieldId];
    if (!rankedCandidates) {
      return;
    }

    const targetCandidate = rankedCandidates[example.candidateIndex];
    if (!targetCandidate) {
      return;
    }

    targetCandidate.selectedScore = scores.selectedScore;
    targetCandidate.notSelectedScore = scores.notSelectedScore;
    targetCandidate.rankingScore =
      (scores.selectedScore ?? 0) + Math.min((targetCandidate.score ?? 0) / 2400, 0.06);
    targetCandidate.scores = scores.scores ?? [];
  });

  for (const [fieldId, candidates] of Object.entries(rankedFieldCandidates)) {
    rankedFieldCandidates[fieldId] = sortRankedCandidates(candidates);
  }

  const resolution = resolveTallyFieldSelection(state, rankedFieldCandidates, {
    topK: 2,
  });
  const selectedFields = resolution.selectedFields;
  const selectedCandidateList = resolution.selectedCandidateList;

  const selectedScores = selectedCandidateList
    .map((entry) => entry.candidate.selectedScore)
    .filter((score) => typeof score === "number");

  return {
    selectedFields,
    rankedFieldCandidates,
    selectedCandidateList,
    resolverDebug: resolution.resolverDebug,
    modelStats: {
      predictionCount: predictions.length,
      averageSelectedScore:
        selectedScores.length > 0
          ? selectedScores.reduce((sum, score) => sum + score, 0) / selectedScores.length
          : null,
      lowestSelectedScore: selectedScores.length > 0 ? Math.min(...selectedScores) : null,
      lowConfidenceFields: selectedCandidateList
        .filter((entry) => (entry.candidate.selectedScore ?? 0) < 0.6)
        .map((entry) => entry.fieldId),
      resolverMargin: resolution.resolverDebug.margin,
      resolverViolationCount: resolution.resolverDebug.violations.length,
      resolverLowConfidence: resolution.resolverDebug.lowConfidence,
    },
  };
}
