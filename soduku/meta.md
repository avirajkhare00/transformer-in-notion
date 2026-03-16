# Sudoku Meta Pattern

This directory follows one systems pattern:

```text
task state -> model -> next VM token(s) -> exact runtime -> new state
```

For Sudoku, that becomes:

```text
board + focus + candidates + short op history
-> local transformer
-> next PSVM decision
-> exact Sudoku runtime
-> updated board / backtrack / halt
```

## Core idea

We do not train the model to emit a solved Sudoku board directly.

We:

1. Define a small, task-shaped VM surface.
2. Run an exact reference solver.
3. Convert solving into a canonical trace.
4. Train on structured state snapshots instead of raw text strings.
5. Let the exact runtime keep legality and backtracking deterministic.

This keeps the model focused on ambiguity, not on generic machine detail.

## Why a problem-shaped VM

Generic compiled code is noisy for this task.

Sudoku does not need the model to learn:

- stack plumbing
- generic memory loads and stores
- compiler artifacts
- unrelated machine semantics

Sudoku does need the model to learn:

- which branch looks promising
- which value to try first
- when search is likely to backtrack

So the model-facing instruction surface should stay small.

## PSVM view

The full conceptual Sudoku PSVM is:

```text
FOCUS_NEXT
READ_CANDS
PLACE
UNDO
FAIL
HALT
```

For the current guided executor, the exact runtime still owns most of that surface.
The model mainly helps at the branch boundary by ranking legal `PLACE` values.

That means the practical runtime loop is:

```text
FOCUS_NEXT           exact
READ_CANDS           exact
rank PLACE values    model
PLACE                exact
UNDO / backtrack     exact
HALT                 exact
```

## What the model sees

The structured encoder uses state snapshots, not natural-language history.

Current features include:

- `boardTokens`
- `focusRow`
- `focusCol`
- `candidateMask`
- `historyOps`
- `filledCount`
- `searchDepth`

So the mapping is:

```text
Sudoku state -> next executable decision
```

not:

```text
Sudoku puzzle -> final answer
```

## Where backtracking lives

Backtracking is not learned as an unsafe free-form behavior.

It lives in the exact runtime:

- the model orders branch choices
- the runtime applies moves
- contradictions trigger deterministic `UNDO`
- search continues until solved or exhausted

That is the key safety property.

## Which supervision matters most

Not every op has the same value.

High-value supervision:

- `PLACE`
- `UNDO`
- `FAIL`

Lower-value supervision:

- bookkeeping-heavy focus/candidate steps

So the long-term direction is:

- weight decision-heavy states more
- reduce repetitive bookkeeping states
- keep the exact runtime as the verifier

## Repo thesis

The repo thesis is:

```text
rules + ambiguity -> custom VM + custom ops + exact browser runtime
```

For Sudoku specifically:

```text
Sudoku rules -> problem-shaped VM
ambiguous branch choice -> learned policy
exact legality + backtracking -> deterministic runtime
```

That is the pattern we want to generalize to other rule-heavy tasks.
