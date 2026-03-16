# Paper Idea: Problem-Shaped Virtual Machines for Local Transformer Executors

## Working title

**Problem-Shaped Virtual Machines: Exact Local Transformer Execution for Sudoku and Small Web Apps**

## One-line claim

Instead of asking a transformer to jump directly from input to answer, and
instead of asking it to emulate a full general-purpose machine, train it to
execute the trace of a **problem-shaped virtual machine (PSVM)** whose
instruction set is trimmed to exactly the operations one task family needs.

The hypothesis is that this narrower execution surface makes exact local
computation feasible in the browser for problems like Sudoku and other small
rule-based applications.

## Why problem-shaped VMs are needed

Problem-shaped VMs are needed because the two default formulations for exact
tasks both land at the wrong abstraction layer.

One-shot prediction asks the model to jump from input to answer while hiding the
intermediate state transitions that exact computation depends on.

Full-machine execution asks the model to reproduce a great deal of machine
behavior that is irrelevant to the task family at hand: generic memory
mechanics, broad instruction surfaces, operand encoding overhead, and control
flow that the domain never needs explicitly.

For small browser-local systems, both choices are wasteful.

What is needed instead is a substrate that is:

- expressive enough to represent the task's real transitions
- narrow enough to keep traces short and supervision clean
- exact enough to admit deterministic verification
- small enough to run inside browser latency and memory budgets

That substrate is a **problem-shaped VM**.

## Code as source of truth

The project treats code and runtime behavior as authoritative.

The runtime defines:

- what a legal step is
- when a branch has failed
- when rollback is required
- what the correct output means

The model is trained against the trace emitted by that runtime. So the learned
layer lives on top of exact code instead of replacing it.

The operative pattern is:

`state -> model -> next VM token -> exact runtime -> new state`

not:

`state -> model -> unverifiable answer`

In short:

`not one-shot answer`

`not full machine simulation`

`but task-shaped execution`

## Abstract

Language models are often evaluated on exact tasks by asking for one-shot
answers or by delegating computation to an external tool. Both formulations are
poor fits for small local models. One-shot prediction hides the intermediate
state transitions needed for exact computation, while tool use moves the
computation outside the model. We propose an intermediate path: compile a task
into a **problem-shaped virtual machine (PSVM)** with a small, task-specific
instruction set, generate canonical execution traces with a deterministic
interpreter, and train a local transformer to autoregressively emit the next
trace token. We instantiate this idea for Sudoku and other small rule-based
applications such as invoice calculators and rule checkers. The full stack is
browser-local: the model runs in a Web Worker, the interpreter and verifier are
compiled to WebAssembly or implemented as exact local runtimes, and the UI
streams the execution trace in real time. We hypothesize that PSVMs offer a
better tradeoff than both one-shot prediction and full-VM execution, reducing
token entropy, shortening traces, and improving exact solve rates at fixed model
size.

## Systems intuition

The motivating systems picture is simple:

**transformers are better viewed as append-only execution machines than as
mutable RAM machines.**

A conventional computer works like:

`state + instruction -> mutated state`

An autoregressive transformer works more like:

`trace_t -> trace_t+1`

It does not mutate old state records. It appends new ones. Earlier tokens remain
fixed, and the next token reconstructs the current state by reading the right
pieces of prior history.

That makes the useful mental model much closer to:

- append-only state evolution
- functional-style state extension
- dataflow-like dependency resolution over prior values

than to direct in-place memory mutation.

### Attention as state retrieval

In this framing, attention plays the role of structured state lookup.

The next token does not read from a mutable register file. It retrieves the
prior tokens that encode the relevant machine state. In ordinary language
generation this retrieval is soft and approximate. In an executor setting, the
goal is to make it behave like exact or near-exact address resolution over a
canonical trace.

That suggests a useful equivalence:

- tokens are state-bearing records
- attention is state retrieval
- the generated trace is serialized execution history

### Why this matters for VM design

If the model reconstructs state from prior trace records, then the instruction
set matters enormously. A full general-purpose VM forces the model to spend
capacity on machine behavior that many tasks do not need. A problem-shaped VM
keeps the trace vocabulary small and forces the model to learn only the
task-relevant composition logic.

