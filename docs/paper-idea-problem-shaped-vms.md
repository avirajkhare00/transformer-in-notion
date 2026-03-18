---
header-includes:
  - '\usepackage{tikz}'
  - '\usepackage{pgfplots}'
  - '\usetikzlibrary{arrows.meta,positioning,shapes.geometric,fit,calc}'
  - '\usepgfplotslibrary{groupplots}'
  - '\pgfplotsset{compat=1.18}'
---

# Problem-Shaped Virtual Machines for Exact Local Transformer Execution

**Aviraj Khare**  
Email: `avirajkhare00@gmail.com`  
X: `@avirajkhare00` (`x.com/avirajkhare00`)

## Abstract

Small local transformers are a poor fit for exact tasks when they are asked
either to guess a final answer in one shot or to imitate a full
general-purpose machine. This paper argues for a middle ground: build a small
exact machine for the task first, then use the model only to guide ambiguous
choices inside that machine. We call that machine a **problem-shaped virtual
machine (PSVM)**. A PSVM keeps only the steps that matter for one family of
tasks. The runtime still checks correctness, generates valid next steps, and
handles rollback. The model does not replace execution. It helps choose between
valid options, for example by ranking search branches or field candidates. The
repository demonstrates this pattern with browser-local runtimes for Sudoku,
invoice and receipt extraction, Tally-style voucher extraction, and Weiqi. The
main claim is simple: for narrow exact tasks, small models are more useful as
guides inside a task-specific machine than as free-running solvers over raw
inputs or generic machine traces.

## Paper Type and Scope

This document should be read as an **implementation and systems paper**. It
argues from working code in the repository, not from a finished benchmark study
and not from a universal VM spec. Its main design claim is:

- build the machine around the task
- keep correctness checks in exact code
- train the model on the ambiguous choices, not on irrelevant machine detail

The companion document for machine and trace semantics is
[PSVM Runtime and Trace Semantics](/Users/avirajkhare/hack2/transformers/transformer-in-notion/docs/psvm-yellow-paper.md).
That document is narrower than this paper. It defines the shared runtime
contract, trace format, verifier behavior, and model/runtime interfaces without
claiming that all task families should share one universal machine.

## AI Assistance Disclosure

This paper was drafted and edited with AI assistance. The author directed the
scope, selected the claims, validated the implementation references against the
repository, and is responsible for the final wording, technical judgments, and
positioning.

## One-Sentence Thesis

For narrow exact tasks, the right target for a local model is usually not the
final answer and not a full machine trace. It is the smallest machine that can
still run the task correctly while exposing the decisions a model can help
with.

## Motivation

Exact tasks are common in browser software: puzzle solving, rule checking,
pricing, validation, scheduling, and other deterministic workflows. These tasks
have two properties that matter here.

In this paper, a **deterministic workflow** just means a task where rules can
check whether a step or final result is correct. Examples include:

- Sudoku solving
- invoice math
- receipt total extraction
- Tally voucher extraction
- tax calculation
- configuration validation
- approval flows with exact rules

First, they have a real notion of correctness. A step is legal or illegal. A
branch is valid or contradictory. The final output either satisfies the rules or
it does not.

Second, they often need far less machinery than a general-purpose computer. A
Sudoku solver does not need arbitrary pointer arithmetic. A receipt total
extractor does not need a large generic bytecode machine. A Tally voucher
extractor does not need free-form text generation for every field.

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

