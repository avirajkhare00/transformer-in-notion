# Transformer Runtime Lab

This repository explores a simple thesis:

`code is the source of truth`

For exact tasks, the runtime should own legality, state transitions, and backtracking. The model should learn the narrow decision surface on top of that runtime by evaluating ambiguous PSVM states, not replace the runtime with a one-shot guess.

## Core idea

The project is built around **problem-shaped virtual machines (PSVMs)**.

Instead of asking a model to learn:

`task -> final answer`

or:

`task -> generic C/WASM machine semantics`

we use:

`task -> custom ops -> exact PSVM state -> local model estimates branch value`

In practice that means:

1. Write or keep an exact reference runtime.
2. Define the smallest sound op surface for the task.
3. Export canonical traces and state/decision records from the runtime.
4. Encode structured state snapshots.
5. Train a local structured model to estimate branch value over PSVM states or rank legal arguments.
6. Keep the exact runtime in the loop for verification and rollback.

The model handles ambiguity by scoring branches. The code handles truth.

## Why this approach

Generic compiled traces are too noisy for narrow exact tasks. They include machine detail the task does not care about:

- stack plumbing
- memory bookkeeping
- compiler-induced structure
- large instruction surfaces

A PSVM keeps only the transitions that carry semantic weight for the task. That gives:

- smaller action spaces
- shorter traces
- cleaner supervision
- more interpretable execution
- cheaper browser-local inference

## Current focus

The repo currently centers on two browser-local tasks:

- [sudoku.html](/Users/avirajkhare/hack2/transformers/transformer-in-notion/sudoku.html)
  Exact 9x9 Sudoku solve with:
  - exact browser-side runtime
  - deterministic backtracking
  - local guided branch ranking with `Auto`, `Transformer`, `Transformer (Regret)`, `Transformer (Hard)`, or `GNN` selection
  - visible trace and model stats

- [weiqi/index.html](/Users/avirajkhare/hack2/transformers/transformer-in-notion/weiqi/index.html)
  5x5 Weiqi capture PSVM with exact local rules.

The main Sudoku page is the current source of truth for the end-to-end architecture.

## Sudoku architecture

Sudoku is the clearest example of the stack:

`structured state -> local value policy (transformer or GNN) -> ranked PLACE candidates -> exact runtime -> new state`

What remains exact:

- candidate generation
- legality checks
- contradiction detection
- backtracking
- halt conditions

What the model does:

- rank branch choices where ambiguity exists

That means the current guided solver is **model-guided exact search**, not a pure free-running model-only solver.

## Code as source of truth

This repository explicitly treats code and runtime behavior as authoritative.

- The solver defines what a legal step is.
- The verifier defines whether a branch is valid.
- The canonical trace comes from the runtime.
- The model is trained against exact state/decision records derived from that trace.

So the meta-pattern is:

`state -> model estimates branch value -> exact runtime -> new state`

not:

`state -> model -> magic answer`

## Why not compile C directly into weights

That broader direction is interesting, but for this project it is too broad.

For narrow exact tasks like Sudoku, Weiqi tactics, or small rule-checking tools, the efficient path is:

`task -> custom ops -> PSVM -> weights`

not:

`task -> arbitrary C -> full machine semantics -> weights`

The latter keeps too much irrelevant machine detail alive in the training target.

## Project status

What is working now:

- exact browser-side Sudoku solve
- guided local model path on Sudoku
- live guided board animation
- exact backtracking and verifier-backed execution
- structured ONNX models running locally in the browser
- packed tensor-shard training path for structured Sudoku models

What is not claimed yet:

- pure free-running model-only 9x9 Sudoku solving
- model outperforming the deterministic reference policy
- a general-purpose compiled-code-to-weights system

## Local development

Serve the repo root with any static file server:

```bash
.venv/bin/python -m pip install -r requirements.txt
python3 -m http.server 8000
```

Then open:

- `http://localhost:8000/sudoku.html`
- `http://localhost:8000/weiqi/`

## Sudoku training

The structured Sudoku training path lives under the legacy `soduku/` directory name.

One-command training wrapper:

```bash
PYTHON=../transformer-in-notion-executor/.venv/bin/python \
sh scripts/train_sudoku_extreme.sh \
  --top-puzzles-by-rating 25 \
  --limit-puzzles 0 \
  --min-rating 80 \
  --op-epochs 1 \
  --value-epochs 1
```

To train the GNN value path instead of the transformer value path, add:

```bash
  --value-arch gnn
```

This pipeline does:

1. stream the CSV dataset
2. export structured manifests
3. pack them into tensor shards
4. train the op/value models
5. export browser-local ONNX artifacts

## Important files

- [sudoku.html](/Users/avirajkhare/hack2/transformers/transformer-in-notion/sudoku.html) - final Sudoku page
- [app.mjs](/Users/avirajkhare/hack2/transformers/transformer-in-notion/app.mjs) - UI wiring and live board/model updates
- [logic/sudoku.mjs](/Users/avirajkhare/hack2/transformers/transformer-in-notion/logic/sudoku.mjs) - exact Sudoku runtime, trace generation, guided solve path
- [logic/executor.mjs](/Users/avirajkhare/hack2/transformers/transformer-in-notion/logic/executor.mjs) - prompt/program/tool-call artifact builder
- [soduku/model-worker.mjs](/Users/avirajkhare/hack2/transformers/transformer-in-notion/soduku/model-worker.mjs) - guided model worker with explicit transformer, regret-transformer, and GNN selection
- [soduku/model.mjs](/Users/avirajkhare/hack2/transformers/transformer-in-notion/soduku/model.mjs) - structured op/value model loading
- [soduku/value-model.mjs](/Users/avirajkhare/hack2/transformers/transformer-in-notion/soduku/value-model.mjs) - structured value-model loading and `Auto / Transformer / GNN` routing
- [soduku/structured-onnx.mjs](/Users/avirajkhare/hack2/transformers/transformer-in-notion/soduku/structured-onnx.mjs) - ONNX Runtime setup for structured state tensors
- [soduku/structured_transformer_common.py](/Users/avirajkhare/hack2/transformers/transformer-in-notion/soduku/structured_transformer_common.py) - shared structured transformer/GNN training/export utilities
- [soduku/meta.md](/Users/avirajkhare/hack2/transformers/transformer-in-notion/soduku/meta.md) - meta pattern and runtime philosophy
- [docs/paper-idea-problem-shaped-vms.md](/Users/avirajkhare/hack2/transformers/transformer-in-notion/docs/paper-idea-problem-shaped-vms.md) - paper note for PSVMs
- [weiqi/psvm5x5.mjs](/Users/avirajkhare/hack2/transformers/transformer-in-notion/weiqi/psvm5x5.mjs) - exact Weiqi PSVM

## Design summary

The project’s position is:

- code is the source of truth
- exact runtimes own correctness
- custom ops beat generic machine detail for narrow tasks
- models should learn ambiguity, not replace exact semantics

That is the whole bet.