## Core idea

The paper is built around one structural claim:

**The right abstraction layer for local transformer execution is not "the full
problem" and not "a full machine." It is a task-specific execution substrate.**

That means:

- not `Sudoku board -> solved board`
- not `natural language -> final answer`
- not `full WebAssembly -> transformer`

Instead:

- `task instance -> PSVM program`
- `PSVM program -> canonical execution trace`
- `transformer -> next trace token`

## Why this matters

This formulation has four practical benefits:

1. **Lower entropy**  
   The model only needs to choose among a few legal task-specific operations.

2. **Shorter traces**  
   A trimmed instruction set means fewer irrelevant machine steps.

3. **Better local deployment**  
   Smaller vocabularies and shorter traces are much better suited to browser
   inference budgets.

4. **Cleaner supervision**  
   Canonical traces make it easier to train the model on exact state transitions
   rather than weak final-answer targets.

## Why not a full VM

Full VMs are attractive because they are universal. They are poor first targets
for local execution because they introduce irrelevant complexity.

## What is inspiring, and what should be narrowed

Two ideas are especially inspiring in the broader executor direction:

1. **compiling program logic into model weights**
2. **making long execution traces feasible with logarithmic-style attention
   retrieval rather than linear scans**

Those are real architectural unlocks.

But they do not imply that the best first deployment target for a local browser
system is:

`arbitrary C -> full compiler pipeline -> general machine semantics -> weights`

For small exact web tasks, that path is usually too broad.

### Why `C -> weights` is inefficient for this setting

Compiling arbitrary C or a full general bytecode surface into weights is
powerful, but it is an inefficient first target when the task family is narrow.

It forces the system to carry:

- irrelevant machine semantics
- larger vocabularies
- longer traces
- more decoding ambiguity
- more supervision burden

If the real target is Sudoku, invoice checking, rule validation, or small board
games, most of that surface is wasted.

The local model should spend its capacity on:

- branch selection
- candidate ordering
- task-specific state transitions
- exact reversible actions

not on generic machine behavior the application never uses.

### Why custom ops and custom VMs are more efficient

The efficient compiler target for this repository is not a full machine.
It is a **problem-shaped virtual machine** with a custom op surface.

That gives a much tighter path:

`task -> custom ops -> PSVM -> canonical trace -> local transformer`

instead of:

`task -> general program -> full VM semantics -> larger trace -> local transformer`

This is the main thesis:

- general compiler-to-weights is inspiring
- logarithmic executor-style attention is inspiring
- but the practical browser path is to **shrink the machine to the problem**

That is why this repo keeps returning to:

- smallest sound ISA
- exact deterministic runtime
- custom ops derived from the task
- model capacity spent on ambiguity, not on general machine simulation

### Full WASM is too broad for the first model

- large instruction surface
- stack and memory semantics that many tasks never need
- much longer traces
- harder constrained decoding

### A generic tiny VM is better, but still not ideal

A generic stack VM is a solid stepping stone, but it still teaches the model
operations that some domains do not need.

If the target domain is Sudoku, most of the model budget should go to:

- candidate-set reasoning
- cell selection
- branching
- undo
- solved and fail conditions

not to unrelated arithmetic or memory patterns.

## Why not compile C directly into weights first

Compiling arbitrary programs or even arbitrary `C -> VM -> weights` is an
inspiring long-term direction. It is also the wrong first efficiency target for
small browser-local systems.

The problem is not expressiveness. A general compiler-to-weights path is
maximally expressive. The problem is that it preserves too much machine detail
that a single task family does not need.

For browser-local executors, a general compiled path usually carries:

- a broad instruction surface
- operand and addressing overhead
- stack or memory mechanics unrelated to the task
- calling-convention and control-flow detail that expands traces
- more verifier and runtime machinery than the task actually needs

That makes the learned surface inefficient. The model spends capacity on
emulating the scaffolding of a general machine instead of the decisions that
actually matter for the domain.

The more efficient first path is:

`rules + ambiguity -> custom VM + custom ops + exact local runtime`

In this formulation:

- **rules** stay in a deterministic interpreter or WASM kernel
- **ambiguity** lives at the op-selection boundary
- **custom ops** collapse many irrelevant low-level steps into a single
  domain-meaningful transition
- **the transformer** only needs to emit the next useful op, not reproduce a
  whole generic machine trace

So the claim is not that compiler-to-weights is uninteresting. It is that for
task-shaped browser systems, **custom ops on a custom VM are the efficient
intermediate layer**.

That is the main systems bet of this repository.

## Problem-Shaped VMs

A PSVM is a virtual machine whose instruction set is derived from the task
family instead of from general-purpose computing.

### VM family choices

Not every VM family is equally useful for local transformer execution.

- **stack VMs** are the best first generic executor target because the opcode
  surface stays small and operand movement is implicit
- **register VMs** are better when explicit named data flow matters, but they
  expand the token/action space
- **object or state-transition VMs** fit web apps and ledger-like tasks well
  because legal steps are phase-based and easy to verify
- **graph or dataflow VMs** fit routing, matching, and dependency problems
  where state is naturally node-edge based
- **constraint or rule VMs** fit Sudoku, SAT, and CSP-style tasks where
  candidate propagation and undo are first-class semantics
- **full bytecode VMs** are attractive long-term, but they are usually the
  wrong first target because they force the model to learn too much irrelevant
  machine behavior

The practical takeaway is:

`pick the smallest VM family that matches the task's real state transitions`

This repository now spans three of these families already:

- generic stack VM in `docs/executor-v1-spec.md`
- object/state-transition PSVM in `invoice/`
- constraint/search PSVM in `soduku/`

### Sudoku PSVM

Possible instruction set:

- `FOCUS_NEXT`
- `READ_CANDS`
- `PLACE`
- `UNDO`
- `FAIL`
- `HALT`

This is not a full computer. It is a compact execution substrate for depth-first
constraint search.

### Invoice-calculator PSVM

For a small browser-side invoice calculator, the instruction set can instead be:

- `READ_ITEM`
- `LINE_TOTAL`
- `ADD_SUBTOTAL`
- `APPLY_TAX`
- `EMIT_TOTAL`
- `HALT`

This lets the model execute a business-calculation trace, not merely classify
the final answer.

For a broader taxonomy of VM families and where each one fits, see:

- `docs/vm-design-space.md`

## Current repository prototypes

This repository now contains two concrete deterministic prototypes of the idea.

### Prototype A: Invoice-calculator PSVM

Implemented under `invoice/`:

- `invoice/psvm.mjs`
- `invoice/worker.mjs`
- `invoice/index.html`

This prototype shows that the idea is not puzzle-specific. Its instruction set
is shaped around a small business-calculation workflow and also streams a
canonical trace from a Web Worker into a browser UI.

The point is the same in both cases: expose only the exact operations the task
needs, then generate and inspect a canonical execution trace in the browser.

The repository also now includes the first student-model path for this domain:

- `invoice/export_dataset.mjs` for synthetic next-op supervision
- `invoice/train_transformer.py` for a tiny next-op classifier

That is still narrower than full trace generation, but it is the first concrete
learned executor step on top of the deterministic PSVM.

### Prototype B: Sudoku PSVM

Implemented under `soduku/`:

- `soduku/psvm4x4.mjs`
- `soduku/worker.mjs`
- `soduku/index.html`

This prototype uses a limited instruction surface for 4x4 Sudoku and streams the
canonical trace from a Web Worker into a browser UI.

It is not yet transformer-backed. It is the deterministic PSVM substrate and
trace generator that a local model would later learn to imitate or drive.

## Minimum VM stack

For this project, the **minimum VM stack** means the smallest end-to-end system
that makes a task-shaped executor claim honest.

It has six layers:

1. **Minimal model-facing op set**  
   The task is expressed in the smallest executable vocabulary that still
   preserves future-state changes.

2. **Deterministic teacher runtime**  
   An exact interpreter or runtime executes those ops without model
   approximation.

