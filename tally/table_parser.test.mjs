import assert from "node:assert/strict";
import test from "node:test";

import { TALLY_BROWSER_REGRESSION_CASES } from "./browser-regressions.mjs";
import { extractTallyLineItems } from "./table_parser.mjs";

const TAX_INVOICE_SAMPLE = `
TAX INVOICE
Ack Date    : 23-May-25
JAYRAJ SOLAR LLP                                       Invoice No.           29               Dated 23-May-25
Place of Supply : Maharashtra
Sl         Description of Goods       HSN/SAC GST                  Quantity        Rate           Rate     per Disc. %        Amount
No.                                           Rate                             (Incl. of Tax)

 1 Supply and Installation           995442               18 % 250.000 KW        1,888.00         1,600.00 KW                4,00,000.00
   Structure, Electrical BOS
   supply, I&C for 250 KWp Solar
   Power Project at Sarigam, Gujarat

                                    IGST                                                                                       72,000.00
                                     Total                       250.000 KW                                                ₹ 4,72,000.00
`.trim();

const PROFORMA_SAMPLE = `
PROFORMA INVOICE
Sold to
JAYRAJ SOLAR LLP                                      PI No:          PI-0272/23-24               Date :      30/10/2023
SR.                                                                                            UNIT
                         PRODUCT DESCRIPTION                                  QTY                            AMOUNT RS.
NO.                                                                                           ( nos )
  1                          SOFAR-5KW G-3                                     5              29,600.00         148,000.00
                                                                                              TAXABLE           148,000.00
                                                                                          Round Off (+/-)              -
Rs. One Lacs Sixty Five Thousand Seven Hundred and Sixty Only                             TOTAL               165,760.00
`.trim();

const OCR_SPLIT_ROW_SAMPLE = `
TAX INVOICE
Ack Date    : 23-May-25
JAYR4J SOLAR LLP                                       Invoice No.           29               Dated 23-May-25
Shop No. 225, Rajhans Stadium Plaza,
Surat-395009, Gujrat, Indla.
GSTIN/UIN: 24AAMFJ7876R1Z8
Consignee (Ship to)
Nimoto Solar Pvt Ltd
GSTIN/UIN       : 27AADCN3773B1ZM
Buyer (Bill to)
Nimoto Solar Pvt Ltd
GSTIN/UIN         : 27AADCN3773B1ZM
Place of Supply : Maharastra
Sl         Description of Goods       HSN/SAC GST                  Quantity        Rate           Rate     per Disc. %        Amount
No.                                           Rate                             (Incl. of Tax)

 1 Installatlon, Struucture, suppIy   995442               18 % 25O.OOO KW        1,888.00         1,6OO.00 KW                4,00,000.00
   Electrical BOS and I&C
   for 25O KWp Solar Power Project

                                    IGST                                                                                       72,000.00
                                     Total                       25O.OOO KW                                                ₹ 4,72,000.00
`.trim();

const BROWSER_REGRESSION_SAMPLE = TALLY_BROWSER_REGRESSION_CASES.find(
  (entry) => entry.id === "browser-header-title-bleed",
)?.source;

function createRow(rowIndex, cells) {
  const words = [];
  for (const cell of cells) {
    const tokens = String(cell.text)
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    let cursor = cell.x;
    for (const token of tokens) {
      words.push({
        text: token,
        xMin: cursor,
        xMax: cursor + token.length * 8,
        yMin: rowIndex * 24,
        yMax: rowIndex * 24 + 16,
        pageIndex: 0,
        pageWidth: 1280,
        pageHeight: 1200,
      });
      cursor += token.length * 8 + 10;
    }
  }

  return {
    rowIndex,
    pageIndex: 0,
    pageWidth: 1280,
    pageHeight: 1200,
    words,
    text: words.map((word) => word.text).join(" "),
  };
}

test("table parser keeps multiline invoice descriptions together", () => {
  const parsed = extractTallyLineItems(TAX_INVOICE_SAMPLE);
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].hsnSac, "995442");
  assert.equal(parsed.items[0].quantity, 250);
  assert.equal(parsed.items[0].unit, "KW");
  assert.equal(parsed.items[0].unitPriceCents, 160000);
  assert.equal(parsed.items[0].taxRatePercent, 18);
  assert.equal(parsed.items[0].amountCents, 40000000);
  assert.match(parsed.items[0].description, /Structure, Electrical BOS/);
  assert.match(parsed.items[0].description, /Power Project at Sarigam, Gujarat/);
});

test("table parser handles proforma-style compact rows", () => {
  const parsed = extractTallyLineItems(PROFORMA_SAMPLE);
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].description, "SOFAR-5KW G-3");
  assert.equal(parsed.items[0].quantity, 5);
  assert.equal(parsed.items[0].unit?.toLowerCase(), "nos");
  assert.equal(parsed.items[0].unitPriceCents, 2960000);
  assert.equal(parsed.items[0].amountCents, 14800000);
});

test("table parser merges split numeric rows and normalizes OCR digit noise", () => {
  const parsed = extractTallyLineItems(OCR_SPLIT_ROW_SAMPLE);
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].hsnSac, "995442");
  assert.equal(parsed.items[0].quantity, 250);
  assert.equal(parsed.items[0].unit, "KW");
  assert.equal(parsed.items[0].unitPriceCents, 160000);
  assert.equal(parsed.items[0].taxRatePercent, 18);
  assert.equal(parsed.items[0].amountCents, 40000000);
});

test("table parser infers a consistent unit price when OCR rates disagree with amount math", () => {
  assert.ok(BROWSER_REGRESSION_SAMPLE);

  const parsed = extractTallyLineItems(BROWSER_REGRESSION_SAMPLE);
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].quantity, 250);
  assert.equal(parsed.items[0].unit, "KW");
  assert.equal(parsed.items[0].unitPriceCents, 163200);
  assert.equal(parsed.items[0].amountCents, 40800000);
});

test("table parser reads structured OCR columns for pharma extras", () => {
  const structuredSource = {
    kind: "receipt_ocr_source",
    pageCount: 1,
    text: "",
    rows: [
      createRow(0, [{ text: "TAX INVOICE", x: 40 }]),
      createRow(1, [
        { text: "Sl", x: 20 },
        { text: "Description", x: 120 },
        { text: "HSN", x: 520 },
        { text: "Batch", x: 630 },
        { text: "Exp", x: 730 },
        { text: "Qty", x: 820 },
        { text: "Rate", x: 900 },
        { text: "Amount", x: 1030 },
      ]),
      createRow(2, [
        { text: "1", x: 20 },
        { text: "PARACETAMOL TABLET", x: 120 },
        { text: "30049099", x: 520 },
        { text: "B124", x: 630 },
        { text: "12/27", x: 730 },
        { text: "10", x: 820 },
        { text: "20.00", x: 900 },
        { text: "200.00", x: 1030 },
      ]),
      createRow(3, [{ text: "Total 200.00", x: 950 }]),
    ],
  };
  structuredSource.text = structuredSource.rows.map((row) => row.text).join("\n");

  const parsed = extractTallyLineItems(structuredSource);
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].description, "PARACETAMOL TABLET");
  assert.equal(parsed.items[0].hsnSac, "30049099");
  assert.equal(parsed.items[0].batchNumber, "B124");
  assert.equal(parsed.items[0].expiryDate, "12/27");
  assert.equal(parsed.items[0].quantity, 10);
  assert.equal(parsed.items[0].unitPriceCents, 2000);
  assert.equal(parsed.items[0].amountCents, 20000);
});
