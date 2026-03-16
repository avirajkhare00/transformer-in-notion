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
TOP_PUZZLES_BY_RATING=0
MIN_RATING=0
EVAL_PERCENT=5
STATUS_EVERY=100
LOG_EVERY=100
NUM_WORKERS=4
PREFETCH_FACTOR=4
CHECKPOINT_EVERY=1
RESUME_LATEST=0
PACK_DATASET=1
SHARD_ROWS=65536

OP_RAW_DIR="$ROOT/soduku/training/extreme-op"
OP_EXPORT_DIR="$ROOT/soduku/models/extreme-op"
OP_CHECKPOINT_DIR="$ROOT/soduku/checkpoints/extreme-op"
OP_RESUME_CHECKPOINT=""
OP_EPOCHS=1
OP_BATCH_SIZE=1024
OP_TARGET_ACCURACY=0.0

VALUE_RAW_DIR="$ROOT/soduku/training/extreme-value"
VALUE_EXPORT_DIR="$ROOT/soduku/models/extreme-value"
VALUE_CHECKPOINT_DIR="$ROOT/soduku/checkpoints/extreme-value"
VALUE_RESUME_CHECKPOINT=""
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
  --top-puzzles-by-rating N    Keep only the highest-rated N puzzles from the full CSV scan.
  --min-rating N               Minimum CSV rating filter. Default: 0
  --eval-percent N             Percent of puzzles held out for eval. Default: 5
  --status-every N             Progress logging frequency for exporter. Default: 100
  --log-every N                Batch logging frequency for both Python trainers. Default: 100
  --num-workers N              DataLoader workers for both Python trainers. Default: 4
  --prefetch-factor N          DataLoader prefetch factor when workers > 0. Default: 4
  --checkpoint-every N         Save latest checkpoint every N epochs. Default: 1
  --resume-latest              Reuse <checkpoint-dir>/latest.pt when present.
  --skip-pack                  Skip packing JSONL manifests into tensor shards.
  --shard-rows N               Rows per packed tensor shard. Default: 65536

  --op-raw-dir DIR             Raw op-model training dir.
  --op-export-dir DIR          ONNX op-model export dir.
  --op-checkpoint-dir DIR      Op-model checkpoint dir. Default: soduku/checkpoints/extreme-op
  --op-resume-checkpoint DIR   Explicit op-model checkpoint to resume from.
  --op-epochs N                Op-model epochs. Default: 1
  --op-batch-size N            Op-model batch size. Default: 1024
  --op-target-accuracy FLOAT   Early-stop threshold; 0 disables early stopping. Default: 0.0

  --value-raw-dir DIR          Raw value-model training dir.
  --value-export-dir DIR       ONNX value-model export dir.
  --value-checkpoint-dir DIR   Value-model checkpoint dir. Default: soduku/checkpoints/extreme-value
  --value-resume-checkpoint DIR
                               Explicit value-model checkpoint to resume from.
  --value-epochs N             Value-model epochs. Default: 1
  --value-batch-size N         Value-model batch size. Default: 1024
  --value-target-accuracy FLOAT
                               Value-model early-stop threshold; 0 disables early stopping. Default: 0.0

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
    --top-puzzles-by-rating) TOP_PUZZLES_BY_RATING="$2"; shift 2 ;;
    --min-rating) MIN_RATING="$2"; shift 2 ;;
    --eval-percent) EVAL_PERCENT="$2"; shift 2 ;;
    --status-every) STATUS_EVERY="$2"; shift 2 ;;
    --log-every) LOG_EVERY="$2"; shift 2 ;;
    --num-workers) NUM_WORKERS="$2"; shift 2 ;;
    --prefetch-factor) PREFETCH_FACTOR="$2"; shift 2 ;;
    --checkpoint-every) CHECKPOINT_EVERY="$2"; shift 2 ;;
    --resume-latest) RESUME_LATEST=1; shift 1 ;;
    --skip-pack) PACK_DATASET=0; shift 1 ;;
    --shard-rows) SHARD_ROWS="$2"; shift 2 ;;
    --op-raw-dir) OP_RAW_DIR="$2"; shift 2 ;;
    --op-export-dir) OP_EXPORT_DIR="$2"; shift 2 ;;
    --op-checkpoint-dir) OP_CHECKPOINT_DIR="$2"; shift 2 ;;
    --op-resume-checkpoint) OP_RESUME_CHECKPOINT="$2"; shift 2 ;;
    --op-epochs) OP_EPOCHS="$2"; shift 2 ;;
    --op-batch-size) OP_BATCH_SIZE="$2"; shift 2 ;;
    --op-target-accuracy) OP_TARGET_ACCURACY="$2"; shift 2 ;;
    --value-raw-dir) VALUE_RAW_DIR="$2"; shift 2 ;;
    --value-export-dir) VALUE_EXPORT_DIR="$2"; shift 2 ;;
    --value-checkpoint-dir) VALUE_CHECKPOINT_DIR="$2"; shift 2 ;;
    --value-resume-checkpoint) VALUE_RESUME_CHECKPOINT="$2"; shift 2 ;;
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
OP_PACKED_MANIFEST="$OUTPUT_DIR/extreme-op-packed-manifest.json"
VALUE_PACKED_MANIFEST="$OUTPUT_DIR/extreme-value-packed-manifest.json"