3. **Canonical trace generator**  
   The runtime emits a stable trace under fixed ordering and tie-breaking rules.

4. **Browser execution path**  
   The trace can be streamed in a Web Worker and visualized in a static web app.

5. **Student supervision path**  
   The teacher can generate a supervised dataset for at least one learned target.

6. **Student runtime path**  
   A local model can be loaded and wired into the browser execution loop, even if
   the exact runtime still remains the verifier or fallback.

Anything beyond this, such as full argument-level trace generation, fully
student-driven execution, or large puzzle scaling, is beyond the minimum stack.

## Repository verification checklist

The checklist below separates what is already verified in this repository from
what remains open.

### Invoice PSVM

- [x] Minimal model-facing op set defined
  - `READ_ITEM`, `LINE_TOTAL`, `ADD_SUBTOTAL`, `APPLY_TAX`, `EMIT_TOTAL`, `HALT`
- [x] Deterministic teacher runtime implemented
  - `invoice/psvm.mjs`
- [x] Canonical trace generation implemented
- [x] Browser Web Worker execution implemented
  - `invoice/worker.mjs`
- [x] Browser UI streams the trace
  - `invoice/index.html`, `invoice/app.mjs`
- [x] Reduced-op sample trace verified
  - sample run uses only the intended six ops
  - sample run completes in 12 trace events
- [x] Student dataset generation implemented
  - `invoice/export_dataset.mjs`
- [x] Student training path implemented
  - `invoice/train_transformer.py`
- [x] Student training smoke test verified
  - reduced-op smoke run on CPU reached `0.9862` eval accuracy
  - dataset size in the smoke run: `128` invoices -> `1455` next-op samples
- [x] Browser student runtime wiring implemented
  - `invoice/model.mjs` and hybrid logic in `invoice/worker.mjs`
- [x] Browser student model bundle shipped in repo
  - `invoice/models/invoice-op-bert/`
  - exported metadata: `5985` samples, `5387` train, `598` eval, `1.0000` eval accuracy
- [ ] End-to-end browser student inference verified with shipped weights
- [ ] Student predicts full argument-level trace, not just next op
- [ ] Student executes the task without teacher fallback or verifier support

### Sudoku PSVM

- [x] Minimal model-facing op set defined
  - `FOCUS_NEXT`, `READ_CANDS`, `PLACE`, `UNDO`, `FAIL`, `HALT`
- [x] Deterministic teacher runtime implemented
  - `soduku/psvm4x4.mjs`
- [x] Canonical trace generation implemented
- [x] Browser Web Worker execution implemented
  - `soduku/worker.mjs`
- [x] Browser UI streams the trace
  - `soduku/index.html`, `soduku/app.mjs`
- [x] Reduced-op sample trace verified
  - default 4x4 sample solves successfully
  - sample trace length is 28 events
  - the default puzzle exercised `FOCUS_NEXT`, `READ_CANDS`, `PLACE`, and `HALT`
- [x] Runtime supports `UNDO` and `FAIL` when search branches require them
- [ ] Student dataset generation implemented
- [ ] Student training path implemented
- [ ] Student training smoke test verified
- [ ] Browser student runtime wiring implemented
- [ ] Browser student model bundle shipped in repo
- [ ] End-to-end browser student inference verified with shipped weights

### Cross-cutting interpretation

What is already proven:

- the task-shaped VM idea can be implemented with a genuinely smaller
  model-facing vocabulary
- the reduced vocabulary still preserves exact task semantics under a
  deterministic teacher runtime
- the full browser-side teacher path works for both a puzzle domain and a small
  business-calculation domain
- at least one domain, invoice, already has a real student path for next-op
  learning and a shipped local model bundle

What is not yet proven:

- that the student can replace the teacher in-browser end to end
- that the student can emit full traces with arguments, not just op labels
- that the same training path scales from invoice to Sudoku cleanly
- that the minimum stack remains sufficient for harder 9x9 Sudoku instances

## Research question

At a fixed local model budget, is a transformer more reliable when trained to
execute a **problem-shaped VM trace** than when trained to:

