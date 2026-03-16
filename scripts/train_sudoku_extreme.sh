#!/bin/sh
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE="${NODE:-node}"
if [ -n "${PYTHON:-}" ]; then
  :
elif [ -x "$ROOT/.venv/bin/python" ]; then
  PYTHON="$ROOT/.venv/bin/python"
elif [ -x "$ROOT/../transformer-in-notion-executor/.venv/bin/python" ]; then
  PYTHON="$ROOT/../transformer-in-notion-executor/.venv/bin/python"
elif command -v python3 >/dev/null 2>&1; then
  PYTHON="$(command -v python3)"
else
  PYTHON=""
fi

INPUT="$ROOT/soduku/train_data/train.csv"
OUTPUT_DIR="$ROOT/soduku/training/extreme"
LIMIT_PUZZLES=250
MIN_RATING=0
EVAL_PERCENT=5
STATUS_EVERY=100

OP_RAW_DIR="$ROOT/soduku/training/extreme-op"
OP_EXPORT_DIR="$ROOT/soduku/models/extreme-op"
OP_EPOCHS=1
OP_BATCH_SIZE=1024
OP_TARGET_ACCURACY=0.0

VALUE_RAW_DIR="$ROOT/soduku/training/extreme-value"
VALUE_EXPORT_DIR="$ROOT/soduku/models/extreme-value"
VALUE_EPOCHS=1
VALUE_BATCH_SIZE=1024
VALUE_TARGET_ACCURACY=0.0

SKIP_EXPORT=0
SKIP_OP=0
SKIP_VALUE=0
DRY_RUN=0

usage() {
  cat <<'EOF'
Usage:
  sh scripts/train_sudoku_extreme.sh [options]

Options:
  --input PATH                 Source CSV. Default: soduku/train_data/train.csv
  --output-dir DIR             Export manifest/JSONL dir. Default: soduku/training/extreme
  --limit-puzzles N            Max puzzles to process. Default: 250
  --min-rating N               Minimum CSV rating filter. Default: 0
  --eval-percent N             Percent of puzzles held out for eval. Default: 5
  --status-every N             Progress logging frequency for exporter. Default: 100

  --op-raw-dir DIR             Raw op-model training dir.
  --op-export-dir DIR          ONNX op-model export dir.
  --op-epochs N                Op-model epochs. Default: 1
  --op-batch-size N            Op-model batch size. Default: 1024
  --op-target-accuracy FLOAT   Early-stop/export threshold. Default: 0.0

  --value-raw-dir DIR          Raw value-model training dir.
  --value-export-dir DIR       ONNX value-model export dir.
  --value-epochs N             Value-model epochs. Default: 1
  --value-batch-size N         Value-model batch size. Default: 1024
  --value-target-accuracy FLOAT
                               Value-model threshold. Default: 0.0

  --skip-export                Reuse existing manifests.
  --skip-op                    Skip next-op training.
  --skip-value                 Skip PLACE-value training.
  --dry-run                    Print commands without running them.
  --help                       Show this help.

Notes:
  - Sets PYTORCH_ENABLE_MPS_FALLBACK=1 for both training commands.
  - Defaults are conservative for an M1/M2 local run.
EOF
}

run_cmd() {
  printf '%s\n' "$*"
  if [ "$DRY_RUN" -eq 0 ]; then
    "$@"
  fi
}

while [ $# -gt 0 ]; do
  case "$1" in
    --input) INPUT="$2"; shift 2 ;;
    --output-dir) OUTPUT_DIR="$2"; shift 2 ;;
    --limit-puzzles) LIMIT_PUZZLES="$2"; shift 2 ;;
    --min-rating) MIN_RATING="$2"; shift 2 ;;
    --eval-percent) EVAL_PERCENT="$2"; shift 2 ;;
    --status-every) STATUS_EVERY="$2"; shift 2 ;;
    --op-raw-dir) OP_RAW_DIR="$2"; shift 2 ;;
    --op-export-dir) OP_EXPORT_DIR="$2"; shift 2 ;;
    --op-epochs) OP_EPOCHS="$2"; shift 2 ;;
    --op-batch-size) OP_BATCH_SIZE="$2"; shift 2 ;;
    --op-target-accuracy) OP_TARGET_ACCURACY="$2"; shift 2 ;;
    --value-raw-dir) VALUE_RAW_DIR="$2"; shift 2 ;;
    --value-export-dir) VALUE_EXPORT_DIR="$2"; shift 2 ;;
    --value-epochs) VALUE_EPOCHS="$2"; shift 2 ;;
    --value-batch-size) VALUE_BATCH_SIZE="$2"; shift 2 ;;
    --value-target-accuracy) VALUE_TARGET_ACCURACY="$2"; shift 2 ;;
    --skip-export) SKIP_EXPORT=1; shift 1 ;;
    --skip-op) SKIP_OP=1; shift 1 ;;
    --skip-value) SKIP_VALUE=1; shift 1 ;;
    --dry-run) DRY_RUN=1; shift 1 ;;
    --help) usage; exit 0 ;;
    *)
      printf 'Unknown option: %s\n\n' "$1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [ ! -x "$PYTHON" ]; then
  printf 'Python not found or not executable: %s\n' "$PYTHON" >&2
  exit 1
