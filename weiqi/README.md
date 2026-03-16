# Weiqi

This directory holds the first Go/Weiqi-shaped PSVM prototype in the repo.

The scope is intentionally narrow:

- `5x5` board
- local capture problems, not full 19x19 game scoring
- deterministic worker-side search
- tiny visible op set:
  - `PLAY`
  - `CAPTURE`
  - `UNDO`
  - `PASS`
  - `HALT`

## Why this is the right first target

Go is a bad first benchmark if framed as:

- full 19x19 policy play
- full scoring
- full opening and joseki knowledge
- a browser toy pretending to be an engine

It is a good first benchmark if framed as:

- exact local rules
- small-board capture tactics
- short proof traces
- a compact problem-shaped VM

That keeps the surface honest. The VM only exposes move-level state transitions
while the engine underneath remains responsible for:

- chain detection
- liberty counting
- capture removal
- suicide rejection
- simple ko prevention

## Current prototype

- `index.html` - standalone browser demo
- `app.mjs` - UI wiring
- `worker.mjs` - worker-side deterministic search loop
- `psvm5x5.mjs` - 5x5 rules engine, bounded capture solver, and PSVM trace

## Current goal

Each preset is a bounded local capture problem:

- one side to move
- one marked target chain
- one fixed ply horizon
- exact legality rules
- success only if the target chain is removed inside that horizon

This is not a full game engine. It is a deliberately task-shaped capture VM.

## Next logical step

If this direction stays, the next honest upgrade is:

- add a held-out 5x5 capture dataset
- train a next-op student on `PLAY / PASS / HALT`
- keep `CAPTURE` as deterministic executor output

That would make Weiqi line up with the other PSVM examples in the repo.
