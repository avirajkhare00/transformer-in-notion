# VM Design Space

This note is the concrete systems view of the VM question:

- what kinds of virtual machines are possible,
- which ones fit local transformer execution well,
- and which ones fit this repository's direction.

The useful question is not:

`can a transformer emulate a VM?`

The useful question is:

`which VM family gives the smallest sound execution surface for this task?`

## Why VM family matters

The VM choice changes almost everything:

- how large the opcode space is,
- how explicit state must be,
- how long traces become,
- how easy legality checking is,
- how easy browser execution is,
- how realistic local transformer supervision becomes.

Two VMs can both be Turing-complete and still be wildly different engineering
choices.

## VM families

| VM family | State shape | Best for | Strengths | Tradeoffs | Fit for local transformer executors |
| --- | --- | --- | --- | --- | --- |
| Stack VM | operand stack + small memory | arithmetic DSLs, tiny general executors, interpreters | small generic ISA, implicit operands, easy canonical traces | verbose for named state, extra push/pop traffic | high for first generic prototypes |
| Register VM | explicit registers + control flow | compiler targets, explicit data movement, low-level programs | shorter traces than stack VMs, clearer data dependencies | larger token/action space, more operand encoding | medium |
| Object / state-transition VM | named objects/resources/records | business apps, ledgers, workflows, policy engines | mirrors real app state, easy legal-step verification, great for web apps | less general than bytecode VMs | high for PSVMs |
| Graph / dataflow VM | nodes, edges, frontier, ready set | routing, dependency resolution, assignment, shortest path, build graphs | matches dependency-driven computation, parallelism is explicit | canonical ordering is harder, graph state can be large | high for graph tasks |
| Constraint / rule VM | candidates, rule stack, branch frames, undo | Sudoku, SAT, CSPs, theorem search | compact search semantics, direct trace for propagation and backtracking | task-shaped, not broadly reusable | very high for search tasks |
| Full bytecode VM | stack/register/object semantics plus broader ops | general-purpose program execution, broad compilation targets | reusable, compiler-friendly, strong long-term story | bigger ISA, longer traces, more irrelevant detail | medium long-term, poor first target |

## 1. Stack-based VMs

The classic form:

```text
PUSH 3
PUSH 5
ADD
OUT
HALT
```

State usually includes:

- instruction pointer
- operand stack
- maybe a few memory cells
- output buffer

Why they are good:

- implicit operands keep tokens short
- traces are easy to canonicalize
- good for arithmetic, mini DSLs, and teaching execution

Why they are limited:

- named app state becomes awkward
- many domains do not naturally think in push/pop form
- traces can get noisy with stack maintenance

Best use here:

- a tiny general executor
- arithmetic DSL demos
- "computer inside transformer" v1

## 2. Register-based VMs

The classic form:

```text
LOAD r1, amount
LOAD r2, tax
MUL r3, r1, r2
ADD r4, r1, r3
HALT
```

State usually includes:

- named registers
- control-flow state
- memory

Why they are good:

- explicit operands make data movement clear
- often fewer instructions than stack machines
- closer to many compiler IRs

Why they are harder:

- operand encoding expands the action space
- constrained decoding has to reason about legal registers and sources
- less compact for tiny local models

Best use here:

- later compiler-facing executors
- cases where explicit named values matter more than minimal token count

## 3. Object / state-transition VMs

The shape is:

```text
READ_ITEM
LINE_TOTAL
ADD_SUBTOTAL
APPLY_TAX
EMIT_TOTAL
HALT
```

State usually includes:

- named business objects or records
- current phase
- derived totals or resources

Why they are good:

- match real web app semantics closely
- legality checks are simple and strong
- traces stay readable to non-ML users
- excellent for browser-side demos

Why they are limited:

- not ideal as a universal compilation target
- op sets are domain-specific

Best use here:

- invoice calculators
- workflow engines
- policy checkers
- scheduling and rule-based web apps

This is the closest family to the current `invoice/` PSVM.

## 4. Graph / dataflow VMs

The shape is:

```text
EXPAND_NODE
RELAX_EDGE
UPDATE_BEST
MARK_DONE
HALT
```

