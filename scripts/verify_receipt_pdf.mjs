#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extname, resolve } from "node:path";

import {
  formatReceiptVerificationReport,
  parseReceiptText,
  verifyReceipt,
} from "../invoice/receipt.mjs";

function printUsage() {
  console.error("Usage: node scripts/verify_receipt_pdf.mjs [--json] <file.pdf|file.txt> [...]");
}

function readSource(path) {
  const absolutePath = resolve(path);
  if (extname(absolutePath).toLowerCase() !== ".pdf") {
    return readFileSync(absolutePath, "utf8");
  }

  const result = spawnSync("pdftotext", ["-layout", absolutePath, "-"], {
    encoding: "utf8",
  });
  if (result.error) {
    if (result.error.code === "ENOENT") {
      throw new Error("pdftotext is required in PATH to parse PDFs.");
    }
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `pdftotext failed for ${absolutePath}.`);
  }

  return result.stdout;
}

const args = process.argv.slice(2);
const jsonMode = args.includes("--json");
const inputs = args.filter((arg) => arg !== "--json");

if (inputs.length === 0) {
  printUsage();
  process.exit(1);
}

const reports = inputs.map((inputPath) => {
  const source = readSource(inputPath);
  const receipt = parseReceiptText(source);
  const report = verifyReceipt(receipt);
  return {
    inputPath: resolve(inputPath),
    ...report,
  };
});

if (jsonMode) {
  console.log(JSON.stringify(reports, null, 2));
} else {
  for (const report of reports) {
    console.log(report.inputPath);
    console.log(formatReceiptVerificationReport(report));
    console.log("");
  }
}

if (reports.some((report) => !report.ok)) {
  process.exitCode = 1;
}
