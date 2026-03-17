import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runInvoicePsvm } from "./psvm.mjs";
import { runReceiptTotalPsvm } from "./total_psvm.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_OUTPUT = resolve(__dirname, "training/invoice-total-dataset.json");
const DEFAULT_COUNT = 2000;
const DEFAULT_SEED = 23;

const LABEL_NAMES = ["NOT_TOTAL", "TOTAL"];
const TAX_RATES = [0, 0.05, 0.12, 0.18];
const SELLER_NAMES = [
  "Zodiac Energy Ltd",
  "JAYRAJ SOLAR LLP",
  "Nimoto Solar Pvt Ltd",
  "Suncrest Projects Private Limited",
  "Helio Grid Systems LLP",
  "Bluebeam Power Solutions Pvt Ltd",
];
const BUYER_NAMES = [
  "Nimoto Solar Pvt Ltd",
  "JAYRAJ SOLAR LLP",
  "Aster Buildtech Pvt Ltd",
  "Vertex Agro LLP",
  "Crestline Warehousing Limited",
  "Vihan Infra Projects Pvt Ltd",
];
const ITEM_LABELS = [
  "Supply and Installation",
  "Solar inverter supply",
  "Structure and BOS package",
  "Project commissioning",
  "Remote monitoring setup",
  "Electrical audit bundle",
  "Maintenance retainer",
  "Panel cleaning package",
];
const ITEM_SUFFIXES = [
  "for rooftop plant",
  "for phase-2 block",
  "for warehouse bay",
  "for pilot deployment",
  "for Gujarat site",
  "for Thane project",
  "for line extension",
  "for service package",
];
const UNITS = [
  {
    label: "nos",
    quantity: (rng) => String(randomInt(1, 12, rng)),
    unitPriceCents: (rng) => randomInt(240000, 4200000, rng),
  },
  {
    label: "KW",
    quantity: (rng) => `${randomInt(50, 350, rng)}.000`,
    unitPriceCents: (rng) => randomInt(55000, 210000, rng),
  },
  {
    label: "hrs",
    quantity: (rng) => String(randomInt(4, 36, rng)),
    unitPriceCents: (rng) => randomInt(4500, 22000, rng),
  },
  {
    label: "sets",
    quantity: (rng) => String(randomInt(1, 6, rng)),
    unitPriceCents: (rng) => randomInt(95000, 850000, rng),
  },
];

function parseArgs(argv) {
  let output = DEFAULT_OUTPUT;
  let count = DEFAULT_COUNT;
  let seed = DEFAULT_SEED;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--output" && argv[index + 1]) {
      output = resolve(process.cwd(), argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--count" && argv[index + 1]) {
      count = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--seed" && argv[index + 1]) {
      seed = Number(argv[index + 1]);
      index += 1;
    }
  }

  if (!Number.isInteger(count) || count <= 0) {
    throw new Error("--count must be a positive integer.");
  }
  if (!Number.isInteger(seed)) {
    throw new Error("--seed must be an integer.");
  }

  return { output, count, seed };
}

