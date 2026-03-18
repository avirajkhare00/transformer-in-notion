const DEFAULT_TOP_K = 2;
const MAX_CONFIGS = 128;
const SCORE_SCALE = 100;

const PENALTY_HIGH = 120;
const PENALTY_MEDIUM = 36;
const PENALTY_LOW = 12;
const NON_NULL_AMOUNT_FIELDS = new Set([
  "amounts.taxable_amount_cents",
  "amounts.subtotal_cents",
  "amounts.grand_total_cents",
]);
const GRAND_TOTAL_CUE_PATTERN =
  /\b(?:grand\s*total|final amount|net amount|net payable|amount due|amount payable|balance due|total(?:\s+amount)?)\b/i;
const TAX_CUE_PATTERN = /\b(?:igst|cgst|sgst|cess)\b/i;
const TABLE_CUE_PATTERN = /\b(?:qty|quantity|rate|price|hsn|sac|amount|gross|units?)\b/i;
const COVERAGE_FIELDS = Object.freeze([
  "seller.name",
  "seller.gstin",
  "buyer.name",
  "buyer.gstin",
  "amounts.grand_total_cents",
  "taxes.igst_cents",
  "taxes.cgst_cents",
  "taxes.sgst_cents",
  "taxes.cess_cents",
]);

const RESOLVER_FIELD_ORDER = Object.freeze([
  "seller.gstin",
  "buyer.gstin",
  "seller.name",
  "buyer.name",
  "document.place_of_supply",
  "amounts.taxable_amount_cents",
  "amounts.subtotal_cents",
  "amounts.discount_cents",
  "amounts.round_off_cents",
  "taxes.igst_cents",
  "taxes.cgst_cents",
  "taxes.sgst_cents",
  "taxes.cess_cents",
  "amounts.grand_total_cents",
]);

const GSTIN_BASE36_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const GSTIN_VALUE_PATTERN = /^\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;
const MONEY_TOLERANCE_CENTS = 200;

const STATE_CODE_BY_NAME = Object.freeze({
  "ANDAMAN AND NICOBAR ISLANDS": "35",
  "ANDHRA PRADESH": "37",
  "ARUNACHAL PRADESH": "12",
  ASSAM: "18",
  BIHAR: "10",
  CHANDIGARH: "04",
  CHHATTISGARH: "22",
  DELHI: "07",
  GOA: "30",
  GUJARAT: "24",
  HARYANA: "06",
  "HIMACHAL PRADESH": "02",
  "JAMMU AND KASHMIR": "01",
  JHARKHAND: "20",
  KARNATAKA: "29",
  KERALA: "32",
  LADAKH: "38",
  LAKSHADWEEP: "31",
  "MADHYA PRADESH": "23",
  MAHARASHTRA: "27",
  MANIPUR: "14",
  MEGHALAYA: "17",
  MIZORAM: "15",
  NAGALAND: "13",
  ODISHA: "21",
  ORISSA: "21",
  PUDUCHERRY: "34",
  PONDICHERRY: "34",
  PUNJAB: "03",
  RAJASTHAN: "08",
  SIKKIM: "11",
  TAMILNADU: "33",
  "TAMIL NADU": "33",
  TELANGANA: "36",
  TRIPURA: "16",
  "UTTAR PRADESH": "09",
  UTTARAKHAND: "05",
  "WEST BENGAL": "19",
});

function collapseWhitespace(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function flattenSchemaFields(schema) {
  return Object.values(schema.fields ?? {}).flat();
}

function normalizeTallyFieldValue(fieldId, value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (fieldId.endsWith("_cents") || fieldId.endsWith("_percent") || fieldId.endsWith(".quantity")) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.round(numeric) : null;
  }

  return collapseWhitespace(String(value)).toUpperCase();
}

function tallyFieldValueMatches(fieldId, left, right) {
  return normalizeTallyFieldValue(fieldId, left) === normalizeTallyFieldValue(fieldId, right);
}

function buildFieldDefinitionMap(schema) {
  return new Map(flattenSchemaFields(schema).map((field) => [field.id, field]));
}

