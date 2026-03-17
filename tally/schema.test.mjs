import assert from "node:assert/strict";
import test from "node:test";

import {
  TALLY_VOUCHER_FAMILIES,
  buildTallyVoucherSchema,
  listSupportedIndustries,
  listVoucherFamilies,
} from "./schema.mjs";

test("sales invoice schema exposes the shared Tally-style core fields", () => {
  const schema = buildTallyVoucherSchema("sales_invoice");
  assert.equal(schema.supported, true);
  assert.equal(schema.voucherLabel, "Sales Invoice");
  assert.ok(schema.validators.includes("invoice_has_grand_total"));
  assert.ok(schema.fields.document.some((field) => field.id === "document.number"));
  assert.ok(schema.fields.amounts.some((field) => field.id === "amounts.grand_total_cents"));
  assert.ok(schema.fields.lineItems.some((field) => field.id === "line_items[].description"));
});

test("industry extensions add voucher-specific fields without changing the core", () => {
  const pharma = buildTallyVoucherSchema("sales_invoice", { industry: "pharma" });
  const stockist = buildTallyVoucherSchema("sales_invoice", { industry: "stockist" });

  assert.ok(pharma.fields.lineItems.some((field) => field.id === "line_items[].batch_number"));
  assert.ok(pharma.fields.lineItems.some((field) => field.id === "line_items[].mrp_cents"));
  assert.ok(stockist.fields.lineItems.some((field) => field.id === "line_items[].free_quantity"));
  assert.ok(
    stockist.fields.lineItems.some((field) => field.id === "line_items[].scheme_discount_cents"),
  );
  assert.ok(stockist.fields.document.every((field) => field.id !== "line_items[].free_quantity"));
});

test("statement families are modeled as explicit rejects, not supported invoice schemas", () => {
  const schema = buildTallyVoucherSchema("account_statement");
  assert.equal(schema.supported, false);
  assert.match(schema.rejectionReason, /separate ledger-oriented PSVM/i);
});

test("schema registry exposes voucher families and industry namespaces", () => {
  assert.ok(listVoucherFamilies().includes("sales_invoice"));
  assert.ok(listVoucherFamilies().includes("account_statement"));
  assert.ok(listSupportedIndustries().includes("pharma"));
  assert.equal(TALLY_VOUCHER_FAMILIES.credit_note.class, "note");
});
