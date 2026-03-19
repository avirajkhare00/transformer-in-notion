---
header-includes:
  - '\usepackage{graphicx}'
  - '\usepackage{float}'
  - '\graphicspath{{figures/out/}}'
---

# Trim the Machine to the Problem: Exact Runtimes with Model Ranking for Local Tasks

**Aviraj Khare**  
Email: `avirajkhare00@gmail.com`

## Abstract

This note argues for a narrower target for local AI systems. On many exact
tasks, arithmetic, legality, and schema validation already belong in code. A
small local model is most useful when it ranks ambiguity inside an exact
runtime: which legal branch to try, which OCR candidate best fits, or which
valid state looks most promising. I call the smallest exact runtime that
exposes that surface a **problem-shaped virtual machine (PSVM)**. The
repository demonstrates the pattern across browser-local receipt and invoice
extraction, Tally-style voucher extraction, and Sudoku [@khare2026trl]. The
claim is not that PSVMs beat specialized exact
solvers. The claim is that they provide a practical interface for
browser-local hybrid systems in which code keeps truth and models rank
ambiguity.

## Core Claim

For narrow local tasks, the right learned target is usually not the final
answer and not a broad machine trace. It is the ranking problem induced by the
smallest exact runtime that can still execute the task correctly.

That is a claim about **placement of learning**, not about replacing solved
exact methods. One-shot answer prediction hides the intermediate structure that
must still be checked. Full-machine emulation wastes capacity on bookkeeping
that the task does not need. PSVMs aim at the middle: keep exact semantics in
code, but expose a small legal frontier on which the model can actually help.

This matters most where exact computation is already strong but the interface
between code and learning is still poor. OR-Tools and PySAT already solve many
constraint problems well [@ortools; @pysat]. OCR pipelines already provide
partial structure [@layoutparser]. The gap this repository targets is the
combination: exact runtimes, local learned guidance, canonical candidate
surfaces or traces, and browser deployment in one inspectable artifact.

## What a PSVM Is

A PSVM is a small exact runtime for one task family. It keeps only the state
and transitions that matter for that task, plus an explicit place where a
model can help. In practice, a PSVM has five parts:

- exact state
- legal next actions or legal candidate set
- exact verifier
- canonical trace
- model hook for ranking ambiguity

Across tasks, the execution loop is:

`task instance -> exact state -> legal frontier -> model scores ambiguity -> runtime verifies and applies -> new state`

Let $S_t$ be the exact state at step $t$, $V(S_t)$ the valid next actions, and
$m_\theta(S_t, a)$ the model score for legal action $a$. Then the guided choice
is

$$
a_t^* = \arg\max_{a \in V(S_t)} m_\theta(S_t, a)
$$

and the runtime applies the exact transition

$$
S_{t+1} = \delta(S_t, a_t^*)
$$

The separation of responsibility is the point:

- the runtime defines $V(S_t)$ and $\delta$
- the verifier decides whether an action is legal
- the model only ranks choices inside the legal set

That pattern applies both to search tasks, where actions may include branch
and rollback, and to extraction tasks, where actions may be candidate
selections. The design rule is simple: trim the machine to the problem, and
do not ask the model to redo work that the runtime can already do exactly.

## Evidence from the Repository

The repository demonstrates the PSVM pattern across several domains rather
than only one demo.

### Receipt, Invoice, and Tally Extraction

The document lanes are the strongest motivating examples because the exact
subproblems are obvious. Arithmetic, schema conformance, GST checks, rollback,
and canonical emission belong in code.

For receipt and invoice total extraction, the runtime first enumerates legal
money candidates from OCR or structured text. The model ranks those
candidates, and a deterministic emitter produces the selected value. For the
Tally lane, the runtime first classifies voucher family, then builds
schema-aligned field candidates, and finally applies a deterministic resolver
with arithmetic, schema, and GST consistency checks. The learned selector only
ranks candidates inside that legal surface.

The extraction lesson is simple: correctness comes from candidate coverage
plus exact resolution, not from asking a model to output a finished
accounting record.

### Sudoku as a Micro-Example

Sudoku is included as a didactic micro-example, not as evidence that PSVMs
beat strong exact solvers. Specialized solvers already exist and remain the
right answer if the goal is simply to solve Sudoku fast. The point here is
structural: the runtime owns candidate generation, contradictions, rollback,
and backtracking, while the model only orders legal branches. The repository's
in-repo comparison on one hard preset is useful only in that limited sense.

### Browser-Local Deployment

The artifact is also a browser-local systems demo, not just a training
directory. It ships worker-based inference paths, ONNX exports, exact
runtimes, and interactive demos that make the model/runtime split visible.
That matters because latency, inspectability, and deterministic fallback
behavior are part of the thesis, not afterthoughts.

## Positioning

The repository already supports three defensible claims.

- Browser-local exact runtimes with local learned guidance are practical for
  narrow tasks.
- Canonical legal frontiers can be built for both search and extraction tasks.
- Small local models are useful as rankers over those legal frontiers while
  exact code keeps truth.

It does **not** yet justify stronger claims such as:

- PSVMs outperform strong classical or hybrid baselines across tasks.
- the learned model can replace the exact runtime end to end.
- the approach scales from narrow task families to arbitrary program
  execution.
- problems that already have excellent exact solvers should now be reformulated
  around PSVMs.

These are precisely the places where criticism is fair. The current artifact
is strongest as a systems note or research note, not as a finished empirical
paper.

## What Would Make It Stronger

Three additions would materially strengthen the note: compare PSVM ranking
against one-shot answer prediction and broader trace formulations; evaluate
exactness rather than only loss, using solve rate, illegal action rate,
verifier failure rate, search cost, trace length, and browser latency; and
add stronger baselines, especially in document extraction. If those
experiments are strong, the PSVM claim becomes much easier to defend as more
than a design argument.

## Conclusion

The note's main point is narrow on purpose. It is not that local models
should compete with every specialized exact solver. It is that many narrow
local systems already have an exact core, and the right place for learning is
inside that core's legal ambiguity surface rather than outside it.

If the exact core already exists, the model should rank the remaining
ambiguity rather than pretend to replace the system.

## AI Assistance Disclosure

This note was drafted and edited with AI assistance. The author reviewed the
implementation references and is responsible for the claims, wording, and
technical judgments.
