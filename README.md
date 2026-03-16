# Transformer in Notion

This repo is a small embeddable demo site for Notion pages.

The current version deliberately keeps the stack simple, but it now adopts a
Percepta-style surface:

- Tic-tac-toe with a visible local transformer policy trace
- Sudoku with preset loading, custom puzzle input, and an animated browser-side WASM trace
- Prompt -> pseudo-program -> execution trace panels for both demos
- Static files only, so GitHub Pages can host it directly
- Separate standalone HTML entry pages for direct Notion embeds

The embed story now has both halves:

- Tic-tac-toe uses a tiny model bundle loaded locally in the browser
- Sudoku uses a browser-side WebAssembly executor

That keeps the deployment contract simple:

`Notion page -> embed block -> hosted app -> browser runtime`

Because the UI contract is explicit, the remaining solver logic can still be replaced with:

- a tiny in-browser model
- a WASM runtime
- or a hybrid model + executor path

## What this branch adds

This branch moves the repo from a mock executor surface to real browser-side
artifacts:

- Tic-tac-toe now loads a shipped ONNX model bundle from `models/tictactoe-bert/`
  through Transformers.js.
- The Tic-tac-toe bundle now ships both `onnx/model.onnx` and
  `onnx/model_quantized.onnx` so browser runtimes that still request the
  quantized filename do not 404 on Pages.
- Sudoku now loads a shipped WebAssembly binary from `wasm/sudoku_solver.wasm`.
- Sudoku now supports preset selection and bring-your-own 81-cell puzzle input
  in the browser.
- The existing prompt -> program -> trace UI stays the same, but the engines
  behind the two cards are now different and real:
  - local transformer weights for Tic-tac-toe
  - local Rust/WASM executor for Sudoku

This is the intended split for the project:

- small policy-style examples can use local model weights
- longer exact traces can use a browser-side executor

## Why these demos

The first gallery should prove one thing clearly: a Notion embed can host
local weights or an executor-style runtime and still make computation feel
legible.

That is why the early examples bias toward:

- exact outcomes instead of subjective outputs
- small state spaces instead of huge action spaces
- visible traces instead of opaque results
- short cold starts inside the browser

This makes examples such as tic-tac-toe, 24 Game, sorting, maze search, and
mini Sudoku stronger early showcases than larger games.

## Why not bigger examples yet

Some examples are intentionally deferred until the local model path is more
mature.

- Full chess needs strict legality, deeper search, and a much stronger model.
- Large puzzles push model size, latency, and browser memory in the wrong direction.
- Weak play is much more obvious and trust-breaking in chess than in exact mini tasks.
- If we attach a heavy external engine too early, the story becomes "tool in
  Notion" rather than "transformer or executor in Notion."

## Local development

Serve the repo root with any static file server:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Files

- `index.html` - page shell and demo layout
- `tic-tac-toe.html` - standalone Tic-tac-toe embed page
- `sudoku.html` - standalone Sudoku embed page
- `styles.css` - visual system tuned for an iframe or Notion embed
- `app.mjs` - UI wiring and animations
- `logic/tictactoe.mjs` - minimax engine
- `logic/tictactoe-model.mjs` - local Transformers.js runtime wrapper
- `logic/sudoku.mjs` - Sudoku board parsing and formatting helpers
- `logic/sudoku-wasm.mjs` - WebAssembly loader and JS wrapper for Sudoku execution
- `logic/executor.mjs` - prompt/program/trace artifact builder
- `models/tictactoe-bert/` - shipped ONNX model bundle for the Tic-tac-toe demo
- `scripts/export_tictactoe_dataset.mjs` - dataset export from the oracle solver
- `scripts/train_tictactoe_transformer.py` - train + ONNX export for the browser model
- `scripts/build_sudoku_wasm.sh` - build and copy the browser Sudoku executor
- `wasm/sudoku-executor/` - Rust crate compiled to WebAssembly
- `wasm/sudoku_solver.wasm` - shipped browser runtime for the Sudoku demo

## GitHub Pages

The workflow in `.github/workflows/pages.yml` publishes the repo root as a Pages site.
Once Pages is enabled, any of these URLs can be pasted straight into a Notion
embed block:

- `/`
- `/tic-tac-toe.html`
- `/sudoku.html`

## Training the tic-tac-toe model

The local model bundle is generated in two steps:

```bash
node scripts/export_tictactoe_dataset.mjs
.venv/bin/python scripts/train_tictactoe_transformer.py
```

That writes an ONNX-ready Hugging Face model bundle to `models/tictactoe-bert/`,
with the ONNX graph stored at `models/tictactoe-bert/onnx/model.onnx`. The
training/export step also writes a compatibility copy to
`models/tictactoe-bert/onnx/model_quantized.onnx` so browser runtimes that still
probe for the quantized filename work without extra deploy logic.

## Building the Sudoku WASM executor

Build the browser-side solver with:

```bash
sh scripts/build_sudoku_wasm.sh
```

That writes the runtime artifact to `wasm/sudoku_solver.wasm`, which the page
loads directly with `WebAssembly.instantiate`.

## Verified

- The exported Tic-tac-toe ONNX bundle reached `99.54%` accuracy on the full
  `4,520`-board oracle dataset and predicts center on the empty board.
- The Sudoku WASM executor returns the same solved grid and the same traced
  search summary as the earlier JS reference path:
  - `458` trace events
  - `173` placements
  - `117` backtracks
- `node --check` passes for the frontend modules, and `cargo check` passes for
  the Rust executor crate.

## Next steps

- Add a true model + executor pair for a larger puzzle
- Add a small chess legality or mate-in-one example before full chess
- Add a tighter mobile/embed height mode for narrower Notion columns
