# Soduku

This directory is the dedicated workspace for the Sudoku-specific execution
path. The directory name is intentionally kept as `soduku/` to match the
requested repo layout.

## Current prototype

The first concrete implementation now lives in this directory:

- `index.html` - standalone browser demo
- `app.mjs` - UI wiring for the 4x4 solver page
- `worker.mjs` - worker-side execution loop
- `psvm4x4.mjs` - 4x4 Sudoku PSVM and canonical trace generator

This is intentionally a **problem-shaped VM** prototype, not a full local
transformer yet. It proves the execution surface first:

- compact op set
- canonical trace
- browser worker execution
- inspectable state transitions

## Best first example

If the goal is **"solve Sudoku with a local transformer + custom VM"**, the best
first benchmark is not full hard 9x9 Sudoku.

The best first benchmark is:

**4x4 Sudoku with a canonical search trace**

Why:

- tiny state space
- easy to generate unlimited synthetic data
- easy to verify exactly
- short traces
- small enough for local browser inference
- still requires real execution, not just pattern matching

## Better than starting with full 9x9

Starting with full 9x9 first is a bad research loop because:

- traces get long too early
- one mistake destroys the whole solve
- search depth grows quickly
- it becomes hard to tell whether failure is due to:
  - bad tokenization
  - bad VM design
  - bad trace format
  - insufficient model size

4x4 is much cleaner for the first exact executor benchmark.

## Recommended progression

### Stage 1

`4x4 Latin square`

This is even simpler than Sudoku because it removes subgrid constraints. It is
the cleanest first proof that the custom VM and canonical trace pipeline work.

### Stage 2

`4x4 Sudoku`

Add subgrid constraints. This is the first real Sudoku-shaped executor target.

### Stage 3

`6x6 Sudoku`

Increase trace length and branching without jumping all the way to 9x9.

### Stage 4

`easy 9x9 Sudoku`

Only after the model can already execute consistent shorter traces.

### Stage 5

`hard 9x9 Sudoku`

This should be treated as the stress test, not the first milestone.

## Best task formulation

Do not train:

- `board -> solved board`

Train:

- `board/program/history -> next canonical solver action`

That means the model learns a reversible execution process.

## Hard examples

Hard 9x9 Sudokus should be treated as a **stress set**, not the only training
distribution.

Best practice:

- train mostly on a broad curriculum of valid puzzles
- keep the hardest curated puzzles as a benchmark and late-stage finetune set
- compare the same deterministic solver under different policies before
  claiming model gains

This repository now has the beginnings of that path:

- `logic/sudoku-hard.mjs` - curated hard 9x9 preset set
- `scripts/benchmark_sudoku_hard.mjs` - apples-to-apples benchmark of the same
  JS DFS solver under row-major vs MRV chooser policies
- `scripts/export_sudoku_hard_traces.mjs` - export canonical traces for the
  hard-set supervision/eval corpus
- `soduku/export_hard_dataset.mjs` - build a held-out hard-set next-op dataset
- `soduku/train_transformer.py` - train a tiny next-op student on that dataset

## Apple-to-apple comparison

The hard benchmark is now intentionally constrained to keep the comparison
honest:

- same language runtime
- same DFS backtracking solver
- same validation rules
- same puzzle set
- only the chooser policy changes

The benchmark reports both:

- search work: `placements`, `backtracks`, `deadEnds`
- policy overhead: `candidateQueries`, `chooserCellScans`

That distinction matters. On the current hard set, MRV cuts search work
massively on every puzzle, but it is still slower on wall-clock time for
`Arto Inkala 2012` because it performs many more candidate lookups than the
row-major policy. That is the kind of tradeoff we want to see before making
claims about "better" solving.

## Hard-set student

There is now a first 9x9 hard-set student path.

It is still a **next-op student**, not a full learned Sudoku executor.

What it does:

- uses the deterministic MRV solver as teacher
- exports `(context -> next op)` samples from hard traces
- splits train and eval by puzzle id, not by random trace step
- trains a tiny local classifier on that held-out split

That last part matters: random per-step splits would leak nearly identical
trace prefixes into both train and eval and give misleading numbers.

Example flow:

```bash
node soduku/export_hard_dataset.mjs --eval-puzzles ai-escargot
.venv/bin/python soduku/train_transformer.py --skip-export
```

In the smoke run used for this branch, the held-out `AI Escargot` split reached
`96.79%` eval accuracy with a tiny op classifier after the board context was
tokenized at the cell level rather than treated as one opaque string token.

## Best action space

For the first Sudoku-specific custom VM, the best action surface is:

- `FOCUS_NEXT`
- `READ_CANDS`
- `PLACE`
- `UNDO`
- `FAIL`
- `HALT`

This is much better than a generic VM for the first pass because it puts all of
the model capacity into Sudoku search behavior.

## Best first demo in browser

The strongest browser demo is:

**4x4 Sudoku executor with live trace streaming from a Web Worker**

UI:

- puzzle grid
- current focused cell
- candidate list
- action trace
- final solved board

This is better than a one-shot answer because the whole point is execution.

## One concrete recommendation

If we build only one thing next in this directory, it should be:

**`4x4 Sudoku + custom Sudoku VM + canonical trace dataset + worker-based local transformer executor`**

The current implementation completes the first half of that path: the custom VM
plus streamed worker execution. The next step is replacing the symbolic policy
with a transformer trained on the canonical PSVM trace.
