import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTallyExtractionState,
  classifyTallyVoucherFamily,
  runTallyExtractionPsvm,
} from "./psvm.mjs";

const PROFORMA_SAMPLE = `
PROFORMA INVOICE
Sold to
JAYRAJ SOLAR LLP                                      PI No:          PI-0272/23-24               Date :      30/10/2023
225, Rajahans Stadium Plaza, Near LP Savani School,
Gujarat, 395009
GST No.       24AAMFJ7876R1Z8
PAYMENT TERM:- 100% Advance
SR.                                                                                            UNIT
                         PRODUCT DESCRIPTION                                  QTY                            AMOUNT RS.
NO.                                                                                           ( nos )
  1                          SOFAR-5KW G-3                                     5              29,600.00         148,000.00
                                                                                              TAXABLE           148,000.00
                                                                                            GST @ 12%            17,760.00
                                                                                              Sub Total         165,760.00
                                                                                                   TCS                 -
                                                                                          Round Off (+/-)              -
Rs. One Lacs Sixty Five Thousand Seven Hundred and Sixty Only                             TOTAL               165,760.00
GST No.       24AAACZ1284C1ZN
Zodiac Energy Ltd
`;

const TAX_INVOICE_SAMPLE = `
TAX INVOICE
Ack Date    : 23-May-25
JAYRAJ SOLAR LLP                                       Invoice No.           29               Dated 23-May-25
Shop No. 225, Rajhans Stadium Plaza,
Surat-395009, Gujarat, India.
GSTIN/UIN: 24AAMFJ7876R1Z8
Consignee (Ship to)
Nimoto Solar Pvt Ltd
GSTIN/UIN       : 27AADCN3773B1ZM
Buyer (Bill to)
Nimoto Solar Pvt Ltd
GSTIN/UIN         : 27AADCN3773B1ZM
Place of Supply : Maharashtra
Sl         Description of Goods       HSN/SAC GST                  Quantity        Rate           Rate     per Disc. %        Amount
No.                                           Rate                             (Incl. of Tax)

 1 Supply and Installation           995442               18 % 250.000 KW        1,888.00         1,600.00 KW                4,00,000.00
   Structure, Electrical BOS
   supply, I&C for 250 KWp Solar
   Power Project at Sarigam, Gujarat

                                    IGST                                                                                       72,000.00
                                     Total                       250.000 KW                                                ₹ 4,72,000.00
`;

const STATEMENT_SAMPLE = `
ACCOUNT STATEMENT
Date Narration Debit Credit Balance
01/01/2026 Opening Balance 10,000.00
02/01/2026 UPI Payment 1,250.00 8,750.00
03/01/2026 Salary Credit 25,000.00 33,750.00
04/01/2026 Closing Balance 33,750.00
`;

const IMPLICIT_FIELD_SAMPLE = `
#7782      11/07/25

KAPOOR & SONS
24ABCDE1111F1Z3

Client:
R K ENTERPRISES
24AAAAA2222G1Z4

Supply: Gujarat

Item        Qty   Price   Total
Tiles       200   50      10000

Tax 18%              1800

Final Amount         11800
`;

const JSONISH_OCR_SAMPLE = `
TAX INVOICE
Seller
"name": "MAHAVIR ENERGY SYSTEMS",
"gstin": "24AAACZ1284C1ZN",
Buyer
"name": "Nimoto Solar Pvt Ltd",
"gstin": "27AADCN3773B1ZM",
CGST 36,000.00
SGST 36,000.00
Final Amount 4,72,000.00
`;

test("voucher classifier prefers proforma over generic invoice families", () => {
  const classification = classifyTallyVoucherFamily(PROFORMA_SAMPLE);
  assert.equal(classification.selectedFamily.voucherFamily, "proforma_invoice");
  assert.ok(
    classification.rankedFamilies.some(
      (family) => family.voucherFamily === "sales_invoice" && family.score < classification.selectedFamily.score,
    ),
  );
});

test("tally PSVM extracts shared document fields from a proforma invoice", () => {
  const result = runTallyExtractionPsvm(PROFORMA_SAMPLE);
  assert.equal(result.result.voucherFamily, "proforma_invoice");
  assert.equal(result.result.supported, true);
  assert.equal(result.result.document.number, "PI-0272/23-24");
  assert.equal(result.result.document.date, "30/10/2023");
  assert.equal(result.result.buyer.name, "JAYRAJ SOLAR LLP");
  assert.equal(result.result.seller.gstin, "24AAACZ1284C1ZN");
  assert.equal(result.result.amounts.taxableAmountCents, 14800000);
  assert.equal(result.result.amounts.grandTotalCents, 16576000);
  assert.equal(result.result.lineItems[0].description, "SOFAR-5KW G-3");
  assert.equal(result.result.lineItems[0].unit?.toLowerCase(), "nos");
  assert.equal(result.result.lineItems[0].unitPriceCents, 2960000);
});

