import test from "node:test";
import assert from "node:assert/strict";

import { TALLY_DEMO_PRESETS } from "./demo-samples.mjs";
import { TALLY_BROWSER_REGRESSION_CASES } from "./browser-regressions.mjs";
import {
  applyTallyFieldPredictions,
  buildTallyFieldModelExamples,
  tallyFieldValueMatches,
} from "./model-common.mjs";
import { buildTallyExtractionState, buildTallyRecord } from "./psvm.mjs";

function getPreset(id) {
  const preset = TALLY_DEMO_PRESETS.find((entry) => entry.id === id);
  if (!preset) {
    throw new Error(`Unknown preset: ${id}`);
  }
  return preset;
}

function buildSelectionFromExpectedValues(state, expectedValues) {
  const examples = buildTallyFieldModelExamples(state);
  const predictions = examples.map((example) => ({
    selectedScore: tallyFieldValueMatches(
      example.fieldId,
      example.candidate.value,
      expectedValues[example.fieldId],
    )
      ? 0.99
      : 0.01,
    notSelectedScore: tallyFieldValueMatches(
      example.fieldId,
      example.candidate.value,
      expectedValues[example.fieldId],
    )
      ? 0.01
      : 0.99,
    scores: [],
  }));
  return applyTallyFieldPredictions(state, examples, predictions);
}

test("model selection logic keeps the proforma core fields aligned", () => {
  const state = buildTallyExtractionState(getPreset("proforma-core").source);
  const selection = buildSelectionFromExpectedValues(state, {
    "document.number": "PI-0272/23-24",
    "document.date": "30/10/2023",
    "seller.name": "Zodiac Energy Ltd",
    "buyer.name": "JAYRAJ SOLAR LLP",
    "amounts.grand_total_cents": 16576000,
  });
  const record = buildTallyRecord(state, selection.selectedFields);

  assert.equal(record.voucherFamily, "proforma_invoice");
  assert.equal(record.document.number, "PI-0272/23-24");
  assert.equal(record.document.date, "30/10/2023");
  assert.equal(record.seller.name, "Zodiac Energy Ltd");
  assert.equal(record.buyer.name, "JAYRAJ SOLAR LLP");
  assert.equal(record.amounts.grandTotalCents, 16576000);
});

test("model selection logic keeps the tax invoice total and parties aligned", () => {
  const state = buildTallyExtractionState(getPreset("tax-invoice-core").source);
  const selection = buildSelectionFromExpectedValues(state, {
    "document.number": "29",
    "seller.gstin": "24AAMFJ7876R1Z8",
    "buyer.gstin": "27AADCN3773B1ZM",
    "amounts.grand_total_cents": 47200000,
  });
  const record = buildTallyRecord(state, selection.selectedFields);

  assert.equal(record.voucherFamily, "sales_invoice");
  assert.equal(record.document.number, "29");
  assert.equal(record.seller.gstin, "24AAMFJ7876R1Z8");
  assert.equal(record.buyer.gstin, "27AADCN3773B1ZM");
  assert.equal(record.amounts.grandTotalCents, 47200000);
});

test("model selection logic preserves explicit statement rejection", () => {
  const state = buildTallyExtractionState(getPreset("account-statement").source);
  const selection = buildSelectionFromExpectedValues(state, {});
  const record = buildTallyRecord(state, selection.selectedFields);

  assert.equal(record.supported, false);
  assert.equal(record.voucherFamily, "account_statement");
  assert.match(record.rejectionReason ?? "", /ledger-oriented PSVM/i);
});

test("model selection logic can align the implicit weak-label sample", () => {
  const state = buildTallyExtractionState(getPreset("implicit-sales-core").source);
  const selection = buildSelectionFromExpectedValues(state, {
    "document.number": "7782",
    "document.date": "11/07/25",
    "seller.name": "KAPOOR & SONS",
    "buyer.name": "R K ENTERPRISES",
    "amounts.grand_total_cents": 1180000,
  });
  const record = buildTallyRecord(state, selection.selectedFields);

  assert.equal(record.voucherFamily, "sales_invoice");
  assert.equal(record.document.number, "7782");
  assert.equal(record.document.date, "11/07/25");
  assert.equal(record.seller.name, "KAPOOR & SONS");
  assert.equal(record.buyer.name, "R K ENTERPRISES");
  assert.equal(record.amounts.grandTotalCents, 1180000);
});

test("model selection logic rejects document-title seller candidates even when the model over-scores them", () => {
  const source = TALLY_BROWSER_REGRESSION_CASES.find((entry) => entry.id === "browser-header-title-bleed")?.source;
  assert.ok(source);

  const state = buildTallyExtractionState(source);
  state.fieldCandidates["seller.name"] = [
    {
      fieldId: "seller.name",
      value: "TAX",
      normalizedValue: "TAX",
      displayValue: "TAX",
      score: 42,
      source: "browser_regression_injected",
      lineIndex: 0,
      lineText: "TAX INV0ICE",
      reason: "synthetic model-path regression candidate",
    },
    ...(state.fieldCandidates["seller.name"] ?? []),
  ];

  const examples = buildTallyFieldModelExamples(state);
  const predictions = examples.map((example) => ({
    selectedScore:
      example.fieldId === "seller.name" && example.candidate.value === "TAX"
        ? 0.99
        : example.fieldId === "seller.name" && example.candidate.value === "JAYRAJ SOLAR LLP"
          ? 0.61
          : 0.01,
    notSelectedScore: 0.01,
    scores: [],
  }));
  const selection = applyTallyFieldPredictions(state, examples, predictions);
  const record = buildTallyRecord(state, selection.selectedFields);

  assert.equal(record.seller.name, "JAYRAJ SOLAR LLP");
  assert.equal(record.document.placeOfSupply, "Maharashtra");
});
