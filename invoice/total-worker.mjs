import { parsePdftotextTsv } from "./ocr_layout.mjs";
import {
  buildReceiptTotalProgram,
  buildReceiptTotalState,
  rankReceiptTotalCandidates,
  runReceiptTotalPsvm,
} from "./total_psvm.mjs";
import {
  predictReceiptTotalCandidates,
  warmReceiptTotalModel,
} from "./total-model.mjs";

const TSV_HEADER =
  "level\tpage_num\tpar_num\tblock_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext";

function detectFormat(source, requestedFormat) {
  if (requestedFormat === "text" || requestedFormat === "tsv") {
    return requestedFormat;
  }

  const trimmed = String(source ?? "").trimStart();
  return trimmed.startsWith(TSV_HEADER) ? "tsv" : "text";
}

function parseSource(source, format) {
  if (format === "tsv") {
    return parsePdftotextTsv(source);
  }
  return String(source ?? "");
}

async function resolveEngine(requestedEngine) {
  if (requestedEngine === "teacher") {
    return "teacher";
  }

  await warmReceiptTotalModel();
  return "model";
}

function formatTraceLine(step, engine) {
  switch (step.op) {
    case "EXTRACT_AMOUNTS":
      return `EXTRACT_AMOUNTS -> ${step.candidateCount} legal money spans`;
    case "RANK_TOTAL_BRANCHES":
      return `${engine === "model" ? "RANK_TOTAL_BRANCHES (model)" : "RANK_TOTAL_BRANCHES (teacher)"} -> ${step.topCandidates
        .map((candidate) => {
          const score =
            engine === "model"
              ? `${(candidate.modelScore * 100).toFixed(1)}%`
              : candidate.teacherScore.toFixed(2);
          return `#${candidate.candidateIndex} ${candidate.amountText} ${score}`;
        })
        .join(" · ")}`;
    case "EMIT_TOTAL":
      return `EMIT_TOTAL -> ${step.amountText}`;
    case "HALT":
      return "HALT";
    default:
      return step.op;
  }
}

function serializeCandidate(candidate) {
  return {
    candidateIndex: candidate.candidateIndex,
    amountText: candidate.amountText,
    amountCents: candidate.amountCents,
    amountRank: candidate.amountRank,
    lineIndex: candidate.lineIndex,
    pageIndex: candidate.pageIndex,
    lineText: candidate.lineText,
    leftText: candidate.leftText,
    rightText: candidate.rightText,
    context: candidate.context,
    teacherScore: candidate.teacherScore ?? null,
    modelScore: candidate.modelScore ?? null,
    notTotalScore: candidate.notTotalScore ?? null,
    pageRightBucket: candidate.pageRightBucket,
    pageRightGapBucket: candidate.pageRightGapBucket,
    pageYBucket: candidate.pageYBucket,
    cueGapBucket: candidate.cueGapBucket,
    explicitTotalCue: candidate.explicitTotalCue,
    explicitCueBeforeAmount: candidate.explicitCueBeforeAmount,
    softTotalCue: candidate.softTotalCue,
    softTotalCueBeforeAmount: candidate.softTotalCueBeforeAmount,
    subtotalCue: candidate.subtotalCue,
    subtotalCueBeforeAmount: candidate.subtotalCueBeforeAmount,
    taxCue: candidate.taxCue,
    taxCueBeforeAmount: candidate.taxCueBeforeAmount,
    lineItemCue: candidate.lineItemCue,
    metadataCue: candidate.metadataCue,
  };
}

function buildTeacherPayload(parsedSource) {
  const execution = runReceiptTotalPsvm(parsedSource);
  const rankedCandidates = execution.rankedCandidates.map((candidate) => ({
    ...candidate,
    teacherScore: candidate.score,
    modelScore: null,
    notTotalScore: null,
  }));
  const selectedCandidate = rankedCandidates[0];
  return {
    engine: "teacher",
    program: execution.program,
    state: execution.state,
    result: execution.result,
    selectedCandidate,
    teacherSelectedCandidate: selectedCandidate,
    rankedCandidates,
    trace: [
      {
        op: "EXTRACT_AMOUNTS",
        candidateCount: execution.state.candidates.length,
      },
      {
        op: "RANK_TOTAL_BRANCHES",
        topCandidates: rankedCandidates.slice(0, 5).map((candidate) => ({
          candidateIndex: candidate.candidateIndex,
          amountText: candidate.amountText,
          teacherScore: candidate.teacherScore,
        })),
      },
      {
        op: "EMIT_TOTAL",
        amountText: selectedCandidate.amountText,
      },
      {
        op: "HALT",
      },
    ],
    modelStats: {
      predictionCount: 0,
      topScore: null,
      runnerUpScore: null,
      scoreMargin: null,
      matchesTeacher: true,
    },
  };
}

async function buildModelPayload(parsedSource) {
  const state = buildReceiptTotalState(parsedSource);
  const teacherRanked = rankReceiptTotalCandidates(state);
  const teacherScoreByCandidateIndex = new Map(
    teacherRanked.map((candidate) => [candidate.candidateIndex, candidate.score]),
  );
  const teacherSelectedCandidate = {
    ...teacherRanked[0],
    teacherScore: teacherRanked[0]?.score ?? null,
  };
  const predictions = await predictReceiptTotalCandidates(
    state.candidates.map((candidate) => candidate.context),
  );

  const rankedCandidates = state.candidates
    .map((candidate, index) => ({
      ...candidate,
      teacherScore: teacherScoreByCandidateIndex.get(candidate.candidateIndex) ?? null,
      modelScore: predictions[index]?.totalScore ?? 0,
      notTotalScore: predictions[index]?.notTotalScore ?? 0,
    }))
    .sort((left, right) => {
      if (right.modelScore !== left.modelScore) {
        return right.modelScore - left.modelScore;
      }
      if (right.amountCents !== left.amountCents) {
        return right.amountCents - left.amountCents;
      }
      if (right.lineIndex !== left.lineIndex) {
        return right.lineIndex - left.lineIndex;
      }
      return right.candidateIndex - left.candidateIndex;
    });

  const selectedCandidate = rankedCandidates[0];
  const runnerUp = rankedCandidates[1] ?? null;

  return {
    engine: "model",
    program: buildReceiptTotalProgram(state),
    state,
    result: {
      totalText: selectedCandidate.amountText,
      totalCents: selectedCandidate.amountCents,
    },
    selectedCandidate,
    teacherSelectedCandidate,
    rankedCandidates,
    trace: [
      {
        op: "EXTRACT_AMOUNTS",
        candidateCount: state.candidates.length,
      },
      {
        op: "RANK_TOTAL_BRANCHES",
        topCandidates: rankedCandidates.slice(0, 5).map((candidate) => ({
          candidateIndex: candidate.candidateIndex,
          amountText: candidate.amountText,
          modelScore: candidate.modelScore,
          teacherScore: candidate.teacherScore,
        })),
      },
      {
        op: "EMIT_TOTAL",
        amountText: selectedCandidate.amountText,
      },
      {
        op: "HALT",
      },
    ],
    modelStats: {
      predictionCount: state.candidates.length,
      topScore: selectedCandidate.modelScore,
      runnerUpScore: runnerUp?.modelScore ?? null,
      scoreMargin:
        runnerUp && typeof selectedCandidate.modelScore === "number"
          ? selectedCandidate.modelScore - runnerUp.modelScore
          : null,
      matchesTeacher:
        selectedCandidate.candidateIndex === teacherSelectedCandidate?.candidateIndex,
    },
  };
}

async function handleRun(data) {
  const startedAt = performance.now();

  try {
    const source = String(data.source ?? "");
    if (!source.trim()) {
      throw new Error("Paste OCR text or pdftotext TSV before running the demo.");
    }

    const format = detectFormat(source, data.format ?? "auto");
    const parsedSource = parseSource(source, format);
    const engine = await resolveEngine(data.engine ?? "teacher");
    const execution =
      engine === "teacher"
        ? buildTeacherPayload(parsedSource)
        : await buildModelPayload(parsedSource);

    self.postMessage({
      type: "done",
      engine,
      inputFormat: format,
      documentType: execution.state.documentType,
      pageCount: execution.state.pageCount,
      lineCount: execution.state.lines.length,
      candidateCount: execution.state.candidates.length,
      elapsedMs: Math.round(performance.now() - startedAt),
      program: execution.program,
      result: execution.result,
      selectedCandidate: serializeCandidate(execution.selectedCandidate),
      teacherSelectedCandidate: execution.teacherSelectedCandidate
        ? serializeCandidate(execution.teacherSelectedCandidate)
        : null,
      candidates: execution.rankedCandidates.map(serializeCandidate),
      modelStats: execution.modelStats,
      traceLines: execution.trace.map((step) => formatTraceLine(step, engine)),
      trace: execution.trace,
      prompt:
        "Find the final payable total from the OCR receipt. Choose only one legal money candidate that already appears in the document.",
      tool: {
        name: "receipt_total_psvm",
        engine,
        inputFormat: format,
        pages: execution.state.pageCount,
        lines: execution.state.lines.length,
        candidates: execution.state.candidates.length,
      },
    });
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

self.onmessage = (message) => {
  const { data } = message;
  if (!data || data.type !== "run") {
    return;
  }

  void handleRun(data);
};
