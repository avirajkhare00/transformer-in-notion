import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { INVOICE_PSVM_OPS, runInvoicePsvm } from "./psvm.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_OUTPUT = resolve(__dirname, "training/invoice-op-dataset.json");
const DEFAULT_COUNT = 2500;
const DEFAULT_SEED = 17;

const LABEL_PREFIXES = [
  "Design",
  "QA",
  "Hosting",
  "Prototype",
  "Audit",
  "Support",
  "Research",
  "Migration",
  "Launch",
  "Sprint",
];

const LABEL_SUFFIXES = [
  "Block",
  "Pass",
  "Review",
  "Bundle",
  "Retainer",
  "Run",
  "Package",
  "Setup",
  "Sweep",
  "Session",
];

const TAX_RATES = [0, 0.05, 0.0825, 0.1, 0.125];

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

function randomInt(rng, min, maxInclusive) {
  return Math.floor(rng() * (maxInclusive - min + 1)) + min;
}

function pick(rng, values) {
  return values[randomInt(rng, 0, values.length - 1)];
}

function makeLabel(rng) {
  return `${pick(rng, LABEL_PREFIXES)} ${pick(rng, LABEL_SUFFIXES)}`;
}

function makeUnitPrice(rng) {
  const cents = randomInt(rng, 1800, 45000);
  return (cents / 100).toFixed(2);
}

function makeInvoiceSource(rng) {
  const itemCount = randomInt(rng, 1, 5);
  const items = [];

  for (let index = 0; index < itemCount; index += 1) {
    items.push({
      label: makeLabel(rng),
      quantity: randomInt(rng, 1, 6),
      unitPrice: makeUnitPrice(rng),
    });
  }

  return JSON.stringify(
    {
      currency: "USD",
      taxRate: pick(rng, TAX_RATES),
      items,
    },
    null,
    2,
  );
}

function buildHistoryTokens(trace, upToIndex) {
  if (upToIndex === 0) {
    return ["NONE"];
  }
  return trace.slice(0, upToIndex).map((event) => event.op);
}

function buildContext(result, traceIndex) {
  const previousSnapshot =
    traceIndex === 0
      ? { processedItems: 0, subtotalCents: 0, taxCents: 0, totalCents: 0 }
      : result.trace[traceIndex - 1].snapshot;

  const tokens = [
    "currency_USD",
    `items_${result.invoice.items.length}`,
    `taxbp_${result.invoice.taxBasisPoints}`,
    `processed_${previousSnapshot.processedItems}`,
    `subtotal_${previousSnapshot.subtotalCents}`,
    `tax_${previousSnapshot.taxCents}`,
    `total_${previousSnapshot.totalCents}`,
    "history",
    ...buildHistoryTokens(result.trace, traceIndex),
  ];

  return tokens.join(" ");
}

function buildSamples(result) {
  return result.trace.map((event, traceIndex) => {
    const label = INVOICE_PSVM_OPS.indexOf(event.op);
    if (label < 0) {
      throw new Error(`Unknown op in trace: ${event.op}`);
    }

    return {
      context: buildContext(result, traceIndex),
      nextOp: event.op,
      label,
      traceIndex,
      itemCount: result.invoice.items.length,
      taxBasisPoints: result.invoice.taxBasisPoints,
      source: JSON.stringify(
        {
          currency: result.invoice.currency,
          items: result.invoice.items.length,
        },
      ),
    };
  });
}

function summarizeLabels(samples) {
  const counts = Object.fromEntries(INVOICE_PSVM_OPS.map((op) => [op, 0]));
  for (const sample of samples) {
    counts[sample.nextOp] += 1;
  }
  return counts;
}

function main() {
  const { output, count, seed } = parseArgs(process.argv.slice(2));
  const rng = mulberry32(seed);
  const samples = [];

  for (let index = 0; index < count; index += 1) {
    const source = makeInvoiceSource(rng);
    const result = runInvoicePsvm(source);
    samples.push(...buildSamples(result));
  }

  const payload = {
    generator: "invoice/export_dataset.mjs",
    invoiceCount: count,
    sampleCount: samples.length,
    opLabels: INVOICE_PSVM_OPS,
    labelCounts: summarizeLabels(samples),
    samples,
  };

  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(payload, null, 2));
  console.log(`Wrote ${samples.length} invoice-op samples from ${count} invoices to ${output}.`);
}

main();
