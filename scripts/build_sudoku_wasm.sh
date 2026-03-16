#!/bin/sh
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CRATE_DIR="$ROOT/wasm/sudoku-executor"
TARGET_DIR="$CRATE_DIR/target"
OUTPUT_DIR="$ROOT/wasm"
OUTPUT_FILE="$OUTPUT_DIR/sudoku_solver.wasm"

cargo build \
  --manifest-path "$CRATE_DIR/Cargo.toml" \
  --target wasm32-unknown-unknown \
  --release \
  --target-dir "$TARGET_DIR"

mkdir -p "$OUTPUT_DIR"
cp "$TARGET_DIR/wasm32-unknown-unknown/release/sudoku_executor.wasm" "$OUTPUT_FILE"

printf 'Wrote %s\n' "$OUTPUT_FILE"
