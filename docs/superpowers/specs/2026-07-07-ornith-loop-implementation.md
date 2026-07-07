# ornith-loop — Spec

> **Spec-of-record** for the implementation plan of the same name.
> The full design & rationale (the single source of truth) live in
> [`docs/DESIGN.md`](../../DESIGN.md); this file is a thin pointer that names the
> scope and acceptance criteria and links the plan to the design. It does not
> restate the design — if the two ever disagree, `docs/DESIGN.md` wins.

## Scope

Three components, standalone repo (see `docs/DESIGN.md` §Architecture for detail):

1. **`orn`** — a thin Node CLI wrapping `pi` (`@earendil-works/pi-coding-agent`) against a
   local Ollama provider: right defaults, timeout, env passthrough, and JSONL→observability
   parsing. Does not author prompts, choose grounding, or judge correctness.
2. **`ornith-loop`** — a Claude Code skill encoding the method (grounding → minimal-scaffold
   prompt → run → external verification → bounded corrective loop → journal).
3. **Experiment journal** — accumulated, comparable per-run observations.

Governing principle (from `docs/DESIGN.md`): **do not steal ornith's nest** — supply
grounding + verification/observability, never reasoning scaffold.

## Acceptance criteria

Derived from `docs/DESIGN.md` §Success criteria:

- Re-running today's kind of task takes one `ornith-loop` invocation, not ad-hoc manual steps.
- Every run yields an observability summary showing ornith's self-built tool sequence and any
  failure-mode flags.
- The journal accumulates comparable entries across runs/models, so "which grounding makes
  self-scaffolding succeed" becomes an answerable, evidence-backed question.
- `orn` is usable standalone (invocation + summary) without the skill.

## References

- **Design (source of truth):** [`docs/DESIGN.md`](../../DESIGN.md)
- **Plan:** [`../plans/2026-07-07-ornith-loop-implementation.md`](../plans/2026-07-07-ornith-loop-implementation.md)
- **Operating constraints:** [`CLAUDE.md`](../../../CLAUDE.md)
