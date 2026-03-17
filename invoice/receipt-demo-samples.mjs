export const PROFORMA_OCR_SAMPLE = `
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
`.trim();

export const TAX_INVOICE_OCR_SAMPLE = `
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
`.trim();

export const MINI_STRUCTURED_TSV_SAMPLE = [
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

export const RECEIPT_DEMO_PRESETS = Object.freeze([
  {
    id: "proforma-ocr",
    label: "Proforma OCR",
    format: "text",
    source: PROFORMA_OCR_SAMPLE,
    description: "Plain OCR text sample where the total appears on the amount-in-words line.",
  },
  {
    id: "tax-ocr",
    label: "Tax Invoice OCR",
    format: "text",
    source: TAX_INVOICE_OCR_SAMPLE,
    description: "Plain OCR text sample with duplicate amount distractors such as On Account and tax summary rows.",
  },
  {
    id: "mini-tsv",
    label: "Structured TSV Mini",
    format: "tsv",
    source: MINI_STRUCTURED_TSV_SAMPLE,
    description: "Minimal `pdftotext -tsv` sample showing split PDF fragments merged into logical rows.",
  },
]);