```{=latex}
\begin{figure}[t]
\centering
\resizebox{\linewidth}{!}{%
\begin{tikzpicture}[
  box/.style={draw, rounded corners=6pt, align=left, text width=0.27\linewidth, minimum height=5.6cm, inner sep=8pt, line width=0.8pt},
  chip/.style={draw=none, rounded corners=4pt, font=\bfseries\small, inner xsep=8pt, inner ysep=4pt},
  note/.style={font=\small\itshape},
]
\node[box, fill=red!4] (oneshot) {
  \tikz{\node[chip, fill=red!18] {Guess};}\\[5pt]
  \textbf{One-shot prediction}\\[4pt]
  Input $\rightarrow$ final answer\\[6pt]
  \textit{Strengths}\\
  - simple interface\\
  - low system complexity\\[4pt]
  \textit{Weaknesses}\\
  - hides intermediate state\\
  - hard to verify or debug\\
  - illegal outputs are easy
};
\node[box, fill=green!6, right=1.0cm of oneshot] (psvm) {
  \tikz{\node[chip, fill=green!18!white] {Guide};}\\[5pt]
  \textbf{PSVM middle ground}\\[4pt]
  Input $\rightarrow$ exact state $\rightarrow$ valid options $\rightarrow$ ranked choice\\[6pt]
  \textit{Strengths}\\
  - exact runtime keeps correctness\\
  - model helps only with ambiguity\\
  - trace is inspectable\\[4pt]
  \textit{Weaknesses}\\
  - requires task-specific design\\
  - still needs good candidate coverage
};
\node[box, fill=blue!4, right=1.0cm of psvm] (fullvm) {
  \tikz{\node[chip, fill=blue!18] {Emulate};}\\[5pt]
  \textbf{Full VM emulation}\\[4pt]
  Input $\rightarrow$ broad machine trace\\[6pt]
  \textit{Strengths}\\
  - very general target\\
  - can model full execution\\[4pt]
  \textit{Weaknesses}\\
  - too much irrelevant machine detail\\
  - longer traces\\
  - more context and decoding risk
};
\draw[-{Latex[length=3mm]}, thick] (oneshot.east) -- (psvm.west);
\draw[-{Latex[length=3mm]}, thick] (fullvm.west) -- (psvm.east);
\node[note, above=0.2cm of oneshot.north] {too coarse};
\node[note, above=0.2cm of psvm.north] {right-sized};
\node[note, above=0.2cm of fullvm.north] {too broad};
\end{tikzpicture}
}
\caption{PSVMs sit between one-shot answer prediction and full-machine emulation.}
\label{fig:design-space}
\end{figure}
```

## What a Problem-Shaped VM Is

A PSVM is a **small task-specific machine**. It is built for one family of
tasks and keeps only the steps that matter for that family. It is not general
on purpose.

A PSVM usually has five parts:

- **state**: the minimum information needed to continue the task
- **valid next steps**: the actions that make sense from the current state
- **verifier**: exact code that checks whether a step is valid
- **trace**: a fixed log of states and decisions
- **model hook**: the place where a model helps choose between valid options

For this repository, the useful design rule is:

`trim the machine to the problem`

That means:

- keep only task steps that carry real meaning
- remove generic machine bookkeeping that the task does not care about
- keep correctness checks in exact code
- make failure and rollback explicit when search is real
- keep the trace format fixed so training and debugging stay stable
- let the model help only where there is real ambiguity

Three simple examples make this concrete:

- **Sudoku**: the state is the board and candidate information; the valid next
  steps are legal placements, branches, and backtracks.
- **Receipt total extraction**: the state is the OCR text plus money candidates;
  the valid next steps are candidate selections such as "choose this amount as
  the total."
- **Tally voucher extraction**: the state is OCR or layout text plus the likely
  voucher family and legal field candidates; the valid next steps are field
  selections that fit that voucher schema.

The machine should be as small as possible, but not smaller than the task. If a
step is required for correctness, keep it. If it exists only because a broad VM
needs it, it is probably noise for this setup.

### What we mean by a trace

A **trace** is a step-by-step log of execution.

At each step it records enough information to understand what the machine saw
and what it did. Depending on the task, that can include:

- the current state
- the valid options
- the selected option
- the resulting state

We keep the trace format fixed so it is useful for training, debugging, and UI
rendering.

## Why This Fits Transformer Execution

This note is motivated by a systems intuition rather than a formal theorem.

An **autoregressive model** predicts the next token from the tokens that are
already present. That makes it naturally better at extending a sequence than at
behaving like a normal program that can overwrite arbitrary memory cells.

A conventional interpreter evolves state roughly as:

`state + instruction -> new state`

A transformer behaves more like:

`trace_t -> trace_t+1`

Here:

- `trace_t` means the execution log up to step `t`
- `trace_t+1` means the same log with one more record appended

The important point is that earlier tokens stay fixed. The model reads the
existing sequence and predicts what comes next. It does not directly edit memory
the way a normal mutable RAM machine does.

That gives a useful mental model:

- tokens can represent state records or decisions
- attention can retrieve the earlier records that matter
- the trace becomes the model's working context

This is a design heuristic, not a proof. But it has a concrete consequence: the
trace format and instruction set matter a lot. If the trace is full of
irrelevant machine detail, the model wastes capacity reading and predicting
boilerplate instead of task structure.

That is why a PSVM can be a better fit than either one-shot prediction or full
machine traces.

## System Pattern

The intended execution loop is:

`task instance -> exact state -> valid options -> model scores options -> exact runtime verifies and applies -> new state -> trace grows`

