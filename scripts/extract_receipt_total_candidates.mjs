#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { parsePdftotextTsv } from "../invoice/ocr_layout.mjs";
import { runReceiptTotalPsvm } from "../invoice/total_psvm.mjs";

function printUsage() {
  console.error(
    "Usage: node scripts/extract_receipt_total_candidates.mjs [--json] <file.pdf|file.txt> [...]",
  );
}

function readSource(path) {
  const absolutePath = resolve(path);
  if (extname(absolutePath).toLowerCase() !== ".pdf") {
    return readFileSync(absolutePath, "utf8");
  }

  const result = spawnSync("pdftotext", ["-tsv", absolutePath, "-"], {
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

  return parsePdftotextTsv(result.stdout);
}

const argv = process.argv.slice(2);
const jsonMode = argv.includes("--json");
const inputs = argv.filter((value) => value !== "--json");

if (inputs.length === 0) {
  printUsage();
  process.exit(1);
}

const payload = inputs.map((inputPath) => {
  const source = readSource(inputPath);
  const result = runReceiptTotalPsvm(source);
  const teacherScoreByCandidateIndex = new Map(
    result.rankedCandidates.map((candidate) => [candidate.candidateIndex, candidate.score]),
  );
  return {
    inputPath: resolve(inputPath),
    documentType: result.state.documentType,
    program: result.program,
    teacherTotalText: result.result.totalText,
    teacherTotalCents: result.result.totalCents,
    selectedCandidateIndex: result.selectedCandidate.candidateIndex,
    topTeacherCandidates: result.rankedCandidates.slice(0, 5).map((candidate) => ({
      candidateIndex: candidate.candidateIndex,
      amountText: candidate.amountText,
      amountCents: candidate.amountCents,
      lineIndex: candidate.lineIndex,
      lineText: candidate.lineText,
      score: candidate.score,
    })),
    candidates: result.state.candidates.map((candidate) => ({
      candidateIndex: candidate.candidateIndex,
      amountText: candidate.amountText,
      amountCents: candidate.amountCents,
      lineIndex: candidate.lineIndex,
      pageIndex: candidate.pageIndex,
      lineText: candidate.lineText,
      context: candidate.context,
      score: teacherScoreByCandidateIndex.get(candidate.candidateIndex) ?? null,
      explicitTotalCue: candidate.explicitTotalCue,
      explicitCueBeforeAmount: candidate.explicitCueBeforeAmount,
      softTotalCue: candidate.softTotalCue,
      softTotalCueBeforeAmount: candidate.softTotalCueBeforeAmount,
      subtotalCue: candidate.subtotalCue,
      subtotalCueBeforeAmount: candidate.subtotalCueBeforeAmount,
      taxCue: candidate.taxCue,
      taxCueBeforeAmount: candidate.taxCueBeforeAmount,
      pageRightBucket: candidate.pageRightBucket,
      pageRightGapBucket: candidate.pageRightGapBucket,
      pageYBucket: candidate.pageYBucket,
      cueGapBucket: candidate.cueGapBucket,
      leftText: candidate.leftText,
      rightText: candidate.rightText,
    })),
  };
});

if (jsonMode) {
  console.log(JSON.stringify(payload, null, 2));
} else {
  for (const receipt of payload) {
    console.log(receipt.inputPath);
    console.log(
      `Teacher total: ${receipt.teacherTotalText} (${receipt.documentType}) from candidate #${receipt.selectedCandidateIndex}`,
    );
    for (const candidate of receipt.topTeacherCandidates) {
      console.log(
        `  #${candidate.candidateIndex} score=${candidate.score.toFixed(2)} amount=${candidate.amountText} line=${candidate.lineIndex + 1} ${candidate.lineText}`,
      );
    }
    console.log("");
  }
}
