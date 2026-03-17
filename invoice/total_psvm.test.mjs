import assert from "node:assert/strict";
import test from "node:test";

import { parsePdftotextTsv } from "./ocr_layout.mjs";
import {
  buildReceiptTotalState,
  runReceiptTotalPsvm,
  scoreReceiptTotalTeacherCandidate,
} from "./total_psvm.mjs";

const PROFORMA_SAMPLE = `
PROFORMA INVOICE
Sold to
JAYRAJ SOLAR LLP                                      PI No:          PI-0272/23-24               Date :      30/10/2023
225, Rajahans Stadium Plaza, Near LP Savani School,
Beside Santvan Skyon, Palanpore, Surat, Surat,        PO No.:                                     Date :
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
`;

const TAX_INVOICE_SAMPLE = `
TAX INVOICE
Ack Date    : 23-May-25

                   JAYRAJ SOLAR LLP                                       Invoice No.           e-Way Bill No. Dated
                   Shop No. 225, Rajhans Stadium Plaza,                   29                                   23-May-25
                   Near L P Savani School, Palanpore,
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
   Bill Details:
   On Account                  4,72,000.00 Dr

                                     Total                       250.000 KW                                                ₹ 4,72,000.00
`;

const STRUCTURED_TSV_SAMPLE = [
  "level\tpage_num\tpar_num\tblock_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext",
  "1\t1\t0\t0\t0\t0\t0\t0\t595.320010\t841.920040\t-1\t###PAGE###",
  "5\t1\t0\t33\t0\t0\t48.96\t469.81\t8.25\t9.89\t100\tOn",
  "5\t1\t0\t33\t0\t1\t58.90\t469.81\t22.46\t9.89\t100\tAccount",
  "5\t1\t0\t35\t0\t0\t155.64\t469.81\t37.98\t9.89\t100\t4,72,000.00",
  "5\t1\t0\t35\t0\t1\t198.24\t469.89\t9.48\t8.76\t100\tDr",
  "5\t1\t0\t36\t0\t0\t179.88\t631.78\t19.62\t8.74\t100\tTotal",
  "5\t1\t0\t37\t0\t0\t285.48\t631.98\t27.94\t9.68\t100\t250.000",
  "5\t1\t0\t37\t0\t1\t318.12\t631.98\t10.14\t9.68\t100\tKW",
  "5\t1\t0\t38\t0\t0\t483.35\t632.08\t5.80\t11.79\t100\t₹",
  "5\t1\t0\t38\t0\t1\t492.12\t632.08\t55.71\t11.79\t100\t4,72,000.00",
].join("\n");

test("receipt total PSVM extracts real money candidates from OCR text", () => {
  const state = buildReceiptTotalState(PROFORMA_SAMPLE);
  assert.equal(state.documentType, "PROFORMA INVOICE");
  assert.ok(state.candidates.length >= 5);
  assert.ok(state.candidates.some((candidate) => candidate.amountCents === 16576000));
  assert.ok(state.candidates.some((candidate) => candidate.explicitTotalCue));
});

test("teacher scoring picks the proforma total candidate", () => {
  const result = runReceiptTotalPsvm(PROFORMA_SAMPLE);
  assert.equal(result.result.totalCents, 16576000);
  assert.match(result.selectedCandidate.lineText, /TOTAL/i);
});

test("teacher scoring prefers the explicit total line over duplicate balance lines", () => {
  const state = buildReceiptTotalState(TAX_INVOICE_SAMPLE);
  const ranked = state.candidates
    .map((candidate) => ({
      ...candidate,
      score: scoreReceiptTotalTeacherCandidate(state, candidate),
    }))
    .sort((left, right) => right.score - left.score);

  assert.equal(ranked[0].amountCents, 47200000);
  assert.match(ranked[0].lineText, /\bTotal\b/i);
  assert.ok(ranked.some((candidate) => /On Account/i.test(candidate.lineText)));
});

test("structured OCR rows merge split PDF fragments into one candidate row", () => {
  const source = parsePdftotextTsv(STRUCTURED_TSV_SAMPLE);
  assert.equal(source.rows.length, 2);
  assert.equal(source.rows[0].text, "On Account 4,72,000.00 Dr");
  assert.equal(source.rows[1].text, "Total 250.000 KW ₹ 4,72,000.00");

  const result = runReceiptTotalPsvm(source);
  assert.equal(result.result.totalCents, 47200000);
  assert.match(result.selectedCandidate.lineText, /^Total 250\.000 KW ₹ 4,72,000\.00$/);
  assert.equal(result.selectedCandidate.explicitCueBeforeAmount, true);
  assert.equal(result.selectedCandidate.pageRightBucket, "edge");
});

test("account statement style tables are rejected instead of guessing a total", () => {
  const statementSample = `
ACCOUNT STATEMENT
Date Narration Debit Credit Balance
01/01/2026 Opening Balance 10,000.00
02/01/2026 UPI Payment 1,250.00 8,750.00
03/01/2026 Salary Credit 25,000.00 33,750.00
04/01/2026 Closing Balance 33,750.00
`;

  assert.throws(
    () => buildReceiptTotalState(statementSample),
    /Account statements are not supported yet/i,
  );
});