```{=latex}
\begin{figure}[t]
\centering
\resizebox{\linewidth}{!}{%
\begin{tikzpicture}[
  nodebox/.style={draw, rounded corners=6pt, align=center, text width=2.45cm, minimum height=1.15cm, fill=gray!6, line width=0.8pt},
  exact/.style={nodebox, fill=blue!6},
  model/.style={nodebox, fill=green!8},
  tracebox/.style={draw, rounded corners=4pt, align=center, minimum width=2.3cm, minimum height=0.75cm, fill=orange!8, line width=0.7pt},
  lane/.style={draw, rounded corners=8pt, inner sep=7pt, line width=0.9pt},
]
\node[nodebox] (task) {Task\\instance};
\node[exact, right=0.8cm of task] (state) {Exact\\state};
\node[exact, right=0.8cm of state] (valid) {Valid\\options};
\node[model, right=0.8cm of valid] (score) {Model scores\\options};
\node[exact, right=0.8cm of score] (apply) {Runtime verifies\\and applies};
\node[nodebox, right=0.8cm of apply] (newstate) {New state\\+ trace};
\node[tracebox, below=1.45cm of state] (trace1) {$S_t$};
\node[tracebox, right=0.35cm of trace1] (trace2) {$V(S_t)$};
\node[tracebox, right=0.35cm of trace2] (trace3) {$a_t^*$};
\node[tracebox, right=0.35cm of trace3] (trace4) {$S_{t+1}$};
\node[font=\bfseries\small, above=0.12cm of trace2.north] {trace grows by one record};
\node[lane, fit=(state) (valid) (apply), fill=blue!3, draw=blue!55] (exactlane) {};
\node[lane, fit=(score), fill=green!4, draw=green!45!black] (modellane) {};
\node[font=\bfseries\small, above=0.1cm of exactlane.north] {Exact runtime};
\node[font=\bfseries\small, above=0.1cm of modellane.north] {Learned guide};
\draw[-{Latex[length=3mm]}, thick] (task) -- (state);
\draw[-{Latex[length=3mm]}, thick] (state) -- (valid);
\draw[-{Latex[length=3mm]}, thick] (valid) -- (score);
\draw[-{Latex[length=3mm]}, thick] (score) -- (apply);
\draw[-{Latex[length=3mm]}, thick] (apply) -- (newstate);
\draw[-{Latex[length=3mm]}, thick, bend left=24] (newstate.north) to node[above, font=\small] {repeat} (state.north);
\draw[-{Latex[length=2.5mm]}, thick, orange!70!black] (state.south) -- (trace1.north);
\draw[-{Latex[length=2.5mm]}, thick, orange!70!black] (valid.south) -- (trace2.north);
\draw[-{Latex[length=2.5mm]}, thick, orange!70!black] (score.south) -- (trace3.north);
\draw[-{Latex[length=2.5mm]}, thick, orange!70!black] (newstate.south) -- (trace4.north);
\end{tikzpicture}
}
\caption{The PSVM execution loop. Code owns state and verification; the model only ranks valid options.}
\label{fig:psvm-loop}
\end{figure}
```

The runtime remains in charge throughout.

The runtime still owns:

1. state updates
2. valid option generation
3. correctness checks
4. rollback or backtracking

The model owns only:

1. ranking
2. value estimation
3. ambiguity resolution

In the strongest form:

1. an exact teacher runtime defines legal states and steps
2. the teacher emits fixed state and decision records
3. a local model learns to score ambiguous states or options
4. the runtime verifies or rejects student proposals
5. the UI streams the trace and state changes in real time

This is not "weights instead of code." It is a hybrid design in which code
keeps correctness and the model helps choose between valid options.

When the model is uncertain, the runtime should still be able to fall back to a
deterministic order or a small beam. The model is a guide, not the source of
truth.

### Minimal transition function

The basic PSVM loop can be written in a small amount of notation.

Let:

- $S_t$ be the exact machine state at step $t$
- $V(S_t)$ be the set of valid next actions from that state
- $m_\theta(S_t, a)$ be the model score for valid action $a$

Then the simplest guided choice is:

$$
a_t^* = \arg\max_{a \in V(S_t)} m_\theta(S_t, a)
$$

and the exact runtime applies the state transition

$$
S_{t+1} = \delta(S_t, a_t^*)
$$

This captures the main point of the paper:

- the runtime defines the valid action set $V(S_t)$
- the model only ranks actions inside that valid set
- the exact transition function $\delta$ still updates the machine state

