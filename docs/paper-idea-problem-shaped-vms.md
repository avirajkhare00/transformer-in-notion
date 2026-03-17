# Problem-Shaped Virtual Machines for Exact Local Transformer Execution

**Aviraj Khare**  
Email: `avirajkhare00@gmail.com`  
X: `@avirajkhare00` (`x.com/avirajkhare00`)

## Abstract

Small local transformers are poorly matched to exact tasks when the only choices
are one-shot answer prediction or full general-purpose machine emulation.
One-shot prediction hides the intermediate state transitions that exact
computation depends on. Full-machine execution preserves far more semantics than
most narrow tasks actually need: memory plumbing, broad instruction surfaces,
and control flow that is irrelevant to the application. This note argues for an
intermediate target: **problem-shaped virtual machines (PSVMs)**. A PSVM is the
smallest executable substrate whose legal actions match the real state
transitions of a task family. The exact runtime remains the source of truth: it
defines legality, emits canonical traces, verifies proposed actions, and owns
rollback or failure handling. The model learns only to evaluate the ambiguous
frontier of execution. This repository already contains several pieces of that
stack,
including exact browser-local Sudoku runtimes, worker-driven trace streaming,
structured model training paths, and a small invoice-calculation PSVM. The
strongest current claim is not that the model can replace the runtime, but that
the smallest sound VM for a task is a better local training target than either
direct answer prediction or full machine emulation.

## One-Sentence Thesis

For narrow exact tasks, the right target for a local model is usually not the
final answer and not a full machine trace, but state evaluation over the
smallest executable VM whose legal actions already match the task's true state
transitions.

## 1. Motivation

Exact tasks are common in browser software: puzzle solving, rule checking,
pricing, validation, scheduling, and other deterministic workflows. These tasks
have two properties that matter here.

First, they have a real notion of correctness. A step is legal or illegal. A
branch is valid or contradictory. The final output either satisfies the rules or
it does not.

Second, they often have a much smaller semantic surface than a general-purpose
machine. A Sudoku solver does not need arbitrary pointer arithmetic. A small
invoice calculator does not need an instruction set designed for broad compiled
programs.

The usual formulations miss that structure.

### One-shot prediction is too coarse

If the model is asked to map directly from task instance to final answer, all
of the exact intermediate transitions are hidden. That makes supervision weak
and error analysis vague. It also makes rollback, legality checks, and browser
trace visualization much harder.

### Full-machine execution is too broad

If the model is asked to emulate a full VM, compiler IR, or broad bytecode
surface, it must learn large amounts of machine behavior that the domain never
needs explicitly. Traces become longer, token entropy rises, and more of the
model budget goes into machine scaffolding instead of task semantics.

The practical question is therefore not:

`can a transformer execute a machine?`

The practical question is:

`what is the smallest executable machine that still preserves this task's truth conditions?`

That machine is what this note calls a **problem-shaped virtual machine**.

## 2. What a Problem-Shaped VM Is

A PSVM is a virtual machine whose instruction set is derived from a task family
instead of from general-purpose computing. The VM is not chosen for universality
first. It is chosen for semantic fit.

For this repository, the useful design rule is:

`trim the machine to the problem`

That means:

- keep only the operations that carry domain meaning
- leave exact legality in deterministic code
- make failure and rollback explicit when search is real
- generate canonical traces under fixed ordering and tie-breaking
- train the model on those traces rather than only on final answers

The model-facing surface should be as small as possible, but not smaller than
the task's true state transitions.

## 3. Why This Fits Transformer Execution

This note is motivated by a systems intuition rather than a formal theorem:
autoregressive models look more like append-only execution machines than mutable
RAM machines.

A conventional interpreter evolves state roughly as:

`state + instruction -> new state`

A transformer executor behaves more like:

`trace_t -> trace_t+1`

It does not mutate old records. It appends the next one. Earlier tokens remain
fixed, and the next token must recover the relevant current state by reading the
right parts of the prior trace.

That gives a useful mental model:

- tokens are state-bearing records
- attention is state retrieval
- the trace is serialized execution history

This is only a productive framing, not a proof. But it has a concrete design
consequence: the instruction set matters enormously. If the trace is the state
surface the model reads from, then irrelevant machine detail is not harmless
boilerplate. It is extra entropy, extra context length, and extra decoding risk.

