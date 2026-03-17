import assert from "node:assert/strict";
import test from "node:test";

import { buildInvoiceFromReceipt, parseReceiptText, verifyReceipt } from "./receipt.mjs";
import { runInvoicePsvm } from "./psvm.mjs";

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
JAYRAJ SOLAR LLP                                       Invoice No.           e-Way Bill No. Dated
Shop No. 225, Rajhans Stadium Plaza,                   29                                   23-May-25
Near L P Savani School, Palanpore,
Surat-395009, Gujarat, India.
GSTIN/UIN: 24AAMFJ7876R1Z8
Consignee (Ship to)
Nimoto Solar Pvt Ltd
709, Lodha Supremus Road No.22, Wagle Esate,
Thane (W)-400604.
GSTIN/UIN       : 27AADCN3773B1ZM
Buyer (Bill to)
Nimoto Solar Pvt Ltd
709, Lodha Supremus Road No.22, Wagle Esate,
Thane (W)-400604.
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

test("invoice PSVM handles decimal quantities and comma-separated INR amounts", () => {
  const result = runInvoicePsvm(
    JSON.stringify({
      currency: "INR",
      taxRate: 0.18,
      items: [{ label: "Solar install", quantity: "250.000", unitPrice: "1,600.00" }],
    }),
  );

  assert.equal(result.result.subtotalCents, 40000000);
  assert.equal(result.result.taxCents, 7200000);
  assert.equal(result.result.totalCents, 47200000);
});

test("parse and verify a proforma invoice receipt", () => {
  const receipt = parseReceiptText(PROFORMA_SAMPLE);
  assert.equal(receipt.documentType, "PROFORMA INVOICE");
  assert.equal(receipt.invoiceNumber, "PI-0272/23-24");
  assert.equal(receipt.documentDate, "30/10/2023");
  assert.equal(receipt.buyer.name, "JAYRAJ SOLAR LLP");
  assert.equal(receipt.buyer.gstin, "24AAMFJ7876R1Z8");
  assert.equal(receipt.seller.gstin, "24AAACZ1284C1ZN");
  assert.equal(receipt.items[0].description, "SOFAR-5KW G-3");

  const report = verifyReceipt(receipt);
  assert.equal(report.ok, true);
  assert.equal(report.computed.totalAmountCents, 16576000);
  assert.equal(report.computed.taxAmountCents, 1776000);
});

test("parse and verify a tax invoice receipt", () => {
  const receipt = parseReceiptText(TAX_INVOICE_SAMPLE);
  assert.equal(receipt.documentType, "TAX INVOICE");
  assert.equal(receipt.invoiceNumber, "29");
  assert.equal(receipt.documentDate, "23-May-25");
  assert.equal(receipt.seller.name, "JAYRAJ SOLAR LLP");
  assert.equal(receipt.buyer.name, "Nimoto Solar Pvt Ltd");
  assert.equal(receipt.items[0].quantity, 250);

  const invoice = buildInvoiceFromReceipt(receipt);
  assert.equal(invoice.taxRate, 0.18);
  assert.equal(invoice.items[0].unitPrice, "1600.00");

  const report = verifyReceipt(receipt);
  assert.equal(report.ok, true);
  assert.equal(report.computed.taxableAmountCents, 40000000);
  assert.equal(report.computed.taxAmountCents, 7200000);
  assert.equal(report.computed.totalAmountCents, 47200000);
});
