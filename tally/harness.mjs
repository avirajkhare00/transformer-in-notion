import { TALLY_DEMO_PRESETS } from "./demo-samples.mjs";
import { buildTallyExtractionState } from "./psvm.mjs";
import { tallyFieldValueMatches } from "./model-common.mjs";

export const TALLY_HARNESS_FAILURE_CLASSES = Object.freeze({
  baseline: {
    id: "baseline",
    label: "Baseline",
    description: "Unmutated seed vouchers used as a control group.",
  },
  candidate_missing: {
    id: "candidate_missing",
    label: "Candidate Missing",
    description: "The truth is present in the OCR, but the parser may fail to surface it as a legal candidate.",
  },
  ranking_ambiguity: {
    id: "ranking_ambiguity",
    label: "Ranking Ambiguity",
    description: "Multiple near-duplicate candidates compete for the same field.",
  },
  structural_inconsistency: {
    id: "structural_inconsistency",
    label: "Structural Inconsistency",
    description: "The document contains contradictory party/tax structure that should stress constraints and role assignment.",
  },
  numeric_ambiguity: {
    id: "numeric_ambiguity",
    label: "Numeric Ambiguity",
    description: "The document contains near-equal or repeated numbers that challenge total/amount selection.",
  },
  ocr_corruption: {
    id: "ocr_corruption",
    label: "OCR Corruption",
    description: "Labels and structure are degraded by OCR-style character corruption.",
  },
  layout_drift: {
    id: "layout_drift",
    label: "Layout Drift",
    description: "Blocks and rows are reordered or wrapped in ways that drift from the training templates.",
  },
});

const FIELD_MARGIN_THRESHOLD = 6;
const LINE_ITEM_FIELD_MAP = Object.freeze([
  { fieldId: "line_items[].description", recordKey: "description" },
  { fieldId: "line_items[].hsn_sac", recordKey: "hsnSac" },
  { fieldId: "line_items[].quantity", recordKey: "quantity" },
  { fieldId: "line_items[].unit", recordKey: "unit" },
  { fieldId: "line_items[].unit_price_cents", recordKey: "unitPriceCents" },
  { fieldId: "line_items[].tax_rate_percent", recordKey: "taxRatePercent" },
  { fieldId: "line_items[].amount_cents", recordKey: "amountCents" },
  { fieldId: "line_items[].batch_number", recordKey: "batchNumber" },
  { fieldId: "line_items[].expiry_date", recordKey: "expiryDate" },
  { fieldId: "line_items[].mrp_cents", recordKey: "mrpCents" },
  { fieldId: "line_items[].serial_number", recordKey: "serialNumber" },
  { fieldId: "line_items[].free_quantity", recordKey: "freeQuantity" },
  { fieldId: "line_items[].scheme_discount_cents", recordKey: "schemeDiscountCents" },
]);

