---
header-includes:
  - '\usepackage{graphicx}'
  - '\usepackage{float}'
  - '\graphicspath{{figures/out/}}'
---

# Problem-Shaped Virtual Machines for Exact Local Transformer Execution

**Aviraj Khare**  
Email: `avirajkhare00@gmail.com`

## Abstract

This paper argues that small local models are most useful on exact tasks when
they operate inside a task-specific exact machine instead of predicting final
answers or imitating a broad virtual machine. I call that machine a
**problem-shaped virtual machine (PSVM)**. The repository demonstrates the
pattern across browser-local Sudoku, receipt and invoice total extraction,
Tally-style voucher extraction, and a smaller Weiqi prototype
[@khare2026trl]. In every case, code remains authoritative for legality,
rollback, arithmetic, schema checks, and final emission; the model only ranks
legal branches or candidates. The contribution is therefore systems-level: a
concrete artifact for browser-local, verifier-backed AI. The paper does not
claim that PSVMs already beat strong baselines or scale to arbitrary program
execution.

## Core Claim

For narrow exact tasks, the right learned target is usually not the final
answer and not a full machine trace. It is the ranking problem induced by the
smallest exact machine that can still run the task correctly.

That claim sits between two common extremes. One-shot answer prediction hides
the exact intermediate decisions, making supervision weak and failure analysis
vague. Full-machine emulation forces the model to spend capacity on generic
machine bookkeeping that the task does not need. PSVMs aim at the middle:
keep exact semantics in code, but expose a small legal frontier on which the
model can actually help.

This is a repository-backed systems paper, not a finished benchmark study.
The point is to make the pattern concrete in working software. OR-Tools and
PySAT provide exact search and constraint solving [@ortools; @pysat], while
Transformers.js and ONNX Runtime make browser-local inference practical
[@transformersjs; @onnxruntime]. LayoutParser shows how OCR-centric document
pipelines can be structured [@layoutparser]. The gap this repository targets
is the combination: exact task runtimes, local learned guidance, canonical
candidate surfaces or traces, and browser deployment in one inspectable
artifact.

## What a PSVM Is

A PSVM is a small exact machine for one task family. It keeps only the state
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
selections. The design rule is simple: trim the machine to the problem.

## Evidence from the Repository

The repository demonstrates the PSVM pattern across several domains rather
than only one demo.

### Sudoku

Sudoku is the cleanest case because it is explicit exact search. The runtime
owns candidate generation, contradictions, rollback, and backtracking. The
model only helps order legal branches. On the current hard preset `Forum
hardest 1106 · r365`, the shipped regret-trained transformer reduced ranked
branch decisions from 7,523 to 5,133, backtracks from 86,376 to 57,057, and
wall time from 96.99 seconds to 64.94 seconds relative to the
imitation-trained transformer on the same exact runtime. The rules did not
change. Only branch ordering changed.

That result is suggestive, not sufficient. It is a single-preset comparison
inside the repository, not a baseline study against stronger exact solvers.
But it demonstrates the intended role of learning in a PSVM: not free-running
execution, but value estimation over exact states.

### Receipt, Invoice, and Tally Extraction

The document lanes show the same separation outside search. For receipt and
invoice total extraction, the runtime first enumerates legal money candidates
from OCR or structured text. The model ranks those candidates, and a
deterministic emitter produces the selected value. The model is not asked to
invent totals from scratch.

The Tally lane extends the same idea to a larger structured state. The runtime
first classifies voucher family, then builds schema-aligned field candidates,
and finally applies a deterministic resolver with arithmetic, schema, and GST
consistency checks. The learned selector only ranks candidates inside that
legal surface. This is the main document-extraction lesson of the repository:
parser quality, candidate recall, and exact resolution matter at least as much
as model size.

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

These are precisely the places where criticism is fair. The current artifact
is strongest as a systems paper or research note, not as a finished empirical
paper.

## What Would Make It Stronger

Three additions would materially strengthen the paper: compare PSVM ranking
against one-shot answer prediction and broader trace formulations; evaluate
exactness rather than only loss, using solve rate, illegal action rate,
verifier failure rate, search cost, trace length, and browser latency; and
add stronger baselines, especially for Sudoku and document extraction. If
those experiments are strong, the PSVM claim becomes much easier to defend as
more than a design argument.

## Conclusion

The paper's main point is narrower than the title makes it sound. It is not
that local transformers can already execute arbitrary code exactly. It is that
many narrow exact tasks have a small semantic core, and local models are more
useful when trained on that core than when asked either to guess final answers
or imitate broad machine traces.

That is what a PSVM is: the smallest exact machine that still preserves the
task's truth conditions while exposing the choices that are genuinely
ambiguous.

## AI Assistance Disclosure

This paper was drafted and edited with AI assistance. The author reviewed the
implementation references and is responsible for the claims, wording, and
technical judgments.
