#!/usr/bin/env node

import { evaluateTallyAdversarialHarness } from "../tally/harness.mjs";

function parseArgs(argv) {
  const options = {
    includeBaseline: true,
    json: false,
    seed: 31,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--no-baseline") {
      options.includeBaseline = false;
      continue;
    }
    if (arg === "--seed" && argv[index + 1]) {
      options.seed = Number(argv[index + 1]);
      index += 1;
      continue;
    }
  }

  if (!Number.isInteger(options.seed)) {
    throw new Error("--seed must be an integer.");
  }

  return options;
}

function formatPercent(value) {
  return value == null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

function printSummary(summary) {
  console.log("Tally adversarial harness");
  console.log(`cases: ${summary.caseCount}`);
  console.log(`support accuracy: ${formatPercent(summary.supportAccuracy)}`);
  console.log(`family accuracy: ${formatPercent(summary.familyAccuracy)}`);
  console.log(`scalar candidate recall: ${formatPercent(summary.scalarCandidateRecall)}`);
  console.log(`scalar top-1 accuracy: ${formatPercent(summary.scalarTop1Accuracy)}`);
  console.log(`scalar instability rate: ${formatPercent(summary.instabilityRate)}`);
  console.log(`line-item candidate recall: ${formatPercent(summary.lineItemCandidateRecall)}`);
  console.log(`line-item record accuracy: ${formatPercent(summary.lineItemRecordAccuracy)}`);
  console.log("");
  console.log("By failure class");

  for (const failureClass of Object.keys(summary.byFailureClass).sort()) {
    const entry = summary.byFailureClass[failureClass];
    console.log(
      `${failureClass}: cases=${entry.caseCount} ` +
        `support=${formatPercent(entry.supportAccuracy)} ` +
        `family=${formatPercent(entry.familyAccuracy)} ` +
        `scalar_recall=${formatPercent(entry.scalarCandidateRecall)} ` +
        `scalar_top1=${formatPercent(entry.scalarTop1Accuracy)} ` +
        `instability=${formatPercent(entry.instabilityRate)} ` +
        `line_recall=${formatPercent(entry.lineItemCandidateRecall)} ` +
        `line_record=${formatPercent(entry.lineItemRecordAccuracy)}`,
    );
  }
}

function printCaseHighlights(caseReports) {
  const interesting = caseReports.filter(
    (report) =>
      !report.familyMatch ||
      !report.supportMatch ||
      report.scalarReports.some((entry) => !entry.candidateFound || !entry.selectedMatch) ||
      report.lineItemReports.some((entry) => !entry.candidateFound || !entry.recordMatch),
  );

  if (interesting.length === 0) {
    console.log("");
    console.log("No failing cases in this harness run.");
    return;
  }

  console.log("");
  console.log("Interesting cases");

  for (const report of interesting) {
    const missingScalars = report.scalarReports
      .filter((entry) => !entry.candidateFound)
      .map((entry) => entry.fieldId);
    const wrongScalars = report.scalarReports
      .filter((entry) => entry.candidateFound && !entry.selectedMatch)
      .map((entry) => entry.fieldId);
    const missingLineFields = report.lineItemReports
      .filter((entry) => !entry.candidateFound)
      .map((entry) => `${entry.itemIndex}:${entry.recordKey}`);
    const wrongLineFields = report.lineItemReports
      .filter((entry) => entry.candidateFound && !entry.recordMatch)
      .map((entry) => `${entry.itemIndex}:${entry.recordKey}`);

    console.log(
      `- ${report.id} ` +
        `[${report.failureClass}] ` +
        `family=${report.actualVoucherFamily} ` +
        `support=${report.actualSupport ? "yes" : "no"}`,
    );
    if (missingScalars.length > 0) {
      console.log(`  missing scalar candidates: ${missingScalars.join(", ")}`);
    }
    if (wrongScalars.length > 0) {
      console.log(`  wrong scalar top-1: ${wrongScalars.join(", ")}`);
    }
    if (missingLineFields.length > 0) {
      console.log(`  missing line-item candidates: ${missingLineFields.join(", ")}`);
    }
    if (wrongLineFields.length > 0) {
      console.log(`  wrong line-item values: ${wrongLineFields.join(", ")}`);
    }
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const evaluation = evaluateTallyAdversarialHarness(options);

  if (options.json) {
    console.log(JSON.stringify(evaluation, null, 2));
    return;
  }

  printSummary(evaluation.summary);
  printCaseHighlights(evaluation.caseReports);
}

main();

