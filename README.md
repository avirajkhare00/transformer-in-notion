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

The repo currently centers on two browser-local game tasks and two browser-local document tasks:

- [sudoku.html](/Users/avirajkhare/hack2/transformers/transformer-in-notion/sudoku.html)
  Exact 9x9 Sudoku solve with:
  - exact browser-side runtime
  - deterministic backtracking
  - local guided branch ranking with `Auto`, `Transformer`, `Transformer (Regret)`, `Transformer (Hard)`, or `GNN` selection
  - visible trace and model stats

- [weiqi/index.html](/Users/avirajkhare/hack2/transformers/transformer-in-notion/weiqi/index.html)
  5x5 Weiqi capture PSVM with exact local rules.

- [invoice/README.md](/Users/avirajkhare/hack2/transformers/transformer-in-notion/invoice/README.md)
  OCR receipt total extraction with:
  - exact money-candidate extraction from structured `pdftotext -tsv` rows
  - layout-aware cues such as right-edge alignment and cue-before-amount position
  - deterministic teacher ranking over legal total branches
  - a local transformer that scores `TOTAL` vs `NOT_TOTAL` candidates
  - explicit rejection of account-statement style documents with running balances
  - a browser demo at [receipt.html](/Users/avirajkhare/hack2/transformers/transformer-in-notion/receipt.html)

- [tally/README.md](/Users/avirajkhare/hack2/transformers/transformer-in-notion/tally/README.md)
  Tally-style voucher extraction with:
  - voucher-family classification and schema selection
  - schema-aligned field candidate extraction from OCR/layout
  - shared invoice fields plus industry extensions for pharma, medical, trading, and stockist flows
  - deterministic-first PSVM emission of Tally-shaped records, with an optional tiny local transformer for field selection
  - a browser demo at [tally.html](/Users/avirajkhare/hack2/transformers/transformer-in-notion/tally.html)

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
- PSVM-style OCR receipt total extraction and candidate ranking under `invoice/`
- synthetic OCR receipt dataset export and local total-selector training
- Tally-style voucher-family classification and schema-aligned field extraction under `tally/`
- a browser demo for Tally-shaped OCR extraction at `tally.html`

What is not claimed yet:

- pure free-running model-only 9x9 Sudoku solving
- model outperforming the deterministic reference policy
- a general-purpose compiled-code-to-weights system

## Invoice / OCR Receipts

The invoice lane now follows the same repo thesis as Sudoku:

`OCR text -> legal money candidates -> model ranks branches -> exact runtime emits total`

That means the model is not asked to invent the receipt total end-to-end. It only scores legal candidates extracted by the runtime.

In short:

- AI/ML view: a constrained candidate-ranking problem over extracted money spans
- layman view: collect all amount-looking numbers, then pick the one that most looks like the final total
- main limitation: this is invoice/receipt-shaped, not a general parser for arbitrary tables or account statements

See [invoice/README.md](/Users/avirajkhare/hack2/transformers/transformer-in-notion/invoice/README.md) for the detailed runtime, training, and browser flow.

## Tally / Voucher Extraction

The Tally lane follows a broader document-extraction PSVM:

`OCR/layout -> voucher family -> schema -> legal field candidates -> exact runtime emits Tally-shaped record`

That means the system is not trying to hallucinate a full accounting document from raw OCR text. It first narrows the document family, then only fills fields that the selected voucher schema allows. See [tally/README.md](/Users/avirajkhare/hack2/transformers/transformer-in-notion/tally/README.md) for the schema, browser demo, and current limitations.

In short:

- AI/ML view: constrained information extraction over voucher families and field candidates
- layman view: detect the document type, look for the likely invoice fields, and fill a Tally-shaped record
- main limitation: the local model is still small and synthetic-data-trained, the demo expects pasted OCR/TSV rather than direct PDF conversion, and arbitrary table-heavy layouts still need more parser/constraint coverage

There is now an adversarial harness for that exact gap:

- `node scripts/evaluate_tally_harness.mjs`
- reports candidate recall, top-1 accuracy, instability, and line-item recall by failure class
- useful classes today: `candidate_missing`, `layout_drift`, `ocr_corruption`, `numeric_ambiguity`, `ranking_ambiguity`, `structural_inconsistency`

## Local development

Serve the repo root with any static file server:

```bash
.venv/bin/python -m pip install -r requirements.txt
python3 -m http.server 8000
```

Then open:

- `http://localhost:8000/sudoku.html`
- `http://localhost:8000/weiqi/`
- `http://localhost:8000/receipt.html`
- `http://localhost:8000/tally.html`

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
- [invoice/psvm.mjs](/Users/avirajkhare/hack2/transformers/transformer-in-notion/invoice/psvm.mjs) - exact invoice arithmetic PSVM
- [tally/README.md](/Users/avirajkhare/hack2/transformers/transformer-in-notion/tally/README.md) - Tally voucher extraction overview, browser flow, and limitations
- [tally/schema.mjs](/Users/avirajkhare/hack2/transformers/transformer-in-notion/tally/schema.mjs) - voucher families, core shared fields, and industry extensions
- [tally/psvm.mjs](/Users/avirajkhare/hack2/transformers/transformer-in-notion/tally/psvm.mjs) - voucher-family classifier and schema-aligned field extractor
- [invoice/total_psvm.mjs](/Users/avirajkhare/hack2/transformers/transformer-in-notion/invoice/total_psvm.mjs) - exact OCR receipt total candidate extractor and teacher ranker
- [tally.html](/Users/avirajkhare/hack2/transformers/transformer-in-notion/tally.html) - browser Tally extraction demo
- [tally/app.mjs](/Users/avirajkhare/hack2/transformers/transformer-in-notion/tally/app.mjs) - browser UI for voucher-family and field-candidate inspection
- [invoice/export_total_dataset.mjs](/Users/avirajkhare/hack2/transformers/transformer-in-notion/invoice/export_total_dataset.mjs) - synthetic OCR receipt dataset generator
- [invoice/train_total_selector.py](/Users/avirajkhare/hack2/transformers/transformer-in-notion/invoice/train_total_selector.py) - local transformer trainer for `TOTAL` vs `NOT_TOTAL`
- [scripts/predict_receipt_total.py](/Users/avirajkhare/hack2/transformers/transformer-in-notion/scripts/predict_receipt_total.py) - local inference over extracted receipt candidates
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
