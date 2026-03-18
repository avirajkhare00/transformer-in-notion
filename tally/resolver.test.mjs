import assert from "node:assert/strict";
import test from "node:test";

import { buildTallyVoucherSchema } from "./schema.mjs";
import { resolveTallyFieldSelection } from "./resolver.mjs";

function createCandidate(fieldId, value, score, options = {}) {
  return {
    fieldId,
    value,
    normalizedValue: value,
    displayValue: String(value),
    rankingScore: score,
    selectedScore: score,
    source: options.source ?? "test",
    score: options.priorScore ?? 80,
    lineIndex: options.lineIndex ?? null,
    lineText: options.lineText ?? null,
    reason: options.reason ?? "resolver test candidate",
  };
}

function buildState(voucherFamily = "sales_invoice") {
  return {
    voucherFamily,
    industry: "generic",
    schema: buildTallyVoucherSchema(voucherFamily, { industry: "generic" }),
    fieldCandidates: {},
    lineItems: [],
  };
}

test("resolver drops CGST and SGST when seller and buyer states imply IGST", () => {
  const state = buildState("sales_invoice");
  const resolution = resolveTallyFieldSelection(
    state,
    {
      "seller.gstin": [createCandidate("seller.gstin", "24AAMFJ7876R1Z8", 0.99)],
      "buyer.gstin": [createCandidate("buyer.gstin", "27AADCN3773B1ZM", 0.96)],
      "document.place_of_supply": [createCandidate("document.place_of_supply", "Maharashtra", 0.88)],
      "amounts.taxable_amount_cents": [createCandidate("amounts.taxable_amount_cents", 40000000, 0.93)],
      "taxes.igst_cents": [createCandidate("taxes.igst_cents", 7200000, 0.83)],
      "taxes.cgst_cents": [createCandidate("taxes.cgst_cents", 3600000, 0.91)],
      "taxes.sgst_cents": [createCandidate("taxes.sgst_cents", 3600000, 0.9)],
      "amounts.grand_total_cents": [createCandidate("amounts.grand_total_cents", 47200000, 0.95)],
    },
    { topK: 2 },
  );

  assert.equal(resolution.selectedFields["taxes.igst_cents"], 7200000);
  assert.equal(resolution.selectedFields["taxes.cgst_cents"], null);
  assert.equal(resolution.selectedFields["taxes.sgst_cents"], null);
  assert.equal(resolution.resolverDebug.highViolationCount, 0);
});

test("resolver prefers CGST and SGST over IGST for intra-state invoices", () => {
  const state = buildState("sales_invoice");
  const resolution = resolveTallyFieldSelection(
    state,
    {
      "seller.gstin": [createCandidate("seller.gstin", "24AAMFJ7876R1Z8", 0.99)],
      "buyer.gstin": [createCandidate("buyer.gstin", "24AAACZ1284C1ZN", 0.97)],
      "document.place_of_supply": [createCandidate("document.place_of_supply", "Gujarat", 0.88)],
      "amounts.taxable_amount_cents": [createCandidate("amounts.taxable_amount_cents", 1000000, 0.94)],
      "taxes.igst_cents": [createCandidate("taxes.igst_cents", 180000, 0.93)],
      "taxes.cgst_cents": [createCandidate("taxes.cgst_cents", 90000, 0.86)],
      "taxes.sgst_cents": [createCandidate("taxes.sgst_cents", 90000, 0.85)],
      "amounts.grand_total_cents": [createCandidate("amounts.grand_total_cents", 1180000, 0.97)],
    },
    { topK: 2 },
  );

  assert.equal(resolution.selectedFields["taxes.igst_cents"], null);
  assert.equal(resolution.selectedFields["taxes.cgst_cents"], 90000);
  assert.equal(resolution.selectedFields["taxes.sgst_cents"], 90000);
  assert.equal(resolution.resolverDebug.highViolationCount, 0);
});

test("resolver avoids selecting the same GSTIN for seller and buyer when an alternative exists", () => {
  const state = buildState("sales_invoice");
  const resolution = resolveTallyFieldSelection(
    state,
    {
      "seller.gstin": [createCandidate("seller.gstin", "24AAMFJ7876R1Z8", 0.98)],
      "buyer.gstin": [
        createCandidate("buyer.gstin", "24AAMFJ7876R1Z8", 0.99),
        createCandidate("buyer.gstin", "27AADCN3773B1ZM", 0.82),
      ],
      "amounts.grand_total_cents": [createCandidate("amounts.grand_total_cents", 47200000, 0.95)],
    },
    { topK: 2 },
  );

  assert.equal(resolution.selectedFields["seller.gstin"], "24AAMFJ7876R1Z8");
  assert.equal(resolution.selectedFields["buyer.gstin"], "27AADCN3773B1ZM");
  assert.equal(
    resolution.resolverDebug.violations.some((violation) => violation.code === "seller_buyer_same_gstin"),
    false,
  );
  assert.ok(Array.isArray(resolution.resolverDebug.alternatives));
  assert.ok(resolution.resolverDebug.alternatives.length > 0);
});

test("resolver keeps explicit grand total when tax block evidence is missing", () => {
  const state = buildState("proforma_invoice");
  const resolution = resolveTallyFieldSelection(
    state,
    {
      "amounts.taxable_amount_cents": [createCandidate("amounts.taxable_amount_cents", 14800000, 0.93)],
      "amounts.round_off_cents": [createCandidate("amounts.round_off_cents", 0, 0.91)],
      "amounts.grand_total_cents": [
        createCandidate("amounts.grand_total_cents", 16576000, 0.95, {
          source: "receipt_parser",
          priorScore: 120,
        }),
        createCandidate("amounts.grand_total_cents", 14800000, 0.75, {
          source: "total_ranker",
          priorScore: 75,
        }),
      ],
    },
    { topK: 2 },
  );

  assert.equal(resolution.selectedFields["amounts.grand_total_cents"], 16576000);
  assert.equal(
    resolution.resolverDebug.violations.some((violation) => violation.code === "grand_total_consistency"),
    false,
  );
});

test("resolver keeps taxable amount when subtotal and grand total are present without tax candidates", () => {
  const state = buildState("proforma_invoice");
  const resolution = resolveTallyFieldSelection(
    state,
    {
      "amounts.taxable_amount_cents": [createCandidate("amounts.taxable_amount_cents", 14800000, 0.84)],
      "amounts.subtotal_cents": [createCandidate("amounts.subtotal_cents", 16576000, 0.8)],
      "amounts.grand_total_cents": [createCandidate("amounts.grand_total_cents", 16576000, 0.92)],
    },
    { topK: 2 },
  );

  assert.equal(resolution.selectedFields["amounts.taxable_amount_cents"], 14800000);
  assert.equal(resolution.selectedFields["amounts.subtotal_cents"], 16576000);
  assert.equal(resolution.selectedFields["amounts.grand_total_cents"], 16576000);
});
