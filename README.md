# Transformer in Notion

This repo is a small embeddable demo site for Notion pages.

The current version deliberately keeps the stack simple, but it now uses an
explicit prompt -> program -> trace surface:

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

The repo now also includes two problem-shaped VM prototypes outside the main
gallery:

- `invoice/` - a small invoice-calculator PSVM with exact money arithmetic
- `soduku/` - a 4x4 Sudoku PSVM with a streamed worker trace
- `weiqi/` - a 5x5 Weiqi capture PSVM with exact local rules and a streamed worker trace

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

- `LICENSE` - Apache-2.0 license for the repository
- `index.html` - page shell and demo layout
- `tic-tac-toe.html` - standalone Tic-tac-toe embed page
- `sudoku.html` - standalone Sudoku embed page
- `soduku/index.html` - standalone 4x4 Sudoku PSVM prototype
- `soduku/app.mjs` - browser UI for the 4x4 Sudoku PSVM
- `soduku/worker.mjs` - worker-side 4x4 Sudoku execution loop
- `soduku/psvm4x4.mjs` - limited-op 4x4 Sudoku PSVM and canonical trace generator
- `invoice/index.html` - standalone invoice-calculator PSVM prototype
- `invoice/app.mjs` - browser UI for the invoice PSVM
- `invoice/worker.mjs` - worker-side invoice execution loop
- `invoice/model.mjs` - browser-side invoice next-op model loader
- `invoice/psvm.mjs` - invoice-calculator PSVM and canonical trace generator
- `invoice/export_dataset.mjs` - synthetic dataset generator for invoice next-op supervision
- `invoice/train_transformer.py` - tiny invoice next-op transformer trainer/exporter
- `invoice/models/invoice-op-bert/` - shipped ONNX bundle for the invoice next-op student
- `invoice/README.md` - invoice-calculator PSVM note and op-set summary
- `weiqi/index.html` - standalone 5x5 Weiqi PSVM prototype
- `weiqi/app.mjs` - browser UI for the Weiqi PSVM
- `weiqi/worker.mjs` - worker-side Weiqi search loop
- `weiqi/psvm5x5.mjs` - 5x5 Weiqi rules engine and bounded capture solver
- `weiqi/README.md` - Weiqi-specific workspace note and VM scope
- `docs/executor-v1-spec.md` - v1 transformer-executor spec and training target
- `docs/paper-idea-problem-shaped-vms.md` - paper note for custom task-shaped VMs in browser-local transformers
- `docs/use-case-matrix.md` - architecture combinations and small real-world use cases
- `soduku/README.md` - Sudoku-specific workspace note and the recommended first benchmark
- `soduku/export_hard_dataset.mjs` - hard-puzzle next-op dataset exporter with puzzle-held-out splits
- `soduku/train_transformer.py` - tiny hard-set Sudoku next-op trainer/exporter
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

## Running the PSVM prototypes

Serve the repo root, then open either of these standalone prototype pages:

- `/soduku/`
- `/invoice/`

The current prototype split is:

- `invoice/` - exact invoice calculation expressed as a compact PSVM and executed in a Web Worker
- `soduku/` - 4x4 Sudoku search expressed as a compact PSVM and executed in a Web Worker
- `weiqi/` - 5x5 Weiqi capture problems expressed as a compact PSVM and executed in a Web Worker

Neither browser prototype is transformer-backed yet. They are the deterministic
execution substrates that the local model will eventually learn to imitate or
drive.

The invoice directory now also contains the first student-model path:

- `invoice/export_dataset.mjs` generates synthetic `(context -> next op)` samples
- `invoice/train_transformer.py` trains a tiny next-op classifier on that dataset
- `invoice/models/invoice-op-bert/` contains the exported local model bundle
- `invoice/worker.mjs` now runs the invoice page in a strict student-driven loop,
  with the interpreter enforcing legal PSVM transitions

For hard 9x9 Sudoku benchmarking and future training/eval work, the repo now
also includes:

- `logic/sudoku-hard.mjs` - curated hard-puzzle presets
- `scripts/benchmark_sudoku_hard.mjs` - apples-to-apples policy benchmark of the same JS DFS solver
- `scripts/export_sudoku_hard_traces.mjs` - trace export for the hard corpus
- `soduku/export_hard_dataset.mjs` - held-out hard-set next-op dataset export
- `soduku/train_transformer.py` - tiny hard-set next-op student training