That is why a PSVM can be a better fit than either one-shot prediction or full
machine traces.

## 4. System Pattern

The intended execution loop is:

`task instance -> exact PSVM state -> canonical state/decision record -> model evaluates legal branches -> exact runtime applies/verifies -> new state`

The exact runtime remains authoritative throughout. The model proposes; the
runtime decides.

In the strongest form of the idea:

1. an exact teacher runtime defines legal states and steps
2. the teacher emits canonical state/decision records
3. a local model learns to estimate branch value over ambiguous PSVM states
4. the runtime verifies or rejects student proposals
5. the UI streams the trace and state changes in real time

This is not "weights instead of code." It is a hybrid design in which the
runtime owns truth and the model handles ambiguity, ranking, or state
evaluation within a narrow legal action surface.

Canonical traces still matter, but mainly as a serialization of exact states
and decisions. The sharper thesis is not that the model should free-run the
PSVM by imitating the next serialized op. The sharper thesis is that the model
should evaluate or rank legal continuations over exact PSVM states while the
runtime remains the executor and verifier.

## 5. PSVM Design Rules

The repository suggests six concrete rules for shaping a PSVM.

### 5.1 Keep the instruction set semantically small

The op surface should expose only domain-meaningful transitions. If two dozen
machine instructions always collapse into one task-level operation, the task
level operation is probably the right teaching surface.

### 5.2 Keep legality in exact code

A PSVM works best when the runtime still decides whether an action is legal. The
model should not also be burdened with reproducing the full verifier.

### 5.3 Canonicalize everything that can drift

If multiple traces are equivalent, supervision gets noisy fast. Tie-breaking,
branch ordering, candidate ordering, and emission format should be fixed by the
teacher.

### 5.4 Separate rules from ambiguity

The model should spend its capacity on real uncertainty: branch selection,
ordering, prioritization, or value estimation over legal continuations. Hard
constraints should remain in code.

### 5.5 Make search explicit when search is real

If the task genuinely backtracks, the VM should make that visible with explicit
undo, fail, or rollback operations. Hiding search behind one opaque "solve"
action gives up the point of the formulation.

### 5.6 Design for browser visibility

If the target environment is a browser, the trace should stay interpretable
enough to render live. That forces discipline around vocabulary size, trace
length, and the semantics of each action.

## 6. What This Repository Already Demonstrates

This repository is strongest as a systems note because it already contains
multiple concrete pieces of the PSVM stack.

### 6.1 Sudoku

The current Sudoku path is broader than the original 4x4 PSVM demo. It includes
an exact runtime in `logic/sudoku.mjs`, a browser-facing WASM execution path in
`logic/sudoku-wasm.mjs`, and a Rust solver in `wasm/sudoku-executor/src/lib.rs`.
The public browser experience is wired through `sudoku.html` and `app.mjs`.

On the model side, the repository also contains structured training and export
code under `soduku/`, especially:

- `soduku/structured_transformer_common.py`
- `soduku/train_transformer.py`
- `soduku/train_value_transformer.py`
- `soduku/model-worker.mjs`
- `soduku/model.mjs`
- `soduku/value-model.mjs`

The key point is that the model-guided Sudoku path is not framed as a pure
model-only solver. It is framed as **model-guided exact search**: the runtime
still owns candidate generation, legality, contradictions, and backtracking,
while the model ranks or scores ambiguous decisions.

That is exactly the pattern this note argues for.

### 6.2 Invoice calculation

The `invoice/` directory is the clearest state-transition PSVM in the repo:

- `invoice/psvm.mjs`
- `invoice/worker.mjs`
- `invoice/model.mjs`
- `invoice/export_dataset.mjs`
- `invoice/train_transformer.py`

This matters because it shows the idea is not puzzle-specific. The instruction
surface is shaped around a tiny business-calculation workflow rather than around
search over a board. That strengthens the paper's claim that PSVMs are about
matching machine shape to domain semantics, not about Sudoku specifically.

### 6.3 Exact browser-local demos