function mulberry32(seed) {
  let current = seed >>> 0;
  return function next() {
    current += 0x6d2b79f5;
    let value = current;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function randomInt(min, maxInclusive, rng) {
  return Math.floor(rng() * (maxInclusive - min + 1)) + min;
}

function pick(values, rng) {
  return values[randomInt(0, values.length - 1, rng)];
}

function formatDate(rng) {
  const day = String(randomInt(1, 28, rng)).padStart(2, "0");
  const month = String(randomInt(1, 12, rng)).padStart(2, "0");
  const year = randomInt(2023, 2026, rng);
  return `${day}/${month}/${year}`;
}

function formatInvoiceId(rng, templateId, receiptIndex) {
  const serial = String(receiptIndex + 1).padStart(4, "0");
  if (templateId === "proforma") {
    return `PI-${serial}/${randomInt(23, 26, rng)}-${randomInt(24, 27, rng)}`;
  }
  return String(receiptIndex + 1);
}

function makeGstin(rng) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const base = [
    String(randomInt(10, 37, rng)).padStart(2, "0"),
    ...Array.from({ length: 5 }, () => alphabet[randomInt(0, alphabet.length - 1, rng)]),
    ...Array.from({ length: 4 }, () => String(randomInt(0, 9, rng))),
    alphabet[randomInt(0, alphabet.length - 1, rng)],
    String(randomInt(0, 9, rng)),
    alphabet[randomInt(0, alphabet.length - 1, rng)],
    String(randomInt(1, 9, rng)),
  ];
  return `${base.slice(0, 2).join("")}${base.slice(2, 7).join("")}${base
    .slice(7, 11)
    .join("")}${base.slice(11).join("")}`;
}

function formatNumber(cents) {
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function formatQuantity(quantity) {
  return Number.isInteger(quantity)
    ? String(quantity)
    : quantity.toFixed(3).replace(/\.?0+$/, "");
}

function buildInvoiceSource(rng) {
  const itemCount = randomInt(1, 4, rng);
  const items = [];
  for (let index = 0; index < itemCount; index += 1) {
    const unit = pick(UNITS, rng);
    items.push({
      label: `${pick(ITEM_LABELS, rng)} ${pick(ITEM_SUFFIXES, rng)}`,
      quantity: unit.quantity(rng),
      unitPrice: (unit.unitPriceCents(rng) / 100).toFixed(2),
      unit: unit.label,
    });
  }

  return JSON.stringify(
    {
      currency: "INR",
      taxRate: pick(TAX_RATES, rng),
      items,
    },
    null,
    2,
  );
}

function extractLineTotals(result) {
  return result.trace
    .filter((event) => event.op === "LINE_TOTAL")
    .map((event) => event.lineCents);
}

function maybeCorruptLabel(label, rng) {
  let value = label;
  if (rng() < 0.25) {
    value = value.toUpperCase();
  }
  if (rng() < 0.15) {
    value = value.replace(/O/g, "0");
  }
  return value;
}

function joinColumns(columns) {
  return columns.filter(Boolean).join("  ");
}

function makeAmountInWordsStub() {
  return "Rs. Amount in words only";
}

function renderProformaReceipt(example, rng) {
  const { result, lineTotals, invoiceId, documentDate, seller, buyer } = example;
  const taxPercent = Math.round(result.invoice.taxBasisPoints / 100);
  const positiveLineIndices = new Set();
  const lines = [
    "PROFORMA INVOICE",
    "Sold to",
    joinColumns([buyer.name, `PI No: ${invoiceId}`, `Date : ${documentDate}`]),
    buyer.address,
    `GST No. ${buyer.gstin}`,
    "PAYMENT TERM:- 100% Advance",
    "SR.  PRODUCT DESCRIPTION  QTY  UNIT  AMOUNT RS.",
  ];

  result.invoice.items.forEach((item, index) => {
    lines.push(
      joinColumns([
        String(index + 1),
        item.label,
        formatQuantity(item.quantity),
        formatNumber(item.unitCents),
        formatNumber(lineTotals[index]),
      ]),
    );
  });

  lines.push(joinColumns(["TAXABLE", formatNumber(result.result.subtotalCents)]));
  lines.push(joinColumns([`GST @ ${taxPercent}%`, formatNumber(result.result.taxCents)]));
  lines.push(joinColumns(["Sub Total", formatNumber(result.result.totalCents)]));
  if (rng() < 0.65) {
    lines.push(joinColumns(["TCS", "-"]));
    lines.push(joinColumns(["Round Off (+/-)", "-"]));
    positiveLineIndices.add(lines.length);
    lines.push(
      joinColumns([
        makeAmountInWordsStub(),
        maybeCorruptLabel("TOTAL", rng),
        formatNumber(result.result.totalCents),
      ]),
    );
  } else {
    positiveLineIndices.add(lines.length);
    lines.push(joinColumns([maybeCorruptLabel("TOTAL", rng), formatNumber(result.result.totalCents)]));
  }
  lines.push(`${seller.name}`);
  lines.push(`GST No. ${seller.gstin}`);

  return { text: lines.join("\n"), positiveLineIndices };
}

function renderTaxInvoiceReceipt(example, rng) {
  const { result, lineTotals, invoiceId, documentDate, seller, buyer } = example;
  const taxPercent = Math.round(result.invoice.taxBasisPoints / 100);
  const positiveLineIndices = new Set();
  const lines = [
    "TAX INVOICE",
    joinColumns([seller.name, `Invoice No. ${invoiceId}`, documentDate]),
    `GSTIN/UIN: ${seller.gstin}`,
    "Buyer (Bill to)",
    buyer.name,
    `GSTIN/UIN: ${buyer.gstin}`,
    "Description of Goods  GST  Quantity  Rate(Incl of Tax)  Rate  Amount",
  ];

  result.invoice.items.forEach((item, index) => {
    const lineAmount = lineTotals[index];
    const grossUnitCents =
      result.invoice.taxBasisPoints > 0
        ? Math.round(item.unitCents * (1 + result.invoice.taxBasisPoints / 10000))
        : item.unitCents;
    lines.push(
      joinColumns([
        String(index + 1),
        item.label,
        `${taxPercent}%`,
        `${formatQuantity(item.quantity)} ${item.unit ?? "pcs"}`,
        formatNumber(grossUnitCents),
        formatNumber(item.unitCents),
        item.unit ?? "pcs",
        formatNumber(lineAmount),
      ]),
    );
  });

  if (result.result.taxCents > 0) {
    lines.push(joinColumns(["IGST", formatNumber(result.result.taxCents)]));
  }
  lines.push(joinColumns(["On Account", `${formatNumber(result.result.totalCents)} Dr`]));
  positiveLineIndices.add(lines.length);
  lines.push(
    joinColumns([
      maybeCorruptLabel("Total", rng),
      `${formatQuantity(result.invoice.items[0]?.quantity ?? 0)} ${result.invoice.items[0]?.unit ?? "pcs"}`,
      `₹ ${formatNumber(result.result.totalCents)}`,
    ]),
  );
  if (result.result.taxCents > 0) {
    lines.push(
      joinColumns([
        "Total",
        formatNumber(result.result.subtotalCents),
        formatNumber(result.result.taxCents),
        formatNumber(result.result.taxCents),
      ]),
    );
  }

  return { text: lines.join("\n"), positiveLineIndices };
}

function renderRetailReceipt(example, rng) {
  const { result, lineTotals, invoiceId, documentDate, seller } = example;
  const positiveLineIndices = new Set();
  const taxPercent = Math.round(result.invoice.taxBasisPoints / 100);
  const halfTaxCents = Math.round(result.result.taxCents / 2);
  const lines = [
    maybeCorruptLabel("INVOICE", rng),
    `${seller.name}`,
    `Invoice #: ${invoiceId}`,
    `Date: ${documentDate}`,
    "Item  Qty  Rate  Amount",
  ];

  result.invoice.items.forEach((item, index) => {
    lines.push(
      joinColumns([
        item.label,
        formatQuantity(item.quantity),
        formatNumber(item.unitCents),
        formatNumber(lineTotals[index]),
      ]),
    );
  });

  lines.push(joinColumns(["Subtotal", formatNumber(result.result.subtotalCents)]));
  if (taxPercent > 0) {
    lines.push(joinColumns([`CGST ${taxPercent / 2}%`, formatNumber(halfTaxCents)]));
    lines.push(joinColumns([`SGST ${taxPercent / 2}%`, formatNumber(result.result.taxCents - halfTaxCents)]));
  }
  positiveLineIndices.add(lines.length);
  lines.push(joinColumns([maybeCorruptLabel("Grand Total", rng), `Rs. ${formatNumber(result.result.totalCents)}`]));
  lines.push(joinColumns(["Amount Paid", formatNumber(result.result.totalCents)]));

  return { text: lines.join("\n"), positiveLineIndices };
}

const TEMPLATES = [
  { id: "proforma", render: renderProformaReceipt },
  { id: "tax-invoice", render: renderTaxInvoiceReceipt },
  { id: "retail", render: renderRetailReceipt },
];

function generateReceiptExample(rng, receiptIndex) {
  const invoiceSource = buildInvoiceSource(rng);
  const result = runInvoicePsvm(invoiceSource);
  const lineTotals = extractLineTotals(result);
  const template = pick(TEMPLATES, rng);
  const seller = {
    name: pick(SELLER_NAMES, rng),
    gstin: makeGstin(rng),
  };
  const buyer = {
    name: pick(BUYER_NAMES, rng),
    gstin: makeGstin(rng),
    address: "Project site, Gujarat, India",
  };
  const invoiceId = formatInvoiceId(rng, template.id, receiptIndex);
  const documentDate = formatDate(rng);
  const rendered = template.render(
    {
      result,
      lineTotals,
      invoiceId,
      documentDate,
      seller,
      buyer,
    },
    rng,
  );

  const selection = runReceiptTotalPsvm(rendered.text);
  const samples = selection.state.candidates.map((candidate) => ({
    receiptId: `receipt-${receiptIndex + 1}`,
    templateId: template.id,
    candidateIndex: candidate.candidateIndex,
    amountText: candidate.amountText,
    amountCents: candidate.amountCents,
    lineIndex: candidate.lineIndex,
    lineText: candidate.lineText,
    context: candidate.context,
    label:
      rendered.positiveLineIndices.has(candidate.lineIndex) &&
      candidate.amountCents === result.result.totalCents
        ? 1
        : 0,
  }));

  if (!samples.some((sample) => sample.label === 1)) {
    throw new Error(`Synthetic receipt ${receiptIndex + 1} did not expose a positive total candidate.`);
  }

  return {
    receiptId: `receipt-${receiptIndex + 1}`,
    templateId: template.id,
    source: rendered.text,
    totalCents: result.result.totalCents,
    teacherTotalCents: selection.result.totalCents,
    teacherHit: selection.result.totalCents === result.result.totalCents,
    candidateCount: selection.state.candidates.length,
    samples,
  };
}

export function generateReceiptTotalDataset({ count, seed }) {
  const rng = mulberry32(seed);
  const receipts = [];
  const samples = [];

  for (let index = 0; index < count; index += 1) {
    const receipt = generateReceiptExample(rng, index);
    receipts.push({
      receiptId: receipt.receiptId,
      templateId: receipt.templateId,
      totalCents: receipt.totalCents,
      teacherHit: receipt.teacherHit,
      candidateCount: receipt.candidateCount,
      source: receipt.source,
    });
    samples.push(...receipt.samples);
  }

  const labelCounts = {
    NOT_TOTAL: samples.filter((sample) => sample.label === 0).length,
    TOTAL: samples.filter((sample) => sample.label === 1).length,
  };
  const teacherHitCount = receipts.filter((receipt) => receipt.teacherHit).length;

  return {
    generator: "invoice/export_total_dataset.mjs",
    receiptCount: receipts.length,
    sampleCount: samples.length,
    labelNames: LABEL_NAMES,
    labelCounts,
    teacherAccuracy: teacherHitCount / receipts.length,
    receipts,
    samples,
  };
}

function main() {
  const { output, count, seed } = parseArgs(process.argv.slice(2));
  const payload = generateReceiptTotalDataset({ count, seed });
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(payload, null, 2));
  console.log(
    `Wrote ${payload.sampleCount} receipt-total samples from ${payload.receiptCount} receipts to ${output} (teacher_accuracy=${payload.teacherAccuracy.toFixed(4)}).`,
  );
}

main();