const BASE_CASES = Object.freeze([
  {
    id: "tax-invoice-core",
    presetId: "tax-invoice-core",
    label: "Tax Invoice Control",
    voucherFamily: "sales_invoice",
    shouldSupport: true,
    fields: {
      "document.number": "29",
      "document.date": "23-May-25",
      "document.currency": "INR",
      "document.place_of_supply": "Maharashtra",
      "seller.name": "JAYRAJ SOLAR LLP",
      "seller.gstin": "24AAMFJ7876R1Z8",
      "buyer.name": "Nimoto Solar Pvt Ltd",
      "buyer.gstin": "27AADCN3773B1ZM",
      "consignee.name": "Nimoto Solar Pvt Ltd",
      "consignee.gstin": "27AADCN3773B1ZM",
      "taxes.igst_cents": 7200000,
      "amounts.grand_total_cents": 47200000,
    },
    lineItems: [
      {
        description:
          "Supply and Installation Structure, Electrical BOS supply, I&C for 250 KWp Solar Power Project at Sarigam, Gujarat",
        hsnSac: "995442",
        quantity: 250,
        unit: "KW",
        unitPriceCents: 160000,
        taxRatePercent: 18,
        amountCents: 40000000,
      },
    ],
  },
  {
    id: "proforma-core",
    presetId: "proforma-core",
    label: "Proforma Control",
    voucherFamily: "proforma_invoice",
    shouldSupport: true,
    fields: {
      "document.number": "PI-0272/23-24",
      "document.date": "30/10/2023",
      "document.currency": "INR",
      "seller.name": "Zodiac Energy Ltd",
      "seller.gstin": "24AAACZ1284C1ZN",
      "buyer.name": "JAYRAJ SOLAR LLP",
      "buyer.gstin": "24AAMFJ7876R1Z8",
      "amounts.taxable_amount_cents": 14800000,
      "amounts.subtotal_cents": 16576000,
      "amounts.round_off_cents": 0,
      "amounts.grand_total_cents": 16576000,
    },
    lineItems: [
      {
        description: "SOFAR-5KW G-3",
        quantity: 5,
        unit: "nos",
        unitPriceCents: 2960000,
        amountCents: 14800000,
      },
    ],
  },
]);

function getPresetById(id) {
  const preset = TALLY_DEMO_PRESETS.find((entry) => entry.id === id);
  if (!preset) {
    throw new Error(`Unknown Tally harness preset: ${id}`);
  }
  return preset;
}

function splitLines(source) {
  return String(source ?? "").replace(/\r\n?/g, "\n").split("\n");
}

function joinLines(lines) {
  return lines.join("\n");
}

function findLineIndex(lines, pattern, startIndex = 0) {
  for (let index = startIndex; index < lines.length; index += 1) {
    if (pattern.test(lines[index])) {
      return index;
    }
  }
  return -1;
}

function replaceLine(lines, pattern, replacements) {
  const index = findLineIndex(lines, pattern);
  if (index === -1) {
    return false;
  }
  lines.splice(index, 1, ...(Array.isArray(replacements) ? replacements : [replacements]));
  return true;
}

function insertBeforeLine(lines, pattern, insertions) {
  const index = findLineIndex(lines, pattern);
  if (index === -1) {
    return false;
  }
  lines.splice(index, 0, ...(Array.isArray(insertions) ? insertions : [insertions]));
  return true;
}

function insertAfterLine(lines, pattern, insertions) {
  const index = findLineIndex(lines, pattern);
  if (index === -1) {
    return false;
  }
  lines.splice(index + 1, 0, ...(Array.isArray(insertions) ? insertions : [insertions]));
  return true;
}

function applyTextMutation(source, transformer) {
  const lines = splitLines(source);
  transformer(lines);
  return joinLines(lines);
}