The broader repo also includes exact browser-local task demos such as the Weiqi
prototype in `weiqi/`. Even when those demos do not yet have a full student
training path, they support the same systems intuition: narrow exact tasks are
best expressed as narrow exact runtimes first.

## 7. What Is Supported Today, and What Is Not

This distinction matters if the note is going to be shared outside the repo.

### Supported now

The codebase already supports these claims:

- browser-local exact runtimes for narrow tasks are practical
- canonical task-shaped traces can be emitted and streamed in the UI
- local model workers can be integrated into that execution loop
- a narrow task-specific instruction surface is implementable across more than
  one domain
- hybrid execution, where the model helps but the runtime remains authoritative,
  is a real engineering pattern rather than only an idea

### Not supported yet

The codebase does **not** yet justify the stronger claims below:

- that PSVMs already outperform strong baselines quantitatively
- that a student model can replace the teacher runtime end to end
- that the approach scales cleanly from narrow demos to broad arbitrary program
  execution
- that "compile arbitrary C into weights" is the immediate right target for
  this stack

This is important because the project becomes much more credible when it says
precisely what is and is not already proven.

## 8. The Paper's Sharpest Claim

The most defensible version of the idea is not:

- "transformers can already execute arbitrary code exactly"
- "local models can replace exact runtimes"
- "full VM traces are the right universal target"

The sharp claim is:

**For narrow exact tasks, there is a better intermediate representation than
both direct answer prediction and full-machine emulation: a problem-shaped VM
whose instruction surface already matches the task's true legal transitions.**

In the strongest form, the learned component over that VM should estimate state
or branch value over exact PSVM states, not merely imitate the next serialized
op.

That claim is strong enough to be interesting and narrow enough to defend.

## 9. Experiments That Would Turn This Note into a Paper

To move from a strong systems note to a publishable empirical paper, the repo
needs controlled comparisons.

### 9.1 Formulations to compare

For a domain such as Sudoku, compare:

1. `state -> final answer`
2. `state -> next domain action`
3. `state -> value/ranking over legal PSVM branches`
4. `state -> next token of a broader generic VM`

The same structure can be repeated for invoice-style deterministic tasks.

### 9.2 Metrics

The evaluation should emphasize exactness, not only loss:

- exact final solve rate
- average backtracks or downstream search cost
- solve rate under a fixed compute budget
- illegal action rate
- contradiction or verifier-failure rate
- average trace length
- browser latency
- model size versus exactness tradeoff

### 9.3 Ablations

The most informative ablations are likely:

- instruction-set size
- trace canonicalization rules
- with versus without exact runtime verification
- op-only versus op-plus-argument prediction
- browser-local inference cost at fixed quality

If those comparisons are strong, the paper moves from an interesting thesis to a
measured result.

## 10. Why This Could Matter

There is a real gap between two current habits:

- asking models for final answers and hoping they are right
- routing all exact work to external tools or full symbolic engines

PSVMs propose a middle layer. They keep symbolic truth in code while giving the
model a narrow, learnable execution surface. That is especially relevant when
the deployment target is the browser, where latency, memory, and inspectability
matter more than broad generality.

The argument is not that every exact task should become a PSVM. The argument is
that many narrow exact tasks already have a small semantic core, and the model
should be trained on that core rather than on irrelevant machine detail.

## 11. Honest Positioning If Shared Now

This note is worth sharing **now** if it is framed correctly.

The right frame is:

- a research note
- a systems essay
- a workshop or position-paper candidate
- a repository-backed design argument with concrete prototypes

The wrong frame is:

- a finished empirical paper
- a claim that arbitrary-code execution has been solved
- a claim that the model already replaces the exact runtime

In other words, the idea is shareable today because the conceptual stance is
clear and the repository already contains meaningful evidence. But the strongest
publication target right now is something like a workshop note, demo paper, or
position paper. A full paper needs the baseline study and quantitative
evaluation described above.

## Conclusion

The repo's most interesting idea is not "put a transformer in the browser." It
is this:

`trim the machine to the problem`

If the task is exact and narrow, the model should not be asked either to guess
the final answer in one shot or to emulate a full machine whose semantics dwarf
the problem. It should be asked to operate inside the smallest executable
substrate that still preserves the task's truth conditions.

That is the case for problem-shaped virtual machines.