fi

if [ ! -f "$INPUT" ]; then
  printf 'Input CSV not found: %s\n' "$INPUT" >&2
  exit 1
fi

if ! "$PYTHON" - <<'PY' >/dev/null 2>&1
import torch, onnxscript
PY
then
  printf 'Python environment is missing torch/onnxscript. Set PYTHON=/path/to/venv/bin/python or install requirements first.\n' >&2
  exit 1
fi

OP_MANIFEST="$OUTPUT_DIR/extreme-op-manifest.json"
VALUE_MANIFEST="$OUTPUT_DIR/extreme-value-manifest.json"

printf 'Repo root: %s\n' "$ROOT"
printf 'Python: %s\n' "$PYTHON"
printf 'Input CSV: %s\n' "$INPUT"
printf 'Output dir: %s\n' "$OUTPUT_DIR"
printf 'Limit puzzles: %s\n' "$LIMIT_PUZZLES"

MPS_STATUS="$("$PYTHON" - <<'PY'
import torch
print(f"mps_built={torch.backends.mps.is_built()} mps_available={torch.backends.mps.is_available()}")
PY
)"
printf 'Torch backend: %s\n' "$MPS_STATUS"

if [ "$SKIP_EXPORT" -eq 0 ]; then
  run_cmd \
    "$NODE" "$ROOT/soduku/export_extreme_dataset.mjs" \
    --input "$INPUT" \
    --output-dir "$OUTPUT_DIR" \
    --limit-puzzles "$LIMIT_PUZZLES" \
    --min-rating "$MIN_RATING" \
    --eval-percent "$EVAL_PERCENT" \
    --status-every "$STATUS_EVERY"
fi

if [ "$SKIP_OP" -eq 0 ]; then
  if [ "$DRY_RUN" -eq 0 ] && [ ! -f "$OP_MANIFEST" ]; then
    printf 'Op manifest not found: %s\n' "$OP_MANIFEST" >&2
    exit 1
  fi
  run_cmd \
    env PYTORCH_ENABLE_MPS_FALLBACK=1 \
    "$PYTHON" "$ROOT/soduku/train_transformer.py" \
    --dataset "$OP_MANIFEST" \
    --raw-dir "$OP_RAW_DIR" \
    --export-dir "$OP_EXPORT_DIR" \
    --epochs "$OP_EPOCHS" \
    --batch-size "$OP_BATCH_SIZE" \
    --target-accuracy "$OP_TARGET_ACCURACY"
fi

if [ "$SKIP_VALUE" -eq 0 ]; then
  if [ "$DRY_RUN" -eq 0 ] && [ ! -f "$VALUE_MANIFEST" ]; then
    printf 'Value manifest not found: %s\n' "$VALUE_MANIFEST" >&2
    exit 1
  fi
  run_cmd \
    env PYTORCH_ENABLE_MPS_FALLBACK=1 \
    "$PYTHON" "$ROOT/soduku/train_value_transformer.py" \
    --dataset "$VALUE_MANIFEST" \
    --raw-dir "$VALUE_RAW_DIR" \
    --export-dir "$VALUE_EXPORT_DIR" \
    --epochs "$VALUE_EPOCHS" \
    --batch-size "$VALUE_BATCH_SIZE" \
    --target-accuracy "$VALUE_TARGET_ACCURACY"
fi

printf 'Done.\n'
