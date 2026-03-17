import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runInvoicePsvm } from "../invoice/psvm.mjs";
import { TALLY_DEMO_PRESETS } from "./demo-samples.mjs";
import { buildTallyExtractionState } from "./psvm.mjs";
import {
  TALLY_FIELD_SELECTOR_LABELS,
  buildTallyFieldModelExamples,
  tallyFieldValueMatches,
} from "./model-common.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_OUTPUT = resolve(__dirname, "training/tally-field-dataset.json");
const DEFAULT_COUNT = 2000;
const DEFAULT_SEED = 29;

const SELLER_NAMES = [
  "JAYRAJ SOLAR LLP",
  "Zodiac Energy Ltd",
  "Nimoto Solar Pvt Ltd",
  "Helio Grid Systems LLP",
  "Aster Buildtech Pvt Ltd",
  "Vertex Power Solutions Pvt Ltd",
];
const BUYER_NAMES = [
  "Nimoto Solar Pvt Ltd",
  "Suncrest Projects Private Limited",
  "Bluebeam Power Solutions Pvt Ltd",
  "Vihan Infra Projects Pvt Ltd",
  "Crestline Warehousing Limited",
  "Orchid Meditech LLP",
];
const STATE_NAMES = [
  "Maharashtra",
  "Gujarat",
  "Karnataka",
  "Rajasthan",
  "Madhya Pradesh",
  "Tamil Nadu",
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
const FAMILY_IDS = ["sales_invoice", "purchase_invoice", "proforma_invoice", "credit_note", "debit_note"];
const SEED_PRESET_REPEATS = 12;
const SEED_PRESET_EXPECTED = Object.freeze({
  "tax-invoice-core": {
    familyId: "sales_invoice",
    fields: {
      "document.number": "29",
      "document.date": "23-May-25",
      "document.currency": "INR",
      "document.place_of_supply": "Maharashtra",
      "seller.name": "JAYRAJ SOLAR LLP",
      "seller.gstin": "24AAMFJ7876R1Z8",
      "buyer.name": "Nimoto Solar Pvt Ltd",
      "buyer.gstin": "27AADCN3773B1ZM",
      "consignee.name": "Nimoto Solar Pvt Ltd",
      "consignee.gstin": "27AADCN3773B1ZM",
      "amounts.grand_total_cents": 47200000,
      "taxes.igst_cents": 7200000,
    },
  },
  "proforma-core": {
    familyId: "proforma_invoice",
    fields: {
      "document.number": "PI-0272/23-24",
      "document.date": "30/10/2023",
      "document.currency": "INR",
      "seller.name": "Zodiac Energy Ltd",
      "seller.gstin": "24AAACZ1284C1ZN",
      "buyer.name": "JAYRAJ SOLAR LLP",
      "buyer.gstin": "24AAMFJ7876R1Z8",
      "amounts.taxable_amount_cents": 14800000,
      "amounts.subtotal_cents": 16576000,
      "amounts.round_off_cents": 0,
      "amounts.grand_total_cents": 16576000,
    },
  },
});

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

function buildInvoiceSource(rng, taxRate) {
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
      taxRate,
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

function maybeUppercase(value, rng) {
  return rng() < 0.25 ? value.toUpperCase() : value;
}

function maybeCorruptLabel(label, rng) {
  let value = maybeUppercase(label, rng);
  if (rng() < 0.12) {
    value = value.replace(/O/g, "0");
  }
  return value;
}

function joinColumns(columns) {
  return columns.filter(Boolean).join("  ");
}

function buildDocumentNumber(familyId, rng, index) {
  const serial = String(index + 1).padStart(4, "0");
  switch (familyId) {
    case "proforma_invoice":
      return `PI-${serial}/${randomInt(23, 26, rng)}-${randomInt(24, 27, rng)}`;
    case "credit_note":
      return `CN/${randomInt(2024, 2026, rng)}/${serial}`;
    case "debit_note":
      return `DN/${randomInt(2024, 2026, rng)}/${serial}`;
    case "purchase_invoice":
      return `PUR/${randomInt(2024, 2026, rng)}/${serial}`;
    default:
      return `INV/${randomInt(2024, 2026, rng)}/${serial}`;
  }
}

function buildOptionalReferences(rng) {
  return {
    purchaseOrderNumber: rng() < 0.45 ? `PO-${randomInt(1000, 9999, rng)}` : null,
    referenceNumber: rng() < 0.35 ? `REF-${randomInt(100, 999, rng)}` : null,
    eWayBillNumber: rng() < 0.3 ? String(randomInt(100000000000, 999999999999, rng)) : null,
  };
}

function buildParties(rng) {
  const sellerName = pick(SELLER_NAMES, rng);
  let buyerName = pick(BUYER_NAMES, rng);
  while (buyerName === sellerName) {
    buyerName = pick(BUYER_NAMES, rng);
  }

  return {
    seller: {
      name: sellerName,
      gstin: makeGstin(rng),
      address: `${randomInt(10, 999, rng)}, Industrial Estate, ${pick(STATE_NAMES, rng)}`,
    },
    buyer: {
      name: buyerName,
      gstin: makeGstin(rng),
      address: `${randomInt(10, 999, rng)}, Business Park, ${pick(STATE_NAMES, rng)}`,
    },
  };
}

function buildExpectedFields(payload) {
  const expected = {
    "document.number": payload.document.number,
    "document.date": payload.document.date,
    "document.currency": "INR",
    "seller.name": payload.seller.name,
    "seller.gstin": payload.seller.gstin,
    "buyer.name": payload.buyer.name,
    "buyer.gstin": payload.buyer.gstin,
    "amounts.taxable_amount_cents": payload.amounts.taxableAmountCents,
    "amounts.round_off_cents": payload.amounts.roundOffCents,
    "amounts.grand_total_cents": payload.amounts.grandTotalCents,
  };

  if (payload.document.placeOfSupply) {
    expected["document.place_of_supply"] = payload.document.placeOfSupply;
  }
  if (payload.document.purchaseOrderNumber) {
    expected["document.purchase_order_number"] = payload.document.purchaseOrderNumber;
  }
  if (payload.document.referenceNumber) {
    expected["document.reference_number"] = payload.document.referenceNumber;
  }
  if (payload.document.eWayBillNumber) {
    expected["document.e_way_bill_number"] = payload.document.eWayBillNumber;
  }
  if (payload.consignee?.name) {
    expected["consignee.name"] = payload.consignee.name;
  }
  if (payload.consignee?.gstin) {
    expected["consignee.gstin"] = payload.consignee.gstin;
  }
  if (payload.amounts.subtotalCents != null) {
    expected["amounts.subtotal_cents"] = payload.amounts.subtotalCents;
  }
  if (payload.amounts.discountCents != null) {
    expected["amounts.discount_cents"] = payload.amounts.discountCents;
  }
  if (payload.taxes.igstCents != null) {
    expected["taxes.igst_cents"] = payload.taxes.igstCents;
  }
  if (payload.taxes.cgstCents != null) {
    expected["taxes.cgst_cents"] = payload.taxes.cgstCents;
  }
  if (payload.taxes.sgstCents != null) {
    expected["taxes.sgst_cents"] = payload.taxes.sgstCents;
  }
  if (payload.taxes.cessCents != null) {
    expected["taxes.cess_cents"] = payload.taxes.cessCents;
  }

  return expected;
}

function renderCommonPartyBlocks(lines, parties, options = {}) {
  lines.push(options.sellerHeading ?? "Supplier (From)");
  lines.push(parties.seller.name);
  lines.push(parties.seller.address);
  lines.push(`GSTIN/UIN: ${parties.seller.gstin}`);

  if (options.includeConsignee) {
    lines.push("Consignee (Ship to)");
    lines.push(parties.buyer.name);
    lines.push(`GSTIN/UIN: ${parties.buyer.gstin}`);
  }

  lines.push(options.buyerHeading ?? "Buyer (Bill to)");
  lines.push(parties.buyer.name);
  lines.push(parties.buyer.address);
  lines.push(`GSTIN/UIN: ${parties.buyer.gstin}`);
}

function renderLineItems(lines, invoiceResult, lineTotals) {
  lines.push("Sl  Description of Goods  Qty  Unit Rate  Amount");
  invoiceResult.invoice.items.forEach((item, index) => {
    lines.push(
      joinColumns([
        String(index + 1),
        item.label,
        formatQuantity(item.quantity),
        item.unit ?? "",
        formatNumber(item.unitCents),
        formatNumber(lineTotals[index]),
      ]),
    );
  });
}

function renderDocument(example, rng) {
  const { familyId, documentNumber, documentDate, parties, invoiceResult, lineTotals } = example;
  const header = [];
  const lines = [];
  const taxPercent = Math.round(invoiceResult.invoice.taxBasisPoints / 100);
  const references = example.references;

  if (familyId === "proforma_invoice") {
    header.push("PROFORMA INVOICE");
    header.push(joinColumns([parties.buyer.name, `PI No: ${documentNumber}`, `Date : ${documentDate}`]));
    lines.push(...header);
    lines.push(parties.buyer.address);
    lines.push(`GST No. ${parties.buyer.gstin}`);
    lines.push("PAYMENT TERM:- 100% Advance");
    renderLineItems(lines, invoiceResult, lineTotals);
    lines.push(joinColumns(["TAXABLE", formatNumber(example.amounts.taxableAmountCents)]));
    lines.push(joinColumns([`GST @ ${taxPercent}%`, formatNumber(invoiceResult.result.taxCents)]));
    lines.push(joinColumns(["Sub Total", formatNumber(example.amounts.subtotalCents)]));
    lines.push(joinColumns(["Round Off (+/-)", formatNumber(example.amounts.roundOffCents)]));
    lines.push(
      joinColumns([maybeCorruptLabel("TOTAL", rng), formatNumber(example.amounts.grandTotalCents)]),
    );
    lines.push(`GST No. ${parties.seller.gstin}`);
    lines.push(parties.seller.name);
    return lines.join("\n");
  }

  if (familyId === "purchase_invoice") {
    header.push("PURCHASE INVOICE");
  } else if (familyId === "credit_note") {
    header.push("CREDIT NOTE");
  } else if (familyId === "debit_note") {
    header.push("DEBIT NOTE");
  } else {
    header.push("TAX INVOICE");
  }

  header.push(
    joinColumns([
      parties.seller.name,
      `${familyId === "sales_invoice" ? "Invoice" : "Voucher"} No. ${documentNumber}`,
      `Dated ${documentDate}`,
    ]),
  );
  lines.push(...header);
  renderCommonPartyBlocks(lines, parties, {
    includeConsignee: example.consignee != null,
    sellerHeading: familyId === "purchase_invoice" ? "Supplier" : "Supplier (From)",
    buyerHeading: familyId === "purchase_invoice" ? "Buyer" : "Buyer (Bill to)",
  });

  if (example.document.placeOfSupply) {
    lines.push(`Place of Supply : ${example.document.placeOfSupply}`);
  }
  if (references.purchaseOrderNumber) {
    lines.push(`PO No. : ${references.purchaseOrderNumber}`);
  }
  if (references.referenceNumber) {
    lines.push(`Reference : ${references.referenceNumber}`);
  }
  if (references.eWayBillNumber) {
    lines.push(`E-Way Bill : ${references.eWayBillNumber}`);
  }

  renderLineItems(lines, invoiceResult, lineTotals);

  if (example.amounts.discountCents != null) {
    lines.push(joinColumns(["Discount", formatNumber(example.amounts.discountCents)]));
  }
  lines.push(joinColumns(["Taxable Value", formatNumber(example.amounts.taxableAmountCents)]));
  if (example.taxes.igstCents != null) {
    lines.push(joinColumns(["IGST", formatNumber(example.taxes.igstCents)]));
  }
  if (example.taxes.cgstCents != null) {
    lines.push(joinColumns(["CGST", formatNumber(example.taxes.cgstCents)]));
  }
  if (example.taxes.sgstCents != null) {
    lines.push(joinColumns(["SGST", formatNumber(example.taxes.sgstCents)]));
  }
  if (example.amounts.roundOffCents != null) {
    lines.push(joinColumns(["Round Off", formatNumber(example.amounts.roundOffCents)]));
  }
  lines.push(
    joinColumns([maybeCorruptLabel("Total", rng), `Rs. ${formatNumber(example.amounts.grandTotalCents)}`]),
  );
  return lines.join("\n");
}

function buildSyntheticExample(rng, index) {
  const familyId = pick(FAMILY_IDS, rng);
  const documentNumber = buildDocumentNumber(familyId, rng, index);
  const documentDate = formatDate(rng);
  const parties = buildParties(rng);
  const references = buildOptionalReferences(rng);
  const placeOfSupply = rng() < 0.75 ? pick(STATE_NAMES, rng) : null;
  const taxRate = pick([0.05, 0.12, 0.18], rng);
  const invoiceSource = buildInvoiceSource(rng, taxRate);
  const invoiceResult = runInvoicePsvm(invoiceSource);
  const lineTotals = extractLineTotals(invoiceResult);
  const taxableAmountCents = invoiceResult.result.subtotalCents;
  const discountCents = rng() < 0.3 ? randomInt(0, Math.floor(taxableAmountCents * 0.05), rng) : null;
  const taxBaseCents = discountCents != null ? taxableAmountCents - discountCents : taxableAmountCents;
  const taxCents = Math.round((taxBaseCents * invoiceResult.invoice.taxBasisPoints) / 10000);
  const roundOffCents = rng() < 0.5 ? randomInt(0, 100, rng) : 0;
  const subtotalCents = familyId === "proforma_invoice" ? taxBaseCents + taxCents : null;
  const grandTotalCents = taxBaseCents + taxCents + roundOffCents;
  const splitTax = familyId !== "proforma_invoice" && rng() < 0.45;
  const igstCents = familyId === "proforma_invoice" || !splitTax ? taxCents : null;
  const cgstCents = splitTax ? Math.floor(taxCents / 2) : null;
  const sgstCents = splitTax ? taxCents - cgstCents : null;
  const consignee = rng() < 0.35 ? { ...parties.buyer } : null;

  const example = {
    id: `doc-${index + 1}`,
    familyId,
    document: {
      number: documentNumber,
      date: documentDate,
      placeOfSupply,
      purchaseOrderNumber: references.purchaseOrderNumber,
      referenceNumber: references.referenceNumber,
      eWayBillNumber: references.eWayBillNumber,
    },
    parties,
    seller: parties.seller,
    buyer: parties.buyer,
    consignee,
    amounts: {
      taxableAmountCents: taxBaseCents,
      subtotalCents,
      discountCents,
      roundOffCents,
      grandTotalCents,
    },
    taxes: {
      igstCents,
      cgstCents,
      sgstCents,
      cessCents: null,
    },
    references,
    invoiceResult,
    lineTotals,
  };

  return {
    ...example,
    text: renderDocument(example, rng),
    expectedFields: buildExpectedFields(example),
  };
}

function exportDataset(count, seed) {
  const rng = mulberry32(seed);
  const samples = [];
  let positiveGroups = 0;
  let skippedGroups = 0;
  let documentCount = 0;

  function addDocumentSamples(documentId, familyId, text, expectedFields) {
    const state = buildTallyExtractionState(text, { voucherFamily: familyId });
    const modelExamples = buildTallyFieldModelExamples(state);
    const grouped = new Map();

    for (const modelExample of modelExamples) {
      const entries = grouped.get(modelExample.fieldId) ?? [];
      entries.push(modelExample);
      grouped.set(modelExample.fieldId, entries);
    }

    for (const [fieldId, fieldExamples] of grouped.entries()) {
      const expectedValue = expectedFields[fieldId];
      if (expectedValue === undefined || expectedValue === null) {
        continue;
      }

      const positives = fieldExamples.filter((fieldExample) =>
        tallyFieldValueMatches(fieldId, fieldExample.candidate.value, expectedValue),
      );
      if (positives.length === 0) {
        skippedGroups += 1;
        continue;
      }

      positiveGroups += 1;
      fieldExamples.forEach((fieldExample) => {
        const selected = tallyFieldValueMatches(fieldId, fieldExample.candidate.value, expectedValue);
        samples.push({
          documentId,
          groupId: `${documentId}:${fieldId}`,
          fieldId,
          familyId,
          context: fieldExample.context,
          label: selected ? 1 : 0,
        });
      });
    }

    documentCount += 1;
  }

  for (let index = 0; index < count; index += 1) {
    const example = buildSyntheticExample(rng, index);
    addDocumentSamples(example.id, example.familyId, example.text, example.expectedFields);
  }

  for (const preset of TALLY_DEMO_PRESETS) {
    const expected = SEED_PRESET_EXPECTED[preset.id];
    if (!expected) {
      continue;
    }

    for (let repeat = 0; repeat < SEED_PRESET_REPEATS; repeat += 1) {
      addDocumentSamples(
        `seed-${preset.id}-${repeat + 1}`,
        expected.familyId,
        preset.source,
        expected.fields,
      );
    }
  }

  return {
    labelNames: [...TALLY_FIELD_SELECTOR_LABELS],
    samples,
    stats: {
      documentCount,
      positiveGroups,
      skippedGroups,
      sampleCount: samples.length,
    },
  };
}

function main() {
  const { output, count, seed } = parseArgs(process.argv.slice(2));
  const dataset = exportDataset(count, seed);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(dataset, null, 2));
  console.log(
    `Wrote ${dataset.stats.sampleCount} samples across ${dataset.stats.positiveGroups} field groups to ${output}`,
  );
}

main();
