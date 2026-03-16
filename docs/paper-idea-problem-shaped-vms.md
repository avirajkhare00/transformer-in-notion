# Paper Idea: Problem-Shaped Virtual Machines for Local Transformer Executors

## Working title

**Problem-Shaped Virtual Machines: Exact Local Transformer Execution for Sudoku and Small Web Apps**

## One-line claim

Instead of asking a transformer to jump directly from input to answer, and
instead of asking it to emulate a full general-purpose VM, we train a small
local transformer to execute the trace of a **problem-shaped virtual machine**
whose instruction set is trimmed to exactly the operations needed for one task
family.

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
applications such as rule checkers and budget planners. The full stack is
browser-local: the model runs in a Web Worker, the interpreter and verifier are
compiled to WebAssembly, and the UI streams the execution trace in real time.
We hypothesize that PSVMs offer a better tradeoff than both one-shot prediction
and full-VM execution, reducing token entropy, shortening traces, and improving
exact solve rates at fixed model size.

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

This formulation has three practical benefits:

1. **Lower entropy**
   The model only needs to choose among a few legal task-specific operations.

2. **Shorter traces**
   A trimmed instruction set means fewer irrelevant machine steps.

3. **Better local deployment**
   Smaller vocabularies and shorter traces are much better suited to browser
   inference budgets.

## Why not a full VM

Full VMs are attractive because they are universal. They are bad first targets
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
- solved/fail conditions

not to unrelated arithmetic or memory patterns.

## Problem-Shaped VM

A PSVM is a virtual machine whose instruction set is derived from the task
family instead of from general-purpose computing.

### Sudoku PSVM

Possible instruction set:

- `FOCUS_NEXT`
- `READ_CANDS`
- `TRY_VALUE`
- `PLACE`
- `UNDO`
- `BRANCH_IF_FAIL`
- `ADVANCE`
- `HALT_IF_SOLVED`
- `EMIT`

This is not a full computer. It is a compact execution substrate for depth-first
constraint search.

### Web-app PSVM

For a small rule-based browser app, the instruction set could instead be:

- `READ_FIELD`
- `PARSE_NUMBER`
- `COMPARE_LIMIT`
- `CHECK_RULE`
- `EMIT_WARNING`
- `EMIT_OK`
- `HALT`

This lets the model execute a policy or validation trace, not merely classify
the final result.

## Research question

At a fixed local model budget, is a transformer more reliable when trained to
execute a **problem-shaped VM trace** than when trained to:

1. predict the final answer directly,
2. predict the next action in raw task space, or
3. emulate a broader general-purpose VM?

## Hypothesis

We expect PSVMs to outperform the alternatives on:

- exact final solve rate
- exact step accuracy
- invalid action rate
- average trace length
- browser latency per solved instance

## System architecture

The full system has five components.

### 1. Compiler

Compiles a task instance into a PSVM program.

Examples:

- Sudoku puzzle -> search program with canonical heuristics
- form/policy config -> validation program

### 2. Deterministic interpreter

Implemented in Rust and compiled to WASM.

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

- prompt/program
- tool/runtime summary
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
- more "real world" than puzzle-only benchmarks

### Metrics

- exact output accuracy
- rule violation recall
- invalid trace rate
- latency in browser worker

## Baselines

- one-shot transformer answer prediction
- action-only policy model
- generic tiny VM execution model
- pure WASM symbolic solver
- model + external tool pipeline

The key comparison is:

**Does a PSVM provide the best accuracy-latency tradeoff for local browser
execution?**

## Why this could be publishable

The novelty is not simply "use a transformer in the browser." The novelty is
the combination of:

- task-shaped VM design
- canonical trace learning
- local browser execution
- WASM-based teacher/verifier
- exact-task evaluation beyond toy arithmetic

The conceptual contribution is:

**problem-specific execution substrates are a better target for local neural
executors than both direct solution prediction and full machine emulation.**

## Main technical deliverables

- PSVM specification for Sudoku
- PSVM specification for at least one web-app task family
- Rust/WASM interpreters
- canonical trace dataset generators
- local transformer executor in a Web Worker
- static browser demos

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
If the task is a small rule-checking web app, do not make the model learn an
entire VM.

Only expose the operations the task actually needs.

That is the core of the idea.

## Proposed paper structure

1. Introduction
2. Why one-shot local models fail on exact tasks
3. Problem-shaped virtual machines
4. Sudoku PSVM
5. Web-app PSVMs
6. Browser-local architecture with WASM + Web Workers
7. Experiments
8. Ablations on instruction-set size
9. Limitations and future work

## Sharpest version of the thesis

If Percepta's story is:

> compile programs into a transformer executor

then this paper's story is:

> for local browser execution, compile the problem into the smallest VM that is
> still sufficient, then train the transformer on that canonical execution
> substrate.

That is the specific idea worth pushing.