For search tasks, the action set may include branch, fail, undo, or rollback
steps. For extraction tasks, it may include candidate-selection steps. The
notation stays the same even when the domain changes.

## PSVM Design from First Principles

The clean way to design a PSVM is to work from first principles.

### Start from correctness

Before designing the machine, say what makes an answer correct. If you cannot
write the correctness check clearly, the PSVM is not ready.

### Define the smallest state that can still run the task

Keep only the information the task actually needs to continue. Extra machine
state that exists only for generality is usually noise.

### Define the valid next steps

Each step should correspond to a meaningful domain action. If the task can
backtrack, undo, or fail, those transitions should be explicit too.

### Keep the verifier exact

The runtime should still decide whether a step is valid. Arithmetic, schema
checks, contradictions, and hard constraints belong in code.

### Use a fixed trace format

If the same task state can be written multiple ways, training gets noisy and
debugging gets harder. Tie-breaking, candidate ordering, and record layout
should be stable.

### Give the model only the ambiguous choices

The model should spend its capacity on branch ordering, candidate ranking, or
value estimation. It should not have to relearn exact rules that code can check
perfectly.

### Keep search explicit when search is real

If the task genuinely branches and backtracks, make that visible. Do not hide
real search inside one opaque "solve" action.

### Keep examples honest

Each example in the repo should answer the same questions:

- what is the state?
- what are the valid next steps?
- what checks correctness?
- what does the model decide?
- what does the trace record?

That keeps the examples comparable and stops them from turning into blind demos.

## What This Repository Already Demonstrates

This repository is strongest as a systems note because it already contains
multiple concrete pieces of the PSVM stack.

### Sudoku

The Sudoku example shows the cleanest version of the argument: **model-guided
exact search**. The runtime still owns candidate generation, legality,
contradictions, and backtracking. The model only helps choose which branch to
try first.

That is not a small difference. On the current hard preset
`Forum hardest 1106 · r365`, the shipped imitation transformer required 7,523
ranked branch decisions and 86,376 guided backtracks, while the regret-trained
transformer required 5,133 branch decisions and 57,057 backtracks on the same
exact runtime, cutting wall time from 96.99 seconds to 64.94 seconds. The
rules did not change. The only thing that moved was branch ordering.

That is exactly the behavior this paper wants from the learned component: not
free-running next-op generation, but better value estimates over exact PSVM
states.

```{=latex}
\begin{figure}[t]
\centering
\begin{tikzpicture}
\begin{groupplot}[
  group style={group size=3 by 1, horizontal sep=1.4cm},
  width=0.27\textwidth,
  height=5.2cm,
  ybar,
  ymin=0,
  enlarge x limits=0.35,
  symbolic x coords={Imitation,Regret},
  xtick=data,
  xticklabel style={font=\small, rotate=20, anchor=east},
  nodes near coords,
  every node near coord/.append style={font=\scriptsize},
  ylabel style={font=\small},
  title style={font=\small\bfseries},
]
\nextgroupplot[title={Branch decisions}, ylabel={count}]
\addplot[fill=blue!45] coordinates {(Imitation,7523) (Regret,5133)};
\nextgroupplot[title={Backtracks}, ylabel={count}]
\addplot[fill=orange!65] coordinates {(Imitation,86376) (Regret,57057)};
\nextgroupplot[title={Wall time}, ylabel={seconds}]
\addplot[fill=green!55!black] coordinates {(Imitation,96.99) (Regret,64.94)};
\end{groupplot}
\end{tikzpicture}
\caption{Sudoku benchmark on the hard preset \texttt{Forum hardest 1106 · r365}. Only the learned branch-ordering policy changes.}
\label{fig:sudoku-benchmark}
\end{figure}
```

### Invoice calculation

The invoice and receipt lanes show that the same pattern works outside puzzles.
Here the runtime first builds legal money candidates from OCR or structured
text, and the model helps choose between those candidates. The model is not
asked to invent totals from scratch.

This matters because it shows that PSVMs are not only about search problems.
They also fit narrow business workflows where exact arithmetic, exact field
legality, and explicit candidate surfaces matter more than free-form
generation.

### Tally voucher extraction

The `tally/` directory extends the same pattern from one selected value to a
full voucher-shaped record. The runtime first classifies the voucher family,
then builds legal field candidates for that family, and finally applies a small
resolver to keep the chosen fields globally consistent.

