import assert from "node:assert/strict";
import test from "node:test";

import {
  TALLY_HARNESS_FAILURE_CLASSES,
  buildTallyAdversarialHarness,
  evaluateTallyAdversarialHarness,
  evaluateTallyHarnessCase,
} from "./harness.mjs";

test("adversarial harness covers every failure class with deterministic cases", () => {
  const cases = buildTallyAdversarialHarness({ seed: 31, includeBaseline: true });
  const classCounts = new Map();

  for (const harnessCase of cases) {
    classCounts.set(harnessCase.failureClass, (classCounts.get(harnessCase.failureClass) ?? 0) + 1);
  }

  for (const failureClass of Object.keys(TALLY_HARNESS_FAILURE_CLASSES)) {
    assert.ok(
      classCounts.get(failureClass) > 0,
      `expected failure class ${failureClass} to be present in the harness`,
    );
  }

  assert.ok(cases.length >= 14);
});

test("baseline harness controls still evaluate as supported with field recall", () => {
  const cases = buildTallyAdversarialHarness({ seed: 31, includeBaseline: true });
  const baselineTax = cases.find((entry) => entry.id === "baseline-tax-invoice-core");
  assert.ok(baselineTax);

  const report = evaluateTallyHarnessCase(baselineTax);
  assert.equal(report.supportMatch, true);
  assert.equal(report.familyMatch, true);
  assert.equal(report.scalarSummary.candidateRecall.rate, 1);
  assert.equal(report.lineItemSummary.candidateRecall.rate, 1);
});

test("implicit-field harness case keeps the weak-label values in the legal candidate set", () => {
  const cases = buildTallyAdversarialHarness({ seed: 31, includeBaseline: true });
  const implicitCase = cases.find((entry) => entry.id === "implicit-field-shorthand-sales");
  assert.ok(implicitCase);

  const report = evaluateTallyHarnessCase(implicitCase);
  assert.equal(report.familyMatch, true);
  assert.equal(report.scalarSummary.candidateRecall.rate, 1);
  assert.equal(report.lineItemSummary.candidateRecall.rate, 1);
});

test("harness evaluation returns aggregate metrics by failure class", () => {
  const evaluation = evaluateTallyAdversarialHarness({ seed: 31, includeBaseline: true });

  assert.ok(evaluation.summary.caseCount >= 14);
  assert.ok("candidate_missing" in evaluation.summary.byFailureClass);
  assert.ok("implicit_field" in evaluation.summary.byFailureClass);
  assert.ok("ocr_corruption" in evaluation.summary.byFailureClass);
  assert.ok("layout_drift" in evaluation.summary.byFailureClass);
  assert.ok(typeof evaluation.summary.byFailureClass.candidate_missing.scalarCandidateRecall === "number");
  assert.ok(Array.isArray(evaluation.caseReports));
});