State usually includes:

- graph nodes and edges
- frontier or ready queue
- cost labels or dependency marks

Why they are good:

- many real problems are graph-shaped, not stack-shaped
- dependency flow is explicit
- parallel structure is visible
- a transformer's lookup over prior state records maps well to node/state retrieval

Why they are harder:

- graph canonicalization matters a lot
- multiple equally valid next nodes can poison supervision if ordering is loose
- state visualization is more complex than scalar traces

Best use here:

- shortest path
- assignment and matching
- dependency resolution
- build-graph execution
- routing and small planning problems

This is a strong next family after `invoice/` and `soduku/`.

## 5. Constraint / rule VMs

The shape is:

```text
FOCUS_NEXT
READ_CANDS
PLACE
UNDO
FAIL
HALT
```

State usually includes:

- board or constraint assignment
- candidate sets
- branch stack
- contradiction markers

Why they are good:

- they expose search directly
- they make backtracking first-class
- they compress many irrelevant machine details away
- they fit Sudoku and similar exact tasks much better than generic bytecode

Why they are limited:

- highly task-shaped
- not a good universal backend

Best use here:

- Sudoku
- SAT-like toys
- CSP demos
- small theorem-search prototypes

This is the closest family to the current `soduku/` PSVM.

## 6. Full bytecode / broad execution VMs

Examples:

- restricted WASM
- tiny generic bytecode
- eventually broader smart-contract or application VMs

Why they are attractive:

- reusable across many tasks
- strong story for "compile programs into traces"
- natural bridge to real languages and toolchains

Why they are poor first targets:

- they include many irrelevant semantics for any one task
- traces get long quickly
- local model capacity gets spent on machine detail instead of domain logic

Best use here:

- after the task-shaped path is working
- when generality becomes more important than minimality

## 7. Hybrids are normal

The real answer is often hybrid, not pure:

- stack core + object ops
- graph executor + scalar accumulator state
- constraint VM + object-style records for board state
- full bytecode backend + small model-facing PSVM frontend

That last pattern is especially useful:

```text
model-facing VM = tiny task-shaped surface
runtime-facing VM = broader exact interpreter
```

So the model sees the smallest useful op set, while the runtime can still be
implemented on top of a more general substrate.

## Selection rules

Use these rules of thumb:

### Pick a stack VM when

- you need a tiny generic executor,
- the domain is arithmetic or program-like,
- and you want the smallest first general-purpose trace language.

### Pick a register VM when

- explicit named state matters,
- shorter low-level traces matter more than smaller token vocab,
- or you are aligning with a compiler or IR.

### Pick an object / state-transition VM when

- the task is a web app, workflow, or business process,
- legality is best expressed as phase-based state transitions,
- and readability matters.

### Pick a graph / dataflow VM when

- the task is fundamentally node-edge based,
- multiple pending dependencies exist,
- and search or propagation is graph-shaped.

### Pick a constraint / rule VM when

- the problem is search-heavy,
- candidate propagation and undo are core semantics,
- and generic arithmetic is mostly irrelevant.

### Pick a broader bytecode VM when

- you need compilation from many sources,
- you care about long-term reuse,
- and you are willing to pay a larger trace cost.

## What fits this repo right now

Current mapping:

- `docs/executor-v1-spec.md` -> stack VM
- `invoice/` -> object / state-transition PSVM
- `soduku/` -> constraint / rule PSVM

Strong next possibilities:

- `maze / shortest path` -> graph / dataflow PSVM
- `24 game / stack calculator` -> stack PSVM
- `meeting slot planner` -> object + constraint hybrid
- `assignment / matching` -> graph + optimization hybrid

## Bottom line

The best VM is not the most general one.

The best VM is the one that:

- exposes the smallest sound instruction set,
- keeps future-state changes explicit,
- makes legality cheap to verify,
- and gives the model the shortest exact trace that still solves the task.

For this repo, that means:

- stack VM for generic executor research,
- object/state VM for small web apps,
- constraint VM for Sudoku,
- graph VM for routing and planning next.