if [ "$RESUME_LATEST" -eq 1 ] && [ -z "$OP_RESUME_CHECKPOINT" ] && [ -f "$OP_CHECKPOINT_DIR/latest.pt" ]; then
  OP_RESUME_CHECKPOINT="$OP_CHECKPOINT_DIR/latest.pt"
fi

if [ "$RESUME_LATEST" -eq 1 ] && [ -z "$VALUE_RESUME_CHECKPOINT" ] && [ -f "$VALUE_CHECKPOINT_DIR/latest.pt" ]; then
  VALUE_RESUME_CHECKPOINT="$VALUE_CHECKPOINT_DIR/latest.pt"
fi

printf 'Repo root: %s\n' "$ROOT"
printf 'Python: %s\n' "$PYTHON"
printf 'Input CSV: %s\n' "$INPUT"
printf 'Output dir: %s\n' "$OUTPUT_DIR"
printf 'Limit puzzles: %s\n' "$LIMIT_PUZZLES"
printf 'Top puzzles by rating: %s\n' "$TOP_PUZZLES_BY_RATING"
printf 'Trainer log every: %s\n' "$LOG_EVERY"
printf 'DataLoader workers: %s\n' "$NUM_WORKERS"
printf 'Prefetch factor: %s\n' "$PREFETCH_FACTOR"
printf 'Checkpoint every: %s\n' "$CHECKPOINT_EVERY"
printf 'Pack dataset: %s\n' "$PACK_DATASET"
printf 'Shard rows: %s\n' "$SHARD_ROWS"
printf 'Op resume checkpoint: %s\n' "${OP_RESUME_CHECKPOINT:-<none>}"
printf 'Value resume checkpoint: %s\n' "${VALUE_RESUME_CHECKPOINT:-<none>}"

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
    --top-puzzles-by-rating "$TOP_PUZZLES_BY_RATING" \
    --min-rating "$MIN_RATING" \
    --eval-percent "$EVAL_PERCENT" \
    --status-every "$STATUS_EVERY"
fi

if [ "$PACK_DATASET" -eq 1 ]; then
  if [ "$DRY_RUN" -eq 0 ] && [ ! -f "$OP_MANIFEST" ]; then
    printf 'Op manifest not found for packing: %s\n' "$OP_MANIFEST" >&2
    exit 1
  fi
  if [ "$DRY_RUN" -eq 0 ] && [ ! -f "$VALUE_MANIFEST" ]; then
    printf 'Value manifest not found for packing: %s\n' "$VALUE_MANIFEST" >&2
    exit 1
  fi
  run_cmd \
    "$PYTHON" "$ROOT/soduku/pack_structured_dataset.py" \
    --dataset "$OP_MANIFEST" \
    --shard-rows "$SHARD_ROWS"
  run_cmd \
    "$PYTHON" "$ROOT/soduku/pack_structured_dataset.py" \
    --dataset "$VALUE_MANIFEST" \
    --shard-rows "$SHARD_ROWS"
