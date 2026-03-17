export const TALLY_DEMO_PRESETS = [
  {
    id: "tax-invoice-core",
    label: "Tax Invoice",
    description:
      "A Tally-like GST invoice with seller, buyer, place of supply, IGST, and a single grand total.",
    format: "text",
    familyOverride: "auto",
    industryOverride: "auto",
    source: `
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
`.trim(),
  },
  {
    id: "proforma-core",
    label: "Proforma Invoice",
    description:
      "A proforma invoice with PI number, buyer GSTIN, seller GSTIN, taxable amount, tax, and total.",
    format: "text",
    familyOverride: "auto",
    industryOverride: "auto",
    source: `
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
`.trim(),
  },
  {
    id: "account-statement",
    label: "Account Statement",
    description:
      "A statement-style OCR sample that should be rejected instead of forced into an invoice family.",
    format: "text",
    familyOverride: "auto",
    industryOverride: "auto",
    source: `
ACCOUNT STATEMENT
Date Narration Debit Credit Balance
01/01/2026 Opening Balance 10,000.00
02/01/2026 UPI Payment 1,250.00 8,750.00
03/01/2026 Salary Credit 25,000.00 33,750.00
04/01/2026 Closing Balance 33,750.00
`.trim(),
  },
];
