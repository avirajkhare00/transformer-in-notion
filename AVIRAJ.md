# AVIRAJ Operator Profile

This file is a working operator snapshot distilled from:

- local Codex prompt history visible in this environment from March 12, 2026 to March 20, 2026
- the current repository code and docs

It is meant to help future agents align with how Aviraj thinks, builds, evaluates, and ships.

## Identity

- Independent researcher-operator building exact-task local AI systems.
- Works across research framing, implementation, demos, evaluation, docs, and release flow.
- Comfortable mixing JavaScript, Python, ONNX, Web Workers, and WebAssembly in one stack.
- Prefers artifacts that run end to end over disconnected model experiments.

## Core Thesis

- Code is the source of truth.
- Exact runtimes should own legality, state transitions, rollback, and verification.
- Models should handle ambiguity by ranking legal branches or candidates, not inventing unconstrained answers.
- Narrow task-shaped runtimes are preferable to broad generic machine semantics when the task is exact and bounded.
- Browser-local execution is a first-class target, not an afterthought.

## Primary AI/ML Lanes

- Problem-shaped virtual machines and exact-runtime-guided ML.
- Sudoku and other exact search tasks, including tic-tac-toe and Weiqi-style examples.
- Document AI over OCR and layout, especially receipts, invoice totals, and Tally-style vouchers.
- Tiny local transformers, BERT-like selectors, value policies, and some GNN exploration.
- Quantized ONNX export and browser-local inference.
- Synthetic dataset generation, canonical trace export, packed training data, and held-out evaluation.
- WASM-backed or worker-backed execution paths that make the runtime-model split visible.
- Embeddable local AI demos, including Notion-facing ideas.

## Preferred Problem Formulation

- `state -> legal frontier -> model ranking -> exact runtime apply/verify`
- `OCR/layout -> legal candidates -> model score -> deterministic resolver -> emitted output`
- `board/program/history -> next canonical action`
- Deterministic teacher first, learned scorer second.
- Smaller action surfaces over generic instruction sets.
- Explicit fallback behavior when the model is weak or uncertain.

## What Aviraj Is Actually Optimizing For

- Groundedness over hype.
- Truthfulness over flashy benchmark framing.
- Exactness and verifiability over model-only cleverness.
- Small, local, inspectable systems over opaque large-model dependence.
- Research artifacts that can be demoed, read, and reproduced from code.
- Shipping real demos, docs, and releases rather than leaving ideas half-integrated.

## Product and Research Taste

- Favors narrow exact tasks where correctness matters.
- Wants the runtime-model boundary to stay obvious and inspectable.
- Likes concrete demos that teach a pattern, not just benchmark-chasing.
- Treats papers, README framing, and website copy as part of the product.
- Pushes toward JOSS/arXiv/software-artifact quality rather than vague project notes.
- Interested in pushing local models and runtimes into lightweight browser or Notion-style surfaces.

## Communication Style

- Uses many short, imperative prompts.
- Operates with high momentum and expects forward progress without repeated re-planning.
- Frequently asks to continue, ship, push, tag, release, or tighten framing.
- Likes blunt technical comparison when evaluating tools.
- Expects answers to be grounded in code and actual behavior, not generic explanation.
- Has low tolerance for hand-wavy AI claims or padded prose.
- Often mixes strategy, implementation, and publication asks in one thread.

## Collaboration Preferences For Future Agents

- Start from the repo and the code path first.
- Answer from implementation and evidence, not from generic prior knowledge.
- If a task can be made exact, make it exact first.
- If ML is needed, constrain it to legal actions or candidate sets.
- Keep context lean and relevant.
- Be candid about tool tradeoffs and where each approach actually helps.
- Separate verified facts from design ideas and open hypotheses.
- Keep momentum; default to doing the work rather than only describing it.

## Evaluation Philosophy

- Groundedness, correctness, and truthfulness matter more than vanity metrics.
- Incomplete evals should be labeled honestly.
- Benchmarks should resemble real engineering or real task failure modes.
- Candidate recall, exact resolution, and verifier-backed behavior matter, not only top-line accuracy.
- Claims on the website, in the README, or in a paper should track verified repo behavior.
- Results should be compared apples-to-apples when policies or architectures differ.

## Tooling Preferences

- Strong interest in yoyo, MCP, and grounded agent tooling.
- Sees MCP as an intelligent grounding layer, not just a thin wrapper over shell commands.
- Wants tools that beat native Unix workflows by narrowing context, preserving correctness, and reducing noise.
- Will ask for memories, reusable rules, or standing operator context when a pattern repeats.
- Values tool comparisons that are specific about where a tool shines and where it does not.

## Good Defaults For This Operator

- Assume browser-local is desirable unless there is a strong reason otherwise.
- Keep ONNX, Web Workers, and WASM in the design space by default.
- Prefer tiny local models over heavy remote dependencies when the task allows it.
- Treat document extraction as constrained candidate selection plus exact validation, not open-ended generation.
- Treat Sudoku-like problems as exact search with learned guidance, not direct board-to-answer prediction.
- Prefer per-example demos or pages when embedding and presentation matter.
- Keep docs, demos, and paper framing aligned with the actual implementation.
- Expect follow-through on release or publication packaging after technical changes.

## Anti-Patterns To Avoid

- Model-first answers when exact code can own truth.
- Hallucinated extraction without a verifier.
- Large irrelevant VM or action surfaces for narrow exact tasks.
- Paper framing that outruns the implementation.
- Inflated or selectively framed eval results.
- Vague tool praise without concrete leverage points.
- Server-first assumptions when local inference is feasible.
- Generic advice that ignores the repo's actual code path.

## Repeated Themes Seen In Prompt History

- Push a transformer or hybrid runtime into the browser.
- Explore whether local models plus WASM executors can live inside Notion-style embeds.
- Use custom VM or PSVM surfaces for Sudoku and similar exact tasks.
- Build invoice, receipt, and Tally extraction as constrained ranking plus deterministic resolution.
- Tighten README, paper, docs, and release framing to match what is real.
- Improve evals so they reflect grounded engineering work instead of weak synthetic vanity cases.
- Compare yoyo and native tools honestly and design better grounded tooling.

## Representative Prompt Patterns

- "use yoyo, answer from code"
- "groundedness + correctness + less token usage"
- "we can have WASM inside notion"
- "tiny in-browser model"
- "hybrid model + executor path"
- "push on github and make a tag + release"
- "be genuine"
- "don't get biased"

## Likely Active Project Arcs

- PSVM framing and paper refinement.
- Browser-local exact execution demos.
- Sudoku value-policy and guided-search work.
- Invoice and receipt total extraction.
- Tally voucher extraction and constraint resolution.
- Notion-embeddable local AI demos.
- yoyo and MCP tool design, evaluation, and operator memory.

## Guidance For Future Agents Working With Aviraj

- Bias toward concrete implementation work.
- Bring architectural arguments back to exactness, grounding, and deployability.
- Show how a design preserves truth in code and limits model scope.
- When proposing ML, define the legal frontier and the fallback path.
- When proposing evaluation, show the failure surface and how the metric matches real use.
- When writing docs or papers, keep the framing tight and defensible.
- When comparing tools, say where they help, where they do not, and why.

## Scope Note

- This profile is based only on the local history and repo state visible in this environment.
- It should be treated as a strong working profile, not a complete biography.
