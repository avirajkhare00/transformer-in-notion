# PSVM Runtime and Trace Semantics

## Status

This document is a **yellow-paper-style companion spec** to
[Problem-Shaped Virtual Machines for Exact Local Transformer Execution](/Users/avirajkhare/hack2/transformers/transformer-in-notion/docs/paper-idea-problem-shaped-vms.md).
It is not a universal VM standard. It specifies the common execution contract
used by the PSVM runtimes in this repository.

The paper argues **why** this architecture is useful.
This document defines **what must hold** for a conforming PSVM runtime,
canonical trace, and model interface.

## 1. Scope

This spec covers:

- PSVM runtime responsibilities
- legal action surfaces
- canonical trace requirements
- verifier and rollback behavior
- model/runtime interaction
- resolver interaction for structured extraction tasks

This spec does not attempt to define:

- a universal opcode set across all domains
- arbitrary program execution semantics
- model training procedures
- benchmark methodology

## 2. Design Goal

A PSVM MUST expose the smallest executable substrate whose legal actions still
match the true state transitions of a task family.

In this repository, the guiding rule is:

`trim the machine to the problem`

## 3. Conformance Model

A system is conforming if it provides:

1. an exact runtime
2. a legal action generator
3. a canonical state or trace representation
4. a verifier for proposed actions
5. deterministic application of accepted actions

Optional layers may add:

- a learned branch/value model
- a deterministic resolver over ranked candidates
- browser-local worker execution
- WASM acceleration for exact runtime steps

## 4. Terms

### 4.1 Exact runtime

The deterministic task implementation that owns legality, state transition, and
failure behavior.

### 4.2 PSVM state

The smallest structured state required to evaluate and apply legal task actions.

### 4.3 Legal action

An action the runtime can prove admissible from the current state.

### 4.4 Canonical trace

A serialized sequence of states, actions, decisions, and failures emitted under
fixed ordering and tie-breaking rules.

### 4.5 Teacher

The exact policy or heuristic used to emit reference traces or ranked legal
choices.

### 4.6 Student

The learned component that scores legal branches, candidates, or states.

### 4.7 Resolver

A deterministic search-and-scoring layer that chooses a globally consistent
field configuration from top-ranked candidates.

## 5. Core Invariants

A conforming PSVM system MUST satisfy all of the following:

- The runtime remains the source of truth for legality.
- The model MUST NOT create new legal actions outside the runtime surface.
- The verifier MUST be able to reject an illegal proposal without corrupting
  state.
- Equivalent executions SHOULD serialize to the same canonical trace.
- Rollback or failure MUST be explicit when the task includes search.
- The emitted final result MUST be reproducible from the exact runtime path.

## 6. Execution Contract

The common execution loop is:

`task instance -> exact PSVM state -> legal action frontier -> model or heuristic scoring -> exact verification -> state transition -> new state`

The minimum runtime API is:

- `initialize(task_instance) -> state`
- `enumerate_legal_actions(state) -> actions[]`
- `score_or_rank_optional(state, actions[]) -> scored_actions[]`
- `verify(state, action) -> accepted | rejected`
- `apply(state, action) -> new_state`
- `halt?(state) -> boolean`

Search-shaped PSVMs MUST also define:

- `fail(state) -> failure_record`
- `rollback(state, frame) -> restored_state`

## 7. State Requirements

PSVM state MUST include enough information to:

- enumerate legal actions
- verify a proposed action
- detect halt or contradiction
- serialize a canonical decision record

State MAY include cached derived fields if they are deterministic functions of
the underlying exact state.

State SHOULD avoid:

- irrelevant machine scaffolding
- broad memory abstractions unrelated to the task
- latent hidden fields that change semantics without appearing in traces

## 8. Legal Action Surface

Each PSVM MUST define a task-shaped legal action surface.

Examples in this repository:

- Sudoku: `place`, `fail`, `undo`, branch ordering over legal placements
- Invoice total extraction: choose among legal money candidates
- Tally extraction: choose among legal field candidates within a voucher schema

The legal action surface SHOULD be:

- semantically small
- human-interpretable
- enumerable at runtime
- stable under canonical ordering

## 9. Canonical Trace Semantics

Canonical traces are required whenever the runtime emits state/decision records
for training, replay, or UI rendering.

Canonical traces MUST define:

- deterministic ordering of legal candidates
- deterministic tie-breaking
- stable field names or op names
- explicit failure or rollback records when applicable

Canonical traces SHOULD minimize:

- redundant machine detail
- serialization noise
- equivalent but differently ordered records

## 10. Verification and Rollback

The runtime verifier MUST be exact.

For any proposed action:

- if legal, it MAY be applied
- if illegal, it MUST be rejected without mutating state

If the task includes search:

- contradictions MUST be explicit
- rollback targets MUST be well-defined
- failure records SHOULD be inspectable in the trace

## 11. Model Interface

The learned component is advisory.

It MAY do one of the following:

- rank legal actions
- estimate value over legal PSVM states
- rank field candidates
- rank candidate configurations before exact resolution

It MUST NOT:

- bypass runtime legality
- mutate runtime state directly
- invent unsupported actions

The preferred interface in this repository is:

`exact state + legal frontier -> scores over legal continuations`

This is preferred over:

- final-answer generation
- free-running next-op generation without verification
- broad VM emulation

## 12. Resolver Interface

Structured extraction PSVMs MAY use a deterministic resolver after model
ranking.

When present, the resolver:

- consumes top-k field candidates
- scores joint configurations
- applies hard or soft consistency rules
- returns the best valid or least-bad configuration

The resolver MUST operate only on runtime-approved candidate sets.

The resolver SHOULD expose debug artifacts:

- chosen configuration score
- violations
- alternatives
- margin between best and second-best configuration

## 13. Browser and WASM Considerations

Browser-local execution is a first-class deployment target for this repository.

A conforming browser-local PSVM implementation SHOULD:

- keep the exact runtime inspectable
- stream trace or state updates to the UI
- make model/runtime boundaries visible
- keep the verifier in exact code

WASM is an allowed implementation strategy for the exact runtime. It is a
deployment optimization, not a semantic requirement of the PSVM abstraction.

## 14. Domain Instantiations

### 14.1 Sudoku

- runtime owns legality, contradictions, and backtracking
- model ranks ambiguous placements or estimates state value
- exact solver remains authoritative

### 14.2 Invoice total extraction

- runtime enumerates legal money candidates
- model ranks total vs non-total
- exact runtime emits the selected total

### 14.3 Tally voucher extraction

- runtime selects voucher family and schema
- runtime enumerates legal field candidates
- model ranks field candidates
- resolver enforces global consistency
- exact runtime emits the final Tally-shaped record

## 15. Non-Claims

This spec does not claim:

- that one PSVM fits every domain
- that current models replace exact runtimes
- that arbitrary code execution should be reduced to one shared PSVM
- that a broader VM target is never useful

## 16. Open Work

The current repository still needs stronger cross-domain standardization for:

- common state-record schemas
- canonical trace versioning
- model confidence contracts
- conformance tests across runtimes
- benchmark baselines against non-PSVM formulations

## 17. Practical Reading Order

For readers of the repository:

1. read the implementation paper in
   [paper-idea-problem-shaped-vms.md](/Users/avirajkhare/hack2/transformers/transformer-in-notion/docs/paper-idea-problem-shaped-vms.md)
2. read the domain examples in
   [use-case-matrix.md](/Users/avirajkhare/hack2/transformers/transformer-in-notion/docs/use-case-matrix.md)
3. use this spec as the normative reference for shared PSVM contracts