function normalizeStateNameKey(value) {
  return collapseWhitespace(String(value ?? ""))
    .toUpperCase()
    .replace(/[.&]/g, " ")
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\bSTATE\b/g, "")
    .replace(/\bUT\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveStateCodeFromPlace(value) {
  const key = normalizeStateNameKey(value);
  if (!key) {
    return null;
  }
  return STATE_CODE_BY_NAME[key] ?? null;
}

function resolveStateCodeFromGstin(value) {
  if (typeof value !== "string" || value.length < 2) {
    return null;
  }

  const code = value.slice(0, 2);
  return /^\d{2}$/.test(code) ? code : null;
}

function validateGstinChecksum(value) {
  const gstin = collapseWhitespace(value).toUpperCase();
  if (!GSTIN_VALUE_PATTERN.test(gstin)) {
    return false;
  }

  let factor = 2;
  let sum = 0;
  for (let index = gstin.length - 2; index >= 0; index -= 1) {
    const codePoint = GSTIN_BASE36_ALPHABET.indexOf(gstin[index]);
    if (codePoint === -1) {
      return false;
    }

    const addend = factor * codePoint;
    factor = factor === 2 ? 1 : 2;
    sum += Math.floor(addend / 36) + (addend % 36);
  }

  const remainder = sum % 36;
  const checkCodePoint = remainder === 0 ? 0 : 36 - remainder;
  return gstin[gstin.length - 1] === GSTIN_BASE36_ALPHABET[checkCodePoint];
}

function getCandidateScore(candidate) {
  if (!candidate) {
    return Number.NEGATIVE_INFINITY;
  }

  let score = 0;
  if (typeof candidate.rankingScore === "number") {
    score = candidate.rankingScore * SCORE_SCALE;
  } else if (typeof candidate.selectedScore === "number") {
    score = candidate.selectedScore * SCORE_SCALE + Math.min((candidate.score ?? 0) / 24, 6);
  } else {
    score = typeof candidate.score === "number" ? candidate.score : 0;
  }

  const lineText = collapseWhitespace(candidate.lineText ?? "");
  if (candidate.fieldId === "amounts.grand_total_cents" && lineText) {
    if (TAX_CUE_PATTERN.test(lineText) && !GRAND_TOTAL_CUE_PATTERN.test(lineText)) {
      score -= PENALTY_MEDIUM;
    } else if (TABLE_CUE_PATTERN.test(lineText) && !GRAND_TOTAL_CUE_PATTERN.test(lineText)) {
      score -= PENALTY_LOW;
    }
  }

  return score;
}

function createNullCandidate(fieldId, field) {
  const requirement = field?.requirement ?? "optional";
  const baseScore = requirement === "required" ? -PENALTY_MEDIUM : requirement === "conditional" ? 0 : 4;

  return {
    fieldId,
    value: null,
    normalizedValue: null,
    displayValue: "(empty)",
    score: baseScore,
    rankingScore: null,
    selectedScore: null,
    notSelectedScore: null,
    source: "resolver_null",
    lineIndex: null,
    lineText: null,
    reason: `resolver null choice for ${requirement} field`,
  };
}

function dedupeCandidates(fieldId, candidates, topK) {
  const deduped = [];
  const seen = new Set();

  for (const candidate of candidates ?? []) {
    const normalized = normalizeTallyFieldValue(fieldId, candidate.value);
    const key = normalized === null ? "__NULL__" : String(normalized);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(candidate);
    if (deduped.length >= topK) {
      break;
    }
  }

  return deduped;
}

function shouldAddNullCandidate(fieldId, field, candidates) {
  if ((candidates?.length ?? 0) > 0 && NON_NULL_AMOUNT_FIELDS.has(fieldId)) {
    return false;
  }

  return field?.requirement !== "required";
}

function buildIndependentSelectedFields(state, rankedFieldCandidates) {
  const selectedFields = {
    "document.voucher_family": state.voucherFamily,
  };

  for (const field of flattenSchemaFields(state.schema)) {
    if (field.repeatable || field.id === "document.voucher_family") {
      continue;
    }

    selectedFields[field.id] = rankedFieldCandidates[field.id]?.[0]?.value ?? null;
  }

  return selectedFields;
}

function matchSelectedCandidate(fieldId, selectedValue, rankedCandidates, field) {
  const candidates = rankedCandidates[fieldId] ?? [];
  const matchedCandidate = candidates.find((candidate) =>
    tallyFieldValueMatches(fieldId, candidate.value, selectedValue),
  );

  if (matchedCandidate) {
    return matchedCandidate;
  }

  if (selectedValue === null || selectedValue === undefined) {
    return createNullCandidate(fieldId, field);
  }

  return null;
}

function buildResolverFieldOptions(state, rankedFieldCandidates, topK) {
  const fieldDefinitions = buildFieldDefinitionMap(state.schema);
  const fieldIds = RESOLVER_FIELD_ORDER.filter((fieldId) => fieldDefinitions.has(fieldId));
  const optionsByField = {};

  for (const fieldId of fieldIds) {
    const field = fieldDefinitions.get(fieldId);
    const candidates = dedupeCandidates(fieldId, rankedFieldCandidates[fieldId], topK);
    const options = [...candidates];

    if (options.length === 0 || shouldAddNullCandidate(fieldId, field, options)) {
      options.push(createNullCandidate(fieldId, field));
    }

    optionsByField[fieldId] = options;
  }

  return {
    fieldDefinitions,
    fieldIds,
    optionsByField,
  };
}

function sumMoney(values) {
  return values.reduce((sum, value) => sum + (typeof value === "number" ? value : 0), 0);
}

function absoluteMoneyDelta(left, right) {
  if (typeof left !== "number" || typeof right !== "number") {
    return null;
  }
  return Math.abs(left - right);
}

function createPenaltyCollector() {
  const violations = [];
  return {
    add(code, severity, amount, message, details = {}) {
      violations.push({
        code,
        severity,
        amount,
        message,
        details,
      });
    },
    finish() {
      const totalPenalty = violations.reduce((sum, violation) => sum + violation.amount, 0);
      const highViolationCount = violations.filter((violation) => violation.severity === "high").length;
      return {
        totalPenalty,
        highViolationCount,
        violations,
      };
    },
  };
}

function addMoneyDeltaPenalty(collector, code, observed, expectedValues, message) {
  if (typeof observed !== "number") {
    return;
  }

  const deltas = expectedValues
    .filter((value) => typeof value === "number")
    .map((value) => absoluteMoneyDelta(observed, value))
    .filter((value) => value != null);

  if (deltas.length === 0) {
    return;
  }

  const minimumDelta = Math.min(...deltas);
  if (minimumDelta <= MONEY_TOLERANCE_CENTS) {
    return;
  }

  collector.add(
    code,
    "medium",
    PENALTY_MEDIUM + Math.min(60, Math.ceil((minimumDelta - MONEY_TOLERANCE_CENTS) / 100)),
    message,
    {
      observed,
      expectedValues,
      minimumDelta,
    },
  );
}

function hasCandidateValue(state, fieldId, predicate = null) {
  const candidates = state.fieldCandidates?.[fieldId] ?? [];
  return candidates.some((candidate) => {
    if (candidate.value === null || candidate.value === undefined) {
      return false;
    }
    return typeof predicate === "function" ? predicate(candidate.value, candidate) : true;
  });
}

function countCoverage(selection) {
  return COVERAGE_FIELDS.reduce(
    (count, fieldId) => count + (selection[fieldId] !== null && selection[fieldId] !== undefined ? 1 : 0),
    0,
  );
}

function buildIndependentConfig(state, rankedFieldCandidates, baseSelectedFields) {
  const selectedCandidates = {};
  let candidateScore = 0;

  for (const fieldId of RESOLVER_FIELD_ORDER) {
    const candidate = rankedFieldCandidates[fieldId]?.[0] ?? null;
    if (!candidate) {
      continue;
    }
    selectedCandidates[fieldId] = candidate;
    candidateScore += getCandidateScore(candidate);
  }

  const constraintScore = evaluateResolverConstraints(state, baseSelectedFields);
  return {
    fullSelection: baseSelectedFields,
    selectedCandidates,
    candidateScore,
    totalScore: candidateScore - constraintScore.totalPenalty,
    constraintScore,
  };
}

function shouldPreferTop1Config(bestConfig, top1Config) {
  const bestCoverage = countCoverage(bestConfig.fullSelection);
  const top1Coverage = countCoverage(top1Config.fullSelection);

  if (top1Config.totalScore >= bestConfig.totalScore) {
    return true;
  }

  if (
    top1Coverage > bestCoverage &&
    top1Config.totalScore >= bestConfig.totalScore - PENALTY_MEDIUM
  ) {
    return true;
  }

  if (
    bestConfig.constraintScore.highViolationCount > top1Config.constraintScore.highViolationCount &&
    top1Config.totalScore >= bestConfig.totalScore - PENALTY_MEDIUM
  ) {
    return true;
  }

  return false;
}

function evaluateResolverConstraints(state, selection) {
  const collector = createPenaltyCollector();

  const sellerGstin = selection["seller.gstin"] ?? null;
  const buyerGstin = selection["buyer.gstin"] ?? null;
  const sellerName = selection["seller.name"] ?? null;
  const buyerName = selection["buyer.name"] ?? null;
  const placeOfSupply = selection["document.place_of_supply"] ?? null;

  const taxableAmount = selection["amounts.taxable_amount_cents"] ?? null;
  const subtotalAmount = selection["amounts.subtotal_cents"] ?? null;
  const discountAmount = selection["amounts.discount_cents"] ?? 0;
  const roundOffAmount = selection["amounts.round_off_cents"] ?? 0;
  const grandTotalAmount = selection["amounts.grand_total_cents"] ?? null;
  const igstAmount = selection["taxes.igst_cents"] ?? null;
  const cgstAmount = selection["taxes.cgst_cents"] ?? null;
  const sgstAmount = selection["taxes.sgst_cents"] ?? null;
  const cessAmount = selection["taxes.cess_cents"] ?? null;
  const lineItemAmountSum = sumMoney((state.lineItems ?? []).map((item) => item.amountCents ?? null));

  if (sellerGstin && !validateGstinChecksum(sellerGstin)) {
    collector.add("seller_gstin_invalid", "medium", PENALTY_MEDIUM, "Seller GSTIN failed checksum validation.", {
      value: sellerGstin,
    });
  }

  if (buyerGstin && !validateGstinChecksum(buyerGstin)) {
    collector.add("buyer_gstin_invalid", "medium", PENALTY_MEDIUM, "Buyer GSTIN failed checksum validation.", {
      value: buyerGstin,
    });
  }

  if (sellerGstin && buyerGstin && sellerGstin === buyerGstin) {
    collector.add(
      "seller_buyer_same_gstin",
      "high",
      PENALTY_HIGH,
      "Seller and buyer GSTIN should not resolve to the same value.",
      {
        value: sellerGstin,
      },
    );
  }

  if (
    sellerName &&
    buyerName &&
    collapseWhitespace(sellerName).toUpperCase() === collapseWhitespace(buyerName).toUpperCase() &&
    sellerGstin !== buyerGstin
  ) {
    collector.add(
      "seller_buyer_same_name",
      "low",
      PENALTY_LOW,
      "Seller and buyer names resolved to the same value.",
      {
        value: sellerName,
      },
    );
  }

  const hasIgst = typeof igstAmount === "number" && igstAmount > 0;
  const hasCgst = typeof cgstAmount === "number" && cgstAmount > 0;
  const hasSgst = typeof sgstAmount === "number" && sgstAmount > 0;
  const hasSplitTax = hasCgst || hasSgst;
  const hasSelectedTaxAmount = hasIgst || hasCgst || hasSgst || (typeof cessAmount === "number" && cessAmount > 0);
  const hasTaxCandidateEvidence = [
    "taxes.igst_cents",
    "taxes.cgst_cents",
    "taxes.sgst_cents",
    "taxes.cess_cents",
  ].some((fieldId) => (state.fieldCandidates?.[fieldId]?.length ?? 0) > 0);
  const hasTaxEvidence = hasSelectedTaxAmount || hasTaxCandidateEvidence;
  const hasDiscountEvidence = typeof discountAmount === "number" && Math.abs(discountAmount) > MONEY_TOLERANCE_CENTS;
  const hasRoundOffEvidence = typeof roundOffAmount === "number" && Math.abs(roundOffAmount) > MONEY_TOLERANCE_CENTS;

  if (!sellerName && hasCandidateValue(state, "seller.name")) {
    collector.add(
      "seller_name_dropped",
      "medium",
      PENALTY_MEDIUM,
      "Resolver dropped seller name even though a candidate existed.",
    );
  }

  if (!sellerGstin && hasCandidateValue(state, "seller.gstin")) {
    collector.add(
      "seller_gstin_dropped",
      "medium",
      PENALTY_MEDIUM + PENALTY_LOW,
      "Resolver dropped seller GSTIN even though a candidate existed.",
    );
  }

  if (!buyerName && !buyerGstin && (hasCandidateValue(state, "buyer.name") || hasCandidateValue(state, "buyer.gstin"))) {
    collector.add(
      "buyer_identity_dropped",
      "medium",
      PENALTY_MEDIUM + PENALTY_LOW,
      "Resolver dropped buyer identity even though buyer candidates existed.",
    );
  }

  if (!buyerGstin && hasCandidateValue(state, "buyer.gstin")) {
    collector.add(
      "buyer_gstin_dropped",
      "medium",
      PENALTY_MEDIUM,
      "Resolver dropped buyer GSTIN even though a candidate existed.",
    );
  }

  if (!hasSelectedTaxAmount && ["taxes.igst_cents", "taxes.cgst_cents", "taxes.sgst_cents", "taxes.cess_cents"].some((fieldId) =>
    hasCandidateValue(state, fieldId, (value) => typeof value === "number" && value > 0),
  )) {
    collector.add(
      "tax_block_dropped",
      "medium",
      PENALTY_MEDIUM + PENALTY_LOW,
      "Resolver dropped the full tax block even though tax candidates existed.",
    );
  }

  if (hasIgst && hasSplitTax) {
    collector.add(
      "igst_with_cgst_or_sgst",
      "high",
      PENALTY_HIGH,
      "IGST should not coexist with CGST/SGST in one resolved tax block.",
      {
        igstAmount,
        cgstAmount,
        sgstAmount,
      },
    );
  }

  if (hasCgst !== hasSgst) {
    collector.add(
      "split_tax_incomplete",
      "high",
      PENALTY_HIGH,
      "CGST and SGST should appear together for split-tax invoices.",
      {
        cgstAmount,
        sgstAmount,
      },
    );
  }

  const sellerStateCode = resolveStateCodeFromGstin(sellerGstin);
  const buyerStateCode = resolveStateCodeFromGstin(buyerGstin);
  const placeStateCode = resolveStateCodeFromPlace(placeOfSupply);

  const interStateSignals = [];
  if (sellerStateCode && buyerStateCode) {
    interStateSignals.push(sellerStateCode !== buyerStateCode);
  }
  if (sellerStateCode && placeStateCode) {
    interStateSignals.push(sellerStateCode !== placeStateCode);
  }

  if (interStateSignals.includes(true)) {
    if (hasSplitTax) {
      collector.add(
        "interstate_prefers_igst",
        "medium",
        PENALTY_MEDIUM + PENALTY_LOW,
        "Inter-state invoices should prefer IGST over CGST/SGST.",
        {
          sellerStateCode,
          buyerStateCode,
          placeStateCode,
        },
      );
    }
    if (
      hasSplitTax &&
      hasCandidateValue(state, "taxes.igst_cents", (value) => typeof value === "number" && value > 0)
    ) {
      collector.add(
        "interstate_ignored_igst_candidate",
        "medium",
        PENALTY_MEDIUM + PENALTY_LOW,
        "Resolver ignored an available IGST candidate for an inter-state invoice.",
        {
          sellerStateCode,
          buyerStateCode,
          placeStateCode,
        },
      );
    }
    if (!hasIgst && hasSplitTax) {
      collector.add(
        "interstate_missing_igst",
        "low",
        PENALTY_LOW,
        "Inter-state invoices should normally surface an IGST amount.",
        {
          sellerStateCode,
          buyerStateCode,
          placeStateCode,
        },
      );
    }
  } else if (interStateSignals.length > 0 && interStateSignals.every((signal) => signal === false)) {
    if (hasIgst && !hasSplitTax) {
      collector.add(
        "intrastate_prefers_split_tax",
        "medium",
        PENALTY_MEDIUM,
        "Intra-state invoices should prefer CGST and SGST over IGST.",
        {
          sellerStateCode,
          buyerStateCode,
          placeStateCode,
        },
      );
    }
    if (
      hasIgst &&
      !hasSplitTax &&
      [
        "taxes.cgst_cents",
        "taxes.sgst_cents",
      ].every((fieldId) => hasCandidateValue(state, fieldId, (value) => typeof value === "number" && value > 0))
    ) {
      collector.add(
        "intrastate_ignored_split_tax_candidates",
        "medium",
        PENALTY_MEDIUM,
        "Resolver ignored available CGST/SGST candidates for an intra-state invoice.",
        {
          sellerStateCode,
          buyerStateCode,
          placeStateCode,
        },
      );
    }
  }

  const totalTaxAmount = sumMoney([igstAmount, cgstAmount, sgstAmount, cessAmount]);
  if (typeof subtotalAmount === "number" && typeof taxableAmount === "number" && (hasTaxEvidence || hasDiscountEvidence)) {
    addMoneyDeltaPenalty(
      collector,
      "subtotal_consistency",
      subtotalAmount,
      [
        taxableAmount - discountAmount,
        taxableAmount - discountAmount + totalTaxAmount,
      ],
      "Subtotal is inconsistent with taxable amount, discount, and tax amounts.",
    );
  }

  if (
    typeof grandTotalAmount === "number" &&
    (typeof subtotalAmount === "number" || hasTaxEvidence || hasDiscountEvidence || hasRoundOffEvidence)
  ) {
    addMoneyDeltaPenalty(
      collector,
      "grand_total_consistency",
      grandTotalAmount,
      [
        subtotalAmount != null ? subtotalAmount + roundOffAmount : null,
        taxableAmount != null ? taxableAmount - discountAmount + totalTaxAmount + roundOffAmount : null,
        taxableAmount != null && subtotalAmount != null
          ? Math.max(subtotalAmount, taxableAmount - discountAmount + totalTaxAmount) + roundOffAmount
          : null,
      ],
      "Grand total is inconsistent with the resolved subtotal/tax block.",
    );
  }

  if (lineItemAmountSum > 0) {
    if (typeof taxableAmount === "number" && taxableAmount + MONEY_TOLERANCE_CENTS < lineItemAmountSum) {
      collector.add(
        "taxable_below_line_items",
        "high",
        PENALTY_HIGH,
        "Taxable amount fell below the parsed line-item total.",
        {
          taxableAmount,
          lineItemAmountSum,
        },
      );
    }

    if (typeof grandTotalAmount === "number" && grandTotalAmount + MONEY_TOLERANCE_CENTS < lineItemAmountSum) {
      collector.add(
        "grand_total_below_line_items",
        "high",
        PENALTY_HIGH,
        "Grand total fell below the parsed line-item total.",
        {
          grandTotalAmount,
          lineItemAmountSum,
        },
      );
    }
  }

  return collector.finish();
}

function buildConfigPreview(fieldIds, selection) {
  return Object.fromEntries(fieldIds.map((fieldId) => [fieldId, selection[fieldId] ?? null]));
}

function buildBeamConfigurations(state, rankedFieldCandidates, options = {}) {
  const topK = Number.isInteger(options.topK) && options.topK > 0 ? options.topK : DEFAULT_TOP_K;
  const maxConfigs =
    Number.isInteger(options.maxConfigs) && options.maxConfigs > 0 ? options.maxConfigs : MAX_CONFIGS;
  const { fieldDefinitions, fieldIds, optionsByField } = buildResolverFieldOptions(state, rankedFieldCandidates, topK);
  const baseSelectedFields = buildIndependentSelectedFields(state, rankedFieldCandidates);

  let beam = [
    {
      selection: {},
      selectedCandidates: {},
      candidateScore: 0,
      totalScore: 0,
    },
  ];
  let truncated = false;

  for (const fieldId of fieldIds) {
    const nextBeam = [];
    for (const entry of beam) {
      for (const candidate of optionsByField[fieldId] ?? []) {
        const selection = {
          ...entry.selection,
          [fieldId]: candidate.value,
        };
        const combinedSelection = {
          ...baseSelectedFields,
          ...selection,
        };
        const constraintScore = evaluateResolverConstraints(state, combinedSelection);
        const candidateScore = entry.candidateScore + getCandidateScore(candidate);

        nextBeam.push({
          selection,
          selectedCandidates: {
            ...entry.selectedCandidates,
            [fieldId]: candidate,
          },
          candidateScore,
          totalScore: candidateScore - constraintScore.totalPenalty,
          constraintScore,
        });
      }
    }

    nextBeam.sort((left, right) => right.totalScore - left.totalScore);
    if (nextBeam.length > maxConfigs) {
      truncated = true;
    }
    beam = nextBeam.slice(0, maxConfigs);
  }

  const fullConfigs = beam
    .map((entry) => {
      const fullSelection = {
        ...baseSelectedFields,
        ...entry.selection,
      };
      const fullConstraintScore = evaluateResolverConstraints(state, fullSelection);
      return {
        ...entry,
        fieldIds,
        fieldDefinitions,
        fullSelection,
        totalScore: entry.candidateScore - fullConstraintScore.totalPenalty,
        constraintScore: fullConstraintScore,
      };
    })
    .sort((left, right) => right.totalScore - left.totalScore);

  return {
    baseSelectedFields,
    fieldDefinitions,
    fieldIds,
    fullConfigs,
    top1Config: buildIndependentConfig(state, rankedFieldCandidates, baseSelectedFields),
    truncated,
    topK,
    maxConfigs,
  };
}

export function resolveTallyFieldSelection(state, rankedFieldCandidates, options = {}) {
  const hasStateFieldCandidates =
    Boolean(state.fieldCandidates) && Object.keys(state.fieldCandidates).length > 0;
  const resolverState =
    state.fieldCandidates === rankedFieldCandidates || hasStateFieldCandidates
      ? state
      : {
          ...state,
          fieldCandidates: rankedFieldCandidates,
        };
  const {
    baseSelectedFields,
    fieldDefinitions,
    fieldIds,
    fullConfigs,
    top1Config,
    truncated,
    topK,
    maxConfigs,
  } = buildBeamConfigurations(resolverState, rankedFieldCandidates, options);

  let bestConfig = fullConfigs[0] ?? {
    fullSelection: baseSelectedFields,
    selectedCandidates: {},
    totalScore: 0,
    constraintScore: {
      totalPenalty: 0,
      highViolationCount: 0,
      violations: [],
    },
  };
  let selectionMode = "resolver";
  if (shouldPreferTop1Config(bestConfig, top1Config)) {
    bestConfig = top1Config;
    selectionMode = "top1_fallback";
  }
  const secondConfig = fullConfigs[1] ?? null;
  const selectedFields = {
    ...baseSelectedFields,
    ...bestConfig.fullSelection,
  };

  const selectedCandidateList = [];
  for (const field of flattenSchemaFields(state.schema)) {
    if (field.repeatable || field.id === "document.voucher_family") {
      continue;
    }

    const matchedCandidate =
      bestConfig.selectedCandidates[field.id] ??
      matchSelectedCandidate(field.id, selectedFields[field.id], rankedFieldCandidates, field);
    if (!matchedCandidate || matchedCandidate.value === null || matchedCandidate.value === undefined) {
      continue;
    }

    selectedCandidateList.push({
      fieldId: field.id,
      candidate: matchedCandidate,
    });
  }

  const allConfigsInvalid =
    fullConfigs.length > 0 && fullConfigs.every((config) => config.constraintScore.highViolationCount > 0);
  const scoreMargin = secondConfig ? bestConfig.totalScore - secondConfig.totalScore : null;

  return {
    selectedFields,
    selectedCandidateList,
    resolverDebug: {
      topK,
      maxConfigs,
      configCount: fullConfigs.length,
      truncated,
      chosenConfigScore: bestConfig.totalScore,
      candidateScore: bestConfig.candidateScore ?? 0,
      totalPenalty: bestConfig.constraintScore.totalPenalty,
      highViolationCount: bestConfig.constraintScore.highViolationCount,
      violations: bestConfig.constraintScore.violations,
      selectionMode,
      alternatives: fullConfigs.slice(0, 3).map((config, index) => ({
        rank: index + 1,
        score: config.totalScore,
        totalPenalty: config.constraintScore.totalPenalty,
        highViolationCount: config.constraintScore.highViolationCount,
        fields: buildConfigPreview(fieldIds, config.fullSelection),
        violations: config.constraintScore.violations,
      })),
      margin: scoreMargin,
      lowConfidence:
        allConfigsInvalid ||
        (typeof scoreMargin === "number" && scoreMargin < PENALTY_LOW) ||
        bestConfig.constraintScore.highViolationCount > 0,
      allConfigsInvalid,
    },
  };
}
