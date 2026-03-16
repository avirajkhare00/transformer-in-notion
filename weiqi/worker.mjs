import {
  DEFAULT_PRESET_ID,
  WEIQI_PRESETS,
  buildProgram5x5,
  buildGivenMask5x5,
  formatWeiqiEvent,
  getTargetOverlay,
  parseBoard5x5,
  solveWeiqiCapture,
} from "./psvm5x5.mjs";

function getPreset(id) {
  return (
    WEIQI_PRESETS.find((preset) => preset.id === id) ??
    WEIQI_PRESETS.find((preset) => preset.id === DEFAULT_PRESET_ID) ??
    WEIQI_PRESETS[0]
  );
}

self.onmessage = (message) => {
  const { data } = message;
  if (!data || data.type !== "solve") {
    return;
  }

  const startedAt = performance.now();

  try {
    const preset = getPreset(data.presetId);
    const initialBoard = parseBoard5x5(preset.board);

    self.postMessage({
      type: "start",
      preset: {
        id: preset.id,
        label: preset.label,
        attacker: preset.attacker,
        targetColor: preset.targetColor,
        targetSeed: preset.targetSeed,
        maxPly: preset.maxPly,
        summary: preset.summary,
      },
      board: initialBoard,
      givenMask: buildGivenMask5x5(initialBoard),
      targetOverlay: getTargetOverlay(initialBoard, preset.targetSeed, preset.targetColor),
      program: buildProgram5x5(preset),
    });

    const result = solveWeiqiCapture(preset, {
      onEvent(event, snapshot) {
        self.postMessage({
          type: "event",
          event,
          snapshot,
          targetOverlay: getTargetOverlay(snapshot, preset.targetSeed, preset.targetColor),
          line: formatWeiqiEvent(event),
        });
      },
    });

    self.postMessage({
      type: "done",
      preset: {
        id: preset.id,
        label: preset.label,
        attacker: preset.attacker,
        targetColor: preset.targetColor,
        targetSeed: preset.targetSeed,
        maxPly: preset.maxPly,
        summary: preset.summary,
      },
      solved: result.solved,
      board: result.board,
      givenMask: result.givenMask,
      targetOverlay: getTargetOverlay(result.board, preset.targetSeed, preset.targetColor),
      stats: result.stats,
      traceLength: result.trace.length,
      elapsedMs: Math.round(performance.now() - startedAt),
    });
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