function createSeededRandom(seed) {
  let current = seed >>> 0;
  return function next() {
    current += 0x6d2b79f5;
    let value = current;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function maybeCorruptToken(token, rng) {
  return token
    .replace(/O/g, () => (rng() < 0.55 ? "0" : "O"))
    .replace(/I/g, () => (rng() < 0.45 ? "1" : "I"))
    .replace(/S/g, () => (rng() < 0.3 ? "5" : "S"))
    .replace(/A/g, () => (rng() < 0.15 ? "4" : "A"));
}

function mutateOcrNoise(source, seed) {
  const rng = createSeededRandom(seed);
  return source
    .split("\n")
    .map((line) => {
      if (/\b(?:Invoice|GSTIN|TOTAL|Supply|Buyer|Consignee|Date|Place of Supply|PROFORMA)\b/i.test(line)) {
        return line
          .split(/(\s+)/)
          .map((token) => (/^\s+$/.test(token) ? token : maybeCorruptToken(token, rng)))
          .join("");
      }
      return line;
    })
    .join("\n");
}

function mutateLayoutDrift(source, baseCase) {
  return applyTextMutation(source, (lines) => {
    if (baseCase.id === "tax-invoice-core") {
      replaceLine(
        lines,
        /JAYRAJ SOLAR LLP/,
        [
          "JAYRAJ SOLAR LLP",
          "Invoice No. 29",
          "Dated 23-May-25",
          "GSTIN/UIN: 24AAMFJ7876R1Z8",
        ],
      );
      replaceLine(lines, /Consignee \(Ship to\)/, ["Buyer (Bill to)", "Nimoto Solar Pvt Ltd"]);
      replaceLine(lines, /Buyer \(Bill to\)/, ["Consignee (Ship to)", "Nimoto Solar Pvt Ltd"]);
      replaceLine(
        lines,
        /^ 1 Supply and Installation/,
        [
          " 1 Supply and Installation           995442",
          "   18 % 250.000 KW        1,888.00         1,600.00 KW                4,00,000.00",
        ],
      );
      insertBeforeLine(lines, /^IGST/, "Place of Supply : Maharashtra");
      replaceLine(lines, /^Place of Supply : Maharashtra$/, "");
      return;
    }

    replaceLine(
      lines,
      /JAYRAJ SOLAR LLP\s+PI No:/,
      [
        "JAYRAJ SOLAR LLP",
        "PI No: PI-0272/23-24",
        "Date : 30/10/2023",
      ],
    );
    replaceLine(
      lines,
      /^  1\s+SOFAR-5KW G-3/,
      [
        "  1 SOFAR-5KW G-3",
        "    5 nos   29,600.00   148,000.00",
      ],
    );
  });
}

function mutateCandidateMissing(source, baseCase) {
  return applyTextMutation(source, (lines) => {
    if (baseCase.id === "tax-invoice-core") {
      replaceLine(lines, /Description of Goods/, "Item Particulars               Code / Tax               Units / Basic");
      replaceLine(lines, /^No\./, "Gross Value");
      replaceLine(
        lines,
        /^ 1 Supply and Installation/,
        [
          " 1 Supply and Installation",
          "   995442 / 18 %",
          "   250.000 KW @ 1,600.00",
          "   Gross 4,00,000.00",
        ],
      );
      return;
    }

    replaceLine(lines, /PRODUCT DESCRIPTION/, "PRODUCT PARTICULARS");
    replaceLine(lines, /QTY\s+AMOUNT RS\./, "UNITS  BASIC / GROSS");
    replaceLine(
      lines,
      /^  1\s+SOFAR-5KW G-3/,
      [
        "  1 SOFAR-5KW G-3",
        "    units 5",
        "    basic 29,600.00 gross 148,000.00",
      ],
    );
  });
}

function mutateRankingAmbiguity(source, baseCase) {
  return applyTextMutation(source, (lines) => {
    if (baseCase.id === "tax-invoice-core") {
      insertBeforeLine(lines, /^IGST/, [
        "                                    Taxable Value                                                                             ₹ 4,72,000.00",
        "                                    Amount Due                                                                                ₹ 4,72,000.00",
      ]);
      return;
    }

    insertBeforeLine(lines, /^Rs\. One Lacs/, [
      "                                                                                              Balance           165,760.00",
      "                                                                                              Net Total         165,760.00",
    ]);
  });
}

function mutateStructuralInconsistency(source, baseCase) {
  return applyTextMutation(source, (lines) => {
    if (baseCase.id === "tax-invoice-core") {
      replaceLine(
        lines,
        /Buyer \(Bill to\)/,
        [
          "Buyer (Bill to)",
          "JAYRAJ SOLAR LLP",
          "GSTIN/UIN         : 24AAMFJ7876R1Z8",
          "Nimoto Solar Pvt Ltd",
          "GSTIN/UIN         : 27AADCN3773B1ZM",
        ],
      );
      insertBeforeLine(lines, /^Total\s+250\.000 KW/, [
        "                                    CGST                                                                                       36,000.00",
        "                                    SGST                                                                                       36,000.00",
      ]);
      return;
    }

    insertAfterLine(lines, /^GST No\.\s+24AAMFJ7876R1Z8/, [
      "Buyer GST No.   24AAACZ1284C1ZN",
      "Sold By         JAYRAJ SOLAR LLP",
    ]);
  });
}

function mutateNumericAmbiguity(source, baseCase) {
  return applyTextMutation(source, (lines) => {
    if (baseCase.id === "tax-invoice-core") {
      insertBeforeLine(lines, /^Total\s+250\.000 KW/, [
        "                                    Net Payable                                                                              ₹ 4,71,999.50",
        "                                    Round Off                                                                                      0.50",
      ]);
      return;
    }

    insertBeforeLine(lines, /^Rs\. One Lacs/, [
      "                                                                                              Amount Due         165,759.50",
      "                                                                                              Round Off               0.50",
    ]);
  });
}

function buildMutatedCase(baseCase, failureClass, variant, source) {
  return {
    id: `${failureClass}-${variant}-${baseCase.id}`,
    label: `${TALLY_HARNESS_FAILURE_CLASSES[failureClass].label} / ${baseCase.label}`,
    baseCaseId: baseCase.id,
    failureClass,
    variant,
    source,
    voucherFamily: baseCase.voucherFamily,
    shouldSupport: baseCase.shouldSupport,
    fields: { ...baseCase.fields },
    lineItems: baseCase.lineItems.map((item) => ({ ...item })),
  };
}

function buildSeedCases(includeBaseline = true) {
  const cases = [];

  for (const baseCase of BASE_CASES) {
    const preset = getPresetById(baseCase.presetId);
    if (includeBaseline) {
      cases.push({
        id: `baseline-${baseCase.id}`,
        label: `Baseline / ${baseCase.label}`,
        baseCaseId: baseCase.id,
        failureClass: "baseline",
        variant: "seed",
        source: preset.source,
        voucherFamily: baseCase.voucherFamily,
        shouldSupport: baseCase.shouldSupport,
        fields: { ...baseCase.fields },
        lineItems: baseCase.lineItems.map((item) => ({ ...item })),
      });
    }
  }

  return cases;
}

export function buildTallyAdversarialHarness(options = {}) {
  const includeBaseline = options.includeBaseline ?? true;
  const seed = Number.isInteger(options.seed) ? options.seed : 31;
  const cases = buildSeedCases(includeBaseline);

  BASE_CASES.forEach((baseCase, index) => {
    const preset = getPresetById(baseCase.presetId);
    cases.push(
      buildMutatedCase(baseCase, "candidate_missing", "compressed_rows", mutateCandidateMissing(preset.source, baseCase)),
    );
    cases.push(
      buildMutatedCase(baseCase, "ranking_ambiguity", "duplicate_totals", mutateRankingAmbiguity(preset.source, baseCase)),
    );
    cases.push(
      buildMutatedCase(
        baseCase,
        "structural_inconsistency",
        "role_confusion",
        mutateStructuralInconsistency(preset.source, baseCase),
      ),
    );
    cases.push(
      buildMutatedCase(baseCase, "numeric_ambiguity", "near_equal_amounts", mutateNumericAmbiguity(preset.source, baseCase)),
    );
    cases.push(
      buildMutatedCase(baseCase, "ocr_corruption", "label_noise", mutateOcrNoise(preset.source, seed + index * 17 + 1)),
    );
    cases.push(
      buildMutatedCase(baseCase, "layout_drift", "wrapped_blocks", mutateLayoutDrift(preset.source, baseCase)),
    );
  });

  return cases;
}

function getTopMargin(candidates) {
  if (!Array.isArray(candidates) || candidates.length < 2) {
    return null;
  }

  const topScore = candidates[0]?.rankingScore ?? candidates[0]?.selectedScore ?? candidates[0]?.score ?? 0;
  const secondScore =
    candidates[1]?.rankingScore ?? candidates[1]?.selectedScore ?? candidates[1]?.score ?? 0;
  return topScore - secondScore;
}

function evaluateExpectedScalarFields(state, expectedFields) {
  const reports = [];
  for (const [fieldId, expectedValue] of Object.entries(expectedFields)) {
    const candidates = state.fieldCandidates[fieldId] ?? [];
    const candidateFound = candidates.some((candidate) =>
      tallyFieldValueMatches(fieldId, candidate.value, expectedValue),
    );
    const selectedValue = state.selectedFields[fieldId] ?? null;
    const selectedMatch = tallyFieldValueMatches(fieldId, selectedValue, expectedValue);
    const topMargin = getTopMargin(candidates);

    reports.push({
      fieldId,
      expectedValue,
      candidateFound,
      selectedMatch,
      selectedValue,
      candidateCount: candidates.length,
      topMargin,
      unstable: topMargin != null && topMargin < FIELD_MARGIN_THRESHOLD,
    });
  }
  return reports;
}

function evaluateExpectedLineItems(state, expectedLineItems) {
  const reports = [];

  expectedLineItems.forEach((expectedItem, itemIndex) => {
    for (const mapping of LINE_ITEM_FIELD_MAP) {
      const expectedValue = expectedItem[mapping.recordKey];
      if (expectedValue === null || expectedValue === undefined) {
        continue;
      }

      const candidates = state.fieldCandidates[mapping.fieldId] ?? [];
      const candidateFound = candidates.some((candidate) =>
        tallyFieldValueMatches(mapping.fieldId, candidate.value, expectedValue),
      );
      const actualValue = state.lineItems[itemIndex]?.[mapping.recordKey] ?? null;
      const recordMatch = tallyFieldValueMatches(mapping.fieldId, actualValue, expectedValue);

      reports.push({
        itemIndex,
        fieldId: mapping.fieldId,
        recordKey: mapping.recordKey,
        expectedValue,
        candidateFound,
        recordMatch,
        actualValue,
        candidateCount: candidates.length,
      });
    }
  });

  return reports;
}

function ratio(hitCount, totalCount) {
  return totalCount > 0 ? hitCount / totalCount : null;
}

function summarizeReports(reports, successKey) {
  const total = reports.length;
  const hits = reports.filter((report) => report[successKey]).length;
  return {
    total,
    hits,
    rate: ratio(hits, total),
  };
}

function summarizeByFailureClass(caseReports) {
  const summaries = {};

  for (const report of caseReports) {
    const current = summaries[report.failureClass] ?? {
      failureClass: report.failureClass,
      label: TALLY_HARNESS_FAILURE_CLASSES[report.failureClass]?.label ?? report.failureClass,
      caseCount: 0,
      supportHits: 0,
      familyHits: 0,
      scalarCandidateHits: 0,
      scalarFieldCount: 0,
      scalarSelectedHits: 0,
      unstableScalarFields: 0,
      lineItemCandidateHits: 0,
      lineItemFieldCount: 0,
      lineItemRecordHits: 0,
    };

    current.caseCount += 1;
    current.supportHits += report.supportMatch ? 1 : 0;
    current.familyHits += report.familyMatch ? 1 : 0;
    current.scalarCandidateHits += report.scalarReports.filter((entry) => entry.candidateFound).length;
    current.scalarSelectedHits += report.scalarReports.filter((entry) => entry.selectedMatch).length;
    current.scalarFieldCount += report.scalarReports.length;
    current.unstableScalarFields += report.scalarReports.filter((entry) => entry.unstable).length;
    current.lineItemCandidateHits += report.lineItemReports.filter((entry) => entry.candidateFound).length;
    current.lineItemRecordHits += report.lineItemReports.filter((entry) => entry.recordMatch).length;
    current.lineItemFieldCount += report.lineItemReports.length;

    summaries[report.failureClass] = current;
  }

  return Object.fromEntries(
    Object.entries(summaries).map(([failureClass, summary]) => [
      failureClass,
      {
        ...summary,
        supportAccuracy: ratio(summary.supportHits, summary.caseCount),
        familyAccuracy: ratio(summary.familyHits, summary.caseCount),
        scalarCandidateRecall: ratio(summary.scalarCandidateHits, summary.scalarFieldCount),
        scalarTop1Accuracy: ratio(summary.scalarSelectedHits, summary.scalarFieldCount),
        instabilityRate: ratio(summary.unstableScalarFields, summary.scalarFieldCount),
        lineItemCandidateRecall: ratio(summary.lineItemCandidateHits, summary.lineItemFieldCount),
        lineItemRecordAccuracy: ratio(summary.lineItemRecordHits, summary.lineItemFieldCount),
      },
    ]),
  );
}

export function evaluateTallyHarnessCase(harnessCase) {
  const state = buildTallyExtractionState(harnessCase.source);
  const scalarReports = evaluateExpectedScalarFields(state, harnessCase.fields ?? {});
  const lineItemReports = evaluateExpectedLineItems(state, harnessCase.lineItems ?? []);

  return {
    id: harnessCase.id,
    label: harnessCase.label,
    baseCaseId: harnessCase.baseCaseId,
    failureClass: harnessCase.failureClass,
    variant: harnessCase.variant,
    expectedVoucherFamily: harnessCase.voucherFamily,
    actualVoucherFamily: state.voucherFamily,
    familyMatch: state.voucherFamily === harnessCase.voucherFamily,
    expectedSupport: Boolean(harnessCase.shouldSupport),
    actualSupport: state.schema.supported,
    supportMatch: state.schema.supported === Boolean(harnessCase.shouldSupport),
    scalarReports,
    lineItemReports,
    scalarSummary: {
      candidateRecall: summarizeReports(scalarReports, "candidateFound"),
      top1Accuracy: summarizeReports(scalarReports, "selectedMatch"),
      instabilityRate: ratio(
        scalarReports.filter((entry) => entry.unstable).length,
        scalarReports.length,
      ),
    },
    lineItemSummary: {
      candidateRecall: summarizeReports(lineItemReports, "candidateFound"),
      recordAccuracy: summarizeReports(lineItemReports, "recordMatch"),
    },
  };
}

export function evaluateTallyAdversarialHarness(options = {}) {
  const cases = buildTallyAdversarialHarness(options);
  const caseReports = cases.map(evaluateTallyHarnessCase);

  const scalarReports = caseReports.flatMap((report) => report.scalarReports);
  const lineItemReports = caseReports.flatMap((report) => report.lineItemReports);

  return {
    caseReports,
    summary: {
      caseCount: caseReports.length,
      supportAccuracy: ratio(caseReports.filter((report) => report.supportMatch).length, caseReports.length),
      familyAccuracy: ratio(caseReports.filter((report) => report.familyMatch).length, caseReports.length),
      scalarCandidateRecall: ratio(
        scalarReports.filter((entry) => entry.candidateFound).length,
        scalarReports.length,
      ),
      scalarTop1Accuracy: ratio(
        scalarReports.filter((entry) => entry.selectedMatch).length,
        scalarReports.length,
      ),
      instabilityRate: ratio(
        scalarReports.filter((entry) => entry.unstable).length,
        scalarReports.length,
      ),
      lineItemCandidateRecall: ratio(
        lineItemReports.filter((entry) => entry.candidateFound).length,
        lineItemReports.length,
      ),
      lineItemRecordAccuracy: ratio(
        lineItemReports.filter((entry) => entry.recordMatch).length,
        lineItemReports.length,
      ),
      byFailureClass: summarizeByFailureClass(caseReports),
    },
  };
}