## Verified

- The exported Tic-tac-toe ONNX bundle reached `99.54%` accuracy on the full
  `4,520`-board oracle dataset and predicts center on the empty board.
- The Sudoku WASM executor returns the same solved grid and the same traced
  search summary as the earlier JS reference path:
  - `458` trace events
  - `173` placements
  - `117` backtracks
- The hard 9x9 benchmark now compares the same JS DFS solver under two chooser
  policies (`row-major` vs `mrv`) and validates every returned solution against
  the original clues. On the current curated hard set, MRV cuts search work by
  large margins on every puzzle, while still losing wall-clock time on `Arto
  Inkala 2012` because chooser overhead increases candidate lookups.
- The first hard-set Sudoku student path is now real:
  - exported dataset size in the smoke run: `12,591` samples
  - eval split: held-out `AI Escargot`
  - tiny next-op classifier smoke accuracy: `96.79%`
- `node --check` passes for the frontend modules, and `cargo check` passes for
  the Rust executor crate.

## Next steps

- Add a true model + executor pair for a larger puzzle
- Add a small chess legality or mate-in-one example before full chess
- Add a tighter mobile/embed height mode for narrower Notion columns

## Execution model

The repo is moving toward a stricter systems view of transformer execution.

For exact tasks, a transformer is often a better conceptual fit for an
**append-only execution machine** than for a mutable RAM machine:

- a normal computer mutates state in place
- an autoregressive transformer extends a history of state records
- attention reconstructs the current state by retrieving the right prior records

That suggests a better formulation for local exact computation:

- not `input -> final answer`
- not `task -> full general-purpose VM trace`
- instead `task -> problem-shaped VM program -> canonical execution trace`

The core design goal is to make the model learn **composition of useful
operations**, not simulation of irrelevant machine detail.

In practice that means:

- keep the execution vocabulary small
- keep the trace canonical and inspectable
- push exact semantics into a deterministic interpreter or verifier
- reserve model capacity for choosing and ordering operations

For Sudoku, that points toward a task-shaped executor with ops like
`FOCUS_NEXT`, `READ_CANDS`, `PLACE`, `UNDO`, `FAIL`, and `HALT`, not a full VM
on day one.

The invoice prototype shows the same idea in a non-puzzle setting: a small web
app can expose only the exact business operations it needs, such as
`READ_ITEM`, `LINE_TOTAL`, `ADD_SUBTOTAL`, `APPLY_TAX`, `EMIT_TOTAL`, and
`HALT`.

## License

This repository is licensed under Apache-2.0. That gives downstream users broad
reuse rights and includes the standard patent grant plus warranty/liability
disclaimers.

What it does **not** do is fully shield anyone from every copyright or other IP
claim. No open-source license can honestly promise that. The practical boundary
is:

- the repo owner can license only the material they have rights to license
- contributors should submit only code, weights, assets, and docs they are
  allowed to contribute
- third-party code, models, datasets, fonts, and media keep their own licenses
  and restrictions

If the goal is stronger protection in practice, the real controls are provenance
and review: keep dependency and model sources documented, avoid copying
unlicensed material, and require contributors to contribute only material they
own or are allowed to relicense.

## Architecture ideas

If you are deciding what kind of demo to build next, see
`docs/use-case-matrix.md` for a table of:

- `LLM / model / tool / executor / verifier` combinations
- the small real-world use cases each combination fits best
- which examples are worth building in this repo next

If you want the concrete next build target for the "computer inside a
transformer" direction, see:

- `docs/executor-v1-spec.md`
- `docs/examples/executor-v1-add-two.json`

If you want the paper-shaped framing for the more specific direction of
`transformer + custom VM + Sudoku/web apps + WASM + browser`, see:

- `docs/paper-idea-problem-shaped-vms.md`
- `docs/vm-design-space.md`
- `soduku/README.md`
- `soduku/`
- `invoice/`

The paper note now also includes a concrete **minimum VM stack** checklist that
separates:

- what is already verified in this repo
- what is only partially wired
- what remains unimplemented
