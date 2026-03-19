export const TALLY_BROWSER_REGRESSION_CASES = Object.freeze([
  {
    id: "browser-header-title-bleed",
    label: "Browser OCR / Header-Title Bleed",
    description:
      "Real browser-captured OCR where invoice-title text competes with seller identity, key labels are corrupted, and line arithmetic must reconcile.",
    failureClass: "ocr_corruption",
    variant: "browser_header_title_bleed",
    voucherFamily: "sales_invoice",
    shouldSupport: true,
    fields: {
      "document.date": "23-May-25",
      "document.place_of_supply": "Maharashtra",
      "seller.name": "JAYRAJ SOLAR LLP",
      "seller.gstin": "24AAMFJ7876R1Z8",
      "buyer.name": "Nimoto Solar Pvt Ltd",
      "buyer.gstin": "27AADCN3773B1ZM",
      "consignee.name": "Nimoto Solar Pvt Ltd",
      "consignee.gstin": "27AADCN3773B1ZM",
      "taxes.igst_cents": 7344000,
      "amounts.grand_total_cents": 48144000,
    },
    lineItems: [
      {
        hsnSac: "995442",
        quantity: 250,
        unit: "KW",
        unitPriceCents: 163200,
        taxRatePercent: 18,
        amountCents: 40800000,
      },
    ],
    source: `
TAX INV0ICE

Ack Dote : 23-Moy-25
JAYRAJ SOLAR L LP
Shop No 225, Rajhans Stadium Plza,
Surat-395009, Gujrat, Indla
GSTIN/UIN : 24AAMFJ7876R1Z8

Invoice No : 2g
Dated : 23-Mey-25

Consignee (Ship to)
Nimoto Solar Pvt Ltd
GSTIN/UIN : 27AADCN3773B1ZM

Buyer (Bill to)
Nimoto Solar Pvt LId
GSTIN/UIN : 27AADCN3773B1ZM

Place of Supplv : Maharastra

------------------------------------------------------

Sl  Descriptlon of Goods            HSN/SAC   GST Rote   Qty        Rote       per   Disc%   Amount
No

1   Supply & Installatlon           995442    18%        25O.OOO KW  1,882.00  KW            4,08,000.OO
    Struucture, Electrical BOS
    suppIy, I&C for 250 KWp Solar
    Power Project at Sarigam, Gujrat

                                    IGST                          73,440.00

------------------------------------------------------

Total            25O.OOO KW                             ₹ 4,81,440.00
`.trim(),
  },
]);

export const TALLY_BROWSER_REGRESSION_PRESETS = Object.freeze(
  TALLY_BROWSER_REGRESSION_CASES.map((entry) => ({
    id: entry.id,
    label: entry.label,
    description: entry.description,
    format: "text",
    familyOverride: "auto",
    industryOverride: "auto",
    source: entry.source,
  })),
);
