#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FIG_DIR="$ROOT_DIR/docs/figures"
SRC_DIR="$FIG_DIR/src"
OUT_DIR="$FIG_DIR/out"

mkdir -p "$OUT_DIR"

normalize_pdf() {
  local pdf_path="$1"
  local tmp_path="${pdf_path%.pdf}.compat.pdf"
  gs -q -dNOPAUSE -dBATCH -sDEVICE=pdfwrite -dCompatibilityLevel=1.5 \
    -sOutputFile="$tmp_path" "$pdf_path"
  mv "$tmp_path" "$pdf_path"
}

render_d2() {
  local name="$1"
  local pad="${2:-28}"
  d2 --theme 8 --layout dagre --pad "$pad" --omit-version \
    "$SRC_DIR/$name.d2" "$OUT_DIR/$name.svg"
  rsvg-convert -f pdf -o "$OUT_DIR/$name.pdf" "$OUT_DIR/$name.svg"
  normalize_pdf "$OUT_DIR/$name.pdf"
}

render_dot() {
  local name="$1"
  dot -Tsvg "$SRC_DIR/$name.dot" -o "$OUT_DIR/$name.svg"
  dot -Tpdf "$SRC_DIR/$name.dot" -o "$OUT_DIR/$name.pdf"
  normalize_pdf "$OUT_DIR/$name.pdf"
}

render_d2 "design-space" 8
render_d2 "tally-pipeline"
render_dot "psvm-loop"

octave-cli --quiet --no-window-system "$SRC_DIR/sudoku-benchmark.m" "$OUT_DIR"
normalize_pdf "$OUT_DIR/sudoku-benchmark.pdf"