This matters because it shows the PSVM idea in a more realistic document
setting. The model is not asked to generate free-form accounting JSON. It only
ranks candidates inside a runtime that still owns schema checks, GST logic,
field legality, and final record emission.

It also exposes a useful engineering lesson: in this lane, parser quality and
candidate recall matter more than model size. The adversarial harness makes that
visible by separating candidate-missing failures from ranking failures and
resolver failures.

```{=latex}
\begin{figure}[t]
\centering
\resizebox{\linewidth}{!}{%
\begin{tikzpicture}[
  nodebox/.style={draw, rounded corners=6pt, align=center, text width=2.1cm, minimum height=1.05cm, fill=gray!6, line width=0.8pt},
  exact/.style={nodebox, fill=blue!6},
  model/.style={nodebox, fill=green!8},
  lane/.style={draw, rounded corners=8pt, inner sep=7pt, line width=0.9pt},
]
\node[nodebox] (ocr) {OCR or\\layout text};
\node[exact, right=0.45cm of ocr] (family) {Voucher\\family};
\node[exact, right=0.45cm of family] (schema) {Schema\\selection};
\node[exact, right=0.45cm of schema] (candidates) {Legal field\\candidates};
\node[model, right=0.45cm of candidates] (ranker) {Local ranker};
\node[exact, right=0.45cm of ranker] (resolver) {Resolver};
\node[exact, right=0.45cm of resolver] (record) {Tally-shaped\\record};
\node[lane, fit=(family) (schema) (candidates) (resolver) (record), fill=blue!3, draw=blue!55] (exactlane) {};
\node[lane, fit=(ranker), fill=green!4, draw=green!45!black] (modellane) {};
\node[font=\bfseries\small, above=0.1cm of exactlane.north] {Exact extraction and validation};
\node[font=\bfseries\small, above=0.1cm of modellane.north] {Learned ranking};
\draw[-{Latex[length=3mm]}, thick] (ocr) -- (family);
\draw[-{Latex[length=3mm]}, thick] (family) -- (schema);
\draw[-{Latex[length=3mm]}, thick] (schema) -- (candidates);
\draw[-{Latex[length=3mm]}, thick] (candidates) -- (ranker);
\draw[-{Latex[length=3mm]}, thick] (ranker) -- (resolver);
\draw[-{Latex[length=3mm]}, thick] (resolver) -- (record);
\end{tikzpicture}
}
\caption{Tally PSVM pipeline. The model ranks candidates; exact code keeps schema checks and final record emission.}
\label{fig:tally-pipeline}
\end{figure}
```

### Other browser-local demos

The broader repo also includes exact browser-local task demos such as the Weiqi
prototype in `weiqi/`. Even when those demos do not yet have a full student
training path, they support the same systems intuition: narrow exact tasks are
best expressed as narrow exact runtimes first.

## What Is Supported Today, and What Is Not

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
- a regret-trained value model can sometimes materially reduce exact Sudoku
  search work relative to an imitation-trained transformer on the same runtime

### Not supported yet

The codebase does **not** yet justify the stronger claims below:

- that PSVMs already outperform strong baselines quantitatively
- that a student model can replace the teacher runtime end to end
- that the current learned policy wins consistently across puzzle regimes
- that the approach scales cleanly from narrow demos to broad arbitrary program
  execution
- that "compile arbitrary C into weights" is the immediate right target for
  this stack

This is important because the project becomes much more credible when it says
precisely what is and is not already proven.

## The Paper's Sharpest Claim

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

## Experiments That Would Turn This Note into a Paper

To move from a strong systems note to a publishable empirical paper, the repo
needs controlled comparisons.

### Formulations to compare

For a domain such as Sudoku, compare:

1. `state -> final answer`
2. `state -> next domain action`
3. `state -> value/ranking over legal PSVM branches`
4. `state -> next token of a broader generic VM`

The same structure can be repeated for invoice-style deterministic tasks.

### Metrics

The evaluation should emphasize exactness, not only loss:

- exact final solve rate
- average backtracks or downstream search cost
- solve rate under a fixed compute budget
- illegal action rate
- contradiction or verifier-failure rate
- average trace length
- browser latency
- model size versus exactness tradeoff

### Ablations

The most informative ablations are likely:

- instruction-set size
- trace canonicalization rules
- with versus without exact runtime verification
- op-only versus op-plus-argument prediction
- browser-local inference cost at fixed quality

If those comparisons are strong, the paper moves from an interesting thesis to a
measured result.

## Why This Could Matter

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

## Honest Positioning If Shared Now

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