fi

if [ "$SKIP_OP" -eq 0 ]; then
  OP_TRAIN_DATASET="$OP_MANIFEST"
  if [ "$PACK_DATASET" -eq 1 ]; then
    OP_TRAIN_DATASET="$OP_PACKED_MANIFEST"
  elif [ -f "$OP_PACKED_MANIFEST" ]; then
    OP_TRAIN_DATASET="$OP_PACKED_MANIFEST"
  fi
  if [ "$DRY_RUN" -eq 0 ] && [ ! -f "$OP_TRAIN_DATASET" ]; then
    printf 'Op manifest not found: %s\n' "$OP_TRAIN_DATASET" >&2
    exit 1
  fi
  set -- \
    env PYTORCH_ENABLE_MPS_FALLBACK=1 \
    "$PYTHON" "$ROOT/soduku/train_transformer.py" \
    --dataset "$OP_TRAIN_DATASET" \
    --raw-dir "$OP_RAW_DIR" \
    --export-dir "$OP_EXPORT_DIR" \
    --checkpoint-dir "$OP_CHECKPOINT_DIR" \
    --checkpoint-every "$CHECKPOINT_EVERY" \
    --epochs "$OP_EPOCHS" \
    --batch-size "$OP_BATCH_SIZE" \
    --target-accuracy "$OP_TARGET_ACCURACY" \
    --num-workers "$NUM_WORKERS" \
    --prefetch-factor "$PREFETCH_FACTOR" \
    --log-every "$LOG_EVERY"
  if [ -n "$OP_RESUME_CHECKPOINT" ]; then
    set -- "$@" --resume-from-checkpoint "$OP_RESUME_CHECKPOINT"
  fi
  run_cmd "$@"
fi

if [ "$SKIP_VALUE" -eq 0 ]; then
  VALUE_TRAIN_DATASET="$VALUE_MANIFEST"
  if [ "$PACK_DATASET" -eq 1 ]; then
    VALUE_TRAIN_DATASET="$VALUE_PACKED_MANIFEST"
  elif [ -f "$VALUE_PACKED_MANIFEST" ]; then
    VALUE_TRAIN_DATASET="$VALUE_PACKED_MANIFEST"
  fi
  if [ "$DRY_RUN" -eq 0 ] && [ ! -f "$VALUE_TRAIN_DATASET" ]; then
    printf 'Value manifest not found: %s\n' "$VALUE_TRAIN_DATASET" >&2
    exit 1
  fi
  set -- \
    env PYTORCH_ENABLE_MPS_FALLBACK=1 \
    "$PYTHON" "$ROOT/soduku/train_value_transformer.py" \
    --dataset "$VALUE_TRAIN_DATASET" \
    --raw-dir "$VALUE_RAW_DIR" \
    --export-dir "$VALUE_EXPORT_DIR" \
    --checkpoint-dir "$VALUE_CHECKPOINT_DIR" \
    --checkpoint-every "$CHECKPOINT_EVERY" \
    --epochs "$VALUE_EPOCHS" \
    --batch-size "$VALUE_BATCH_SIZE" \
    --target-accuracy "$VALUE_TARGET_ACCURACY" \
    --num-workers "$NUM_WORKERS" \
    --prefetch-factor "$PREFETCH_FACTOR" \
    --log-every "$LOG_EVERY"
  if [ -n "$VALUE_RESUME_CHECKPOINT" ]; then
    set -- "$@" --resume-from-checkpoint "$VALUE_RESUME_CHECKPOINT"
  fi
  run_cmd "$@"
fi

printf 'Done.\n'