1. predict the final answer directly
2. predict the next action in raw task space
3. emulate a broader general-purpose VM

## Hypothesis

We expect PSVMs to outperform the alternatives on:

- exact final solve rate
- exact step accuracy
- invalid action rate
- average trace length
- browser latency per solved instance

## System architecture

The full system has five components.

### 1. Compiler or normalizer

Compiles or normalizes a task instance into a PSVM program.

Examples:

- Sudoku puzzle -> search program with canonical heuristics
- invoice JSON -> canonical calculation program

### 2. Deterministic interpreter

Implemented in Rust/WASM or as an exact local runtime.

Used for:

- trace generation
- ground-truth execution
- optional browser verification

### 3. Trace generator

Produces canonical traces for training.

Canonicalization matters:

- fixed instruction order
- fixed tie-breaking
- fixed branch ordering
- fixed emission format

### 4. Local transformer executor

Runs in the browser inside a Web Worker.

Input:

- PSVM program tokens
- previous trace tokens

Output:

- next trace token

### 5. Browser UI

Static web app that streams:

- prompt or program
- tool or runtime summary
- readable log
- token trace
- state visualization

## Why the browser matters

This is not only a modeling paper. It is also a systems paper about practical
local execution.

The browser setup matters because it forces the right constraints:

- no server-side tool dependency
- limited latency budget
- limited memory budget
- explicit trace rendering
- deployable as a static web app

This is exactly the environment where generic LLM orchestration often feels too
heavy, but one-shot small models are too weak.

## Proposed experiments

## Domain A: Sudoku

### Formulations to compare

1. `board -> solved board`
2. `board -> next move`
3. `board -> canonical next PSVM trace token`
4. `board -> generic tiny VM trace token`

### Metrics

- solved board accuracy
- exact step accuracy
- contradiction rate
- illegal trace token rate
- average backtracks
- average trace length
- latency in browser

### Difficulty bands

- 4x4 Sudoku
- easy 9x9
- medium 9x9
- hard 9x9

## Domain B: Small web apps

Use deterministic browser-native tasks such as:

- invoice total checker
- travel allowance validator
- budget cap planner
- scheduling slot finder

These tasks are useful because they are:

- exact
- small
- user-facing
- more real-world than puzzle-only benchmarks

### Metrics

- exact output accuracy
- rule violation recall
- invalid trace rate
- latency in browser worker

## Baselines

- one-shot transformer answer prediction
- action-only policy model
- generic tiny VM execution model
- pure symbolic solver
- model plus external tool pipeline

The key comparison is:

**Does a PSVM provide the best accuracy-latency tradeoff for local browser
execution?**

## Why this could be publishable

The novelty is not simply "use a transformer in the browser." The novelty is
the combination of:

- task-shaped VM design
- canonical trace learning
- local browser execution
- worker-based streaming UI
- exact-task evaluation beyond toy arithmetic

The conceptual contribution is:

**problem-specific execution substrates are a better target for local neural
executors than both direct solution prediction and full machine emulation.**

## Failure modes

This approach can still fail if:

- traces are not canonical enough
- the instruction set is still too broad
- the task requires too much hidden state
- the model learns surface regularities instead of execution semantics
- browser inference is too slow for long traces

## Key design principle

The paper should insist on one point:

**Trim the machine to the problem.**

If the task is Sudoku, do not make the model learn an entire VM.
If the task is a small rule-checking or calculation app, do not make the model
learn an entire VM.

Only expose the operations the task actually needs.

That is the core of the idea.

## Proposed paper structure

1. Introduction
2. Why one-shot local models fail on exact tasks
3. Append-only execution and attention as state retrieval
4. Problem-shaped virtual machines
5. Sudoku PSVM
6. Web-app PSVMs
7. Browser-local architecture with Web Workers and exact runtimes
8. Experiments
9. Ablations on instruction-set size
10. Limitations and future work

## Sharpest version of the thesis

If a general executor story is:

> compile programs into a transformer executor

then this paper's story is:

> for local browser execution, compile the problem into the smallest VM that is
> still sufficient, then train the transformer on that canonical execution trace