test("tally PSVM extracts a sales-invoice style core record", () => {
  const state = buildTallyExtractionState(TAX_INVOICE_SAMPLE);
  assert.equal(state.voucherFamily, "sales_invoice");
  assert.equal(state.industry, "generic");
  assert.equal(state.selectedFields["document.place_of_supply"], "Maharashtra");
  assert.equal(state.selectedFields["taxes.igst_cents"], 7200000);

  const result = runTallyExtractionPsvm(TAX_INVOICE_SAMPLE);
  assert.equal(result.result.document.number, "29");
  assert.equal(result.result.document.date, "23-May-25");
  assert.equal(result.result.seller.name, "JAYRAJ SOLAR LLP");
  assert.equal(result.result.buyer.gstin, "27AADCN3773B1ZM");
  assert.equal(result.result.amounts.grandTotalCents, 47200000);
  assert.equal(result.result.lineItems[0].hsnSac, "995442");
  assert.equal(result.result.lineItems[0].quantity, 250);
  assert.equal(result.result.lineItems[0].unit, "KW");
  assert.equal(result.result.lineItems[0].unitPriceCents, 160000);
  assert.equal(result.result.lineItems[0].taxRatePercent, 18);
  assert.match(result.result.lineItems[0].description, /Power Project at Sarigam, Gujarat/);
});

test("statement-like OCR is classified as unsupported instead of guessed as an invoice", () => {
  const result = runTallyExtractionPsvm(STATEMENT_SAMPLE);
  assert.equal(result.result.voucherFamily, "account_statement");
  assert.equal(result.result.supported, false);
  assert.match(result.result.rejectionReason, /ledger-oriented PSVM/i);
  assert.equal(result.result.amounts.grandTotalCents, null);
  assert.ok(!("document.number" in result.state.fieldCandidates));
});

test("tally PSVM surfaces implicit header fields and weak-label totals", () => {
  const state = buildTallyExtractionState(IMPLICIT_FIELD_SAMPLE);
  assert.equal(state.voucherFamily, "sales_invoice");
  assert.equal(state.selectedFields["document.number"], "7782");
  assert.equal(state.selectedFields["document.date"], "11/07/25");
  assert.equal(state.selectedFields["document.place_of_supply"], "Gujarat");
  assert.equal(state.selectedFields["seller.name"], "KAPOOR & SONS");
  assert.equal(state.selectedFields["buyer.name"], "R K ENTERPRISES");
  assert.equal(state.selectedFields["amounts.grand_total_cents"], 1180000);

  const result = runTallyExtractionPsvm(IMPLICIT_FIELD_SAMPLE);
  assert.equal(result.result.document.number, "7782");
  assert.equal(result.result.document.date, "11/07/25");
  assert.equal(result.result.seller.gstin, "24ABCDE1111F1Z3");
  assert.equal(result.result.buyer.gstin, "24AAAAA2222G1Z4");
  assert.equal(result.result.amounts.grandTotalCents, 1180000);
  assert.equal(result.result.lineItems[0].description, "Tiles");
  assert.equal(result.result.lineItems[0].quantity, 200);
  assert.equal(result.result.lineItems[0].unitPriceCents, 5000);
  assert.equal(result.result.lineItems[0].amountCents, 1000000);
});

test("tally PSVM sanitizes JSON-like OCR fragments instead of emitting polluted fields", () => {
  const state = buildTallyExtractionState(JSONISH_OCR_SAMPLE);
  assert.equal(state.selectedFields["seller.name"], "MAHAVIR ENERGY SYSTEMS");
  assert.equal(state.selectedFields["seller.gstin"], "24AAACZ1284C1ZN");
  assert.equal(state.selectedFields["buyer.name"], "Nimoto Solar Pvt Ltd");
  assert.equal(state.selectedFields["buyer.gstin"], "27AADCN3773B1ZM");
  assert.equal(state.selectedFields["taxes.cgst_cents"], 3600000);
  assert.equal(state.selectedFields["taxes.sgst_cents"], 3600000);
  assert.equal(state.selectedFields["amounts.grand_total_cents"], 47200000);

  const result = runTallyExtractionPsvm(JSONISH_OCR_SAMPLE);
  assert.equal(result.result.seller.name, "MAHAVIR ENERGY SYSTEMS");
  assert.equal(result.result.buyer.name, "Nimoto Solar Pvt Ltd");
  assert.equal(result.result.amounts.grandTotalCents, 47200000);
});
