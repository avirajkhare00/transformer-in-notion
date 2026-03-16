# Paper Idea: Problem-Shaped Virtual Machines for Local Transformer Executors

## Working title

**Problem-Shaped Virtual Machines: Exact Local Transformer Execution for Sudoku and Small Web Apps**

## One-line claim

Instead of asking a transformer to jump directly from input to answer, and
instead of asking it to emulate a full general-purpose machine, train it to
execute the trace of a **problem-shaped virtual machine (PSVM)** whose
instruction set is trimmed to exactly the operations one task family needs.

The hypothesis is that this narrower execution surface makes exact local
computation feasible in the browser for problems like Sudoku and small
rule-based web applications.

## Abstract

Language models are often evaluated on exact tasks by asking for one-shot
answers or by delegating computation to an external tool. Both formulations are
poor fits for small local models. One-shot prediction hides the intermediate
state transitions needed for exact computation, while tool use moves the
computation outside the model. We propose an intermediate path: compile a task
into a **problem-shaped virtual machine (PSVM)** with a small, task-specific
instruction set, generate canonical execution traces with a deterministic
interpreter, and train a local transformer to autoregressively emit the next
trace token. We instantiate this idea for Sudoku and small browser-native web
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

## Problem-Shaped VMs

A PSVM is a virtual machine whose instruction set is derived from the task
family instead of from general-purpose computing.

### Sudoku PSVM

Possible instruction set:

- `LOAD_PUZZLE`
- `FOCUS_NEXT`
- `READ_CANDS`
- `TRY_VALUE`
- `PLACE`
- `UNDO`
- `ADVANCE`
- `FAIL`
- `HALT_IF_SOLVED`
- `EMIT`

This is not a full computer. It is a compact execution substrate for depth-first
constraint search.

### Invoice-calculator PSVM

For a small browser-side invoice calculator, the instruction set can instead be:

- `LOAD_INVOICE`
- `READ_ITEM`
- `PARSE_QTY`
- `PARSE_PRICE`
- `MUL_LINE_TOTAL`
- `ADD_SUBTOTAL`
- `APPLY_TAX`
- `EMIT_TOTAL`
- `HALT`

This lets the model execute a business-calculation trace, not merely classify
the final answer.

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

If Percepta's story is:

> compile programs into a transformer executor

then this paper's story is:

> for local browser execution, compile the problem into the smallest VM that is
> still sufficient, then train the transformer on that canonical execution trace
