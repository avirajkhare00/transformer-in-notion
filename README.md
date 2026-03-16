# Transformer in Notion

This repo is a small embeddable demo site for browser-local problem-shaped VM
prototypes.

The default landing page now stays focused on two PSVM examples:

- `invoice/` for compact business-logic execution
- `soduku/` for compact search execution
- Static files only, so GitHub Pages can host it directly
- Separate standalone HTML entry pages for direct embeds

That keeps the deployment contract simple:

`Notion page -> embed block -> hosted app -> browser runtime`

Because the UI contract is explicit, the execution layer can still be replaced with:

- a tiny in-browser model
- a WASM runtime
- or a hybrid model + executor path

- `invoice/` - a small invoice-calculator PSVM with exact money arithmetic
- `soduku/` - a 4x4 Sudoku PSVM with a streamed worker trace

## Current emphasis

The repo currently emphasizes the PSVM track:

- `invoice/` includes the deterministic runtime, worker UI, dataset export, and
  a shipped local next-op model bundle
- `soduku/` includes the deterministic runtime, worker UI, and canonical trace
  surface for the first Sudoku-specific VM

Other older pages still exist as separate routes, but they are no longer the
main entry story.

## Why these demos

The first gallery should prove one thing clearly: a browser page can host
task-shaped runtimes with explicit traces and still make computation feel
legible.

That is why the early examples bias toward:

- exact outcomes instead of subjective outputs
- small state spaces instead of huge action spaces
- visible traces instead of opaque results
- short cold starts inside the browser

This makes examples such as invoice checking, 4x4 Sudoku, 24 Game, sorting,
maze search, and mini schedulers stronger early showcases than larger games.

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
- `index.html` - PSVM-first landing page
- `tic-tac-toe.html` - older standalone Tic-tac-toe demo route
- `sudoku.html` - older standalone Sudoku demo route
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
- `docs/executor-v1-spec.md` - v1 transformer-executor spec and training target
- `docs/paper-idea-problem-shaped-vms.md` - paper note for custom task-shaped VMs in browser-local transformers
- `docs/use-case-matrix.md` - architecture combinations and small real-world use cases
- `soduku/README.md` - Sudoku-specific workspace note and the recommended first benchmark
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

Neither browser prototype is transformer-backed yet. They are the deterministic
execution substrates that the local model will eventually learn to imitate or
drive.

The invoice directory now also contains the first student-model path:

- `invoice/export_dataset.mjs` generates synthetic `(context -> next op)` samples
- `invoice/train_transformer.py` trains a tiny next-op classifier on that dataset
- `invoice/models/invoice-op-bert/` contains the exported local model bundle
- `invoice/worker.mjs` now runs the invoice page in a strict student-driven loop,
  with the interpreter enforcing legal PSVM transitions

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
- `soduku/README.md`
- `soduku/`
- `invoice/`

The paper note now also includes a concrete **minimum VM stack** checklist that
separates:

- what is already verified in this repo
- what is only partially wired
- what remains unimplemented
