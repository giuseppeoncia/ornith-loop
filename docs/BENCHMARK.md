# ornith-loop — Benchmark Design

_Date: 2026-07-08 · Status: design (no runner implemented yet)_

Companion to [`DESIGN.md`](DESIGN.md). DESIGN.md states the thesis and the success
criteria; this doc operationalizes them into a **falsifiable, controlled experiment** so we
can answer, with evidence, the question that motivates the work:

> Does the `ornith-loop` **method** actually lift a self-scaffolding model's success rate —
> or is it "just a skill that lets you use ornith more conveniently"?

Both answers are acceptable outcomes. This design is built so the second one ("usability
wrapper, not a performance multiplier") is a **publishable conclusion**, not a failure —
see [Honest-null clause](#honest-null-clause).

## What we are (and are not) measuring

Per DESIGN.md, cost and speed are explicit **non-goals**. A benchmark that reports "the
skill saves tokens" answers the wrong question. What matters:

- **Primary:** does the method raise ornith's task **success rate** vs controls?
- **Secondary:** does it change *how* ornith self-scaffolds (tool-sequence shape) and how
  often the known failure modes fire?
- **Recorded but non-scoring:** wall-clock, thinking-block count (context, not a metric).

"Utility" therefore = a **success-rate delta** between the method and a control, measured on
a task suite that actually exercises ornith's failure modes — not a single anecdote.

## The falsifiable hypothesis

**H1 — "don't steal the nest":** for a self-scaffolding RL-trained model, *goal + grounding
with minimal imposed scaffold* achieves a **higher** task success rate than *goal + grounding
with heavy step-by-step scaffold*.

**H2 — "the wrapper earns its keep":** the full method (grounding + minimal scaffold +
external verification + bounded corrective loop) achieves a **higher** success rate than
bare ornith (goal only, single shot).

**H3 — "the loop adds value":** the corrective loop (adding grounding across bounded rounds)
achieves a higher success rate than a single grounded shot.

Each is directional and falsifiable. Rejecting H1 (heavy scaffold ties or wins) would
contradict the project's core premise — which is exactly why it must be tested, not assumed.

## Experimental design: the arms

Two factors, varied cleanly so each comparison isolates one thing:

- **Prompt style:** `bare-goal` · `grounding+minimal-scaffold` · `grounding+heavy-scaffold`
- **Correction:** `single-shot` · `corrective-loop (N=3)`

| Arm | Prompt style | Correction | Isolates | Tests |
|---|---|---|---|---|
| **A — full method** | grounding + minimal | loop (grounding only) | — (reference) | — |
| **B1 — bare ornith** | bare goal | single-shot | whole wrapper vs nothing | **H2** (A vs B1) |
| **B2 — heavy scaffold** | grounding + heavy | loop (adds *scaffold*) | prompt style only | **H1** (A vs B2) |
| **B3 — single-shot** | grounding + minimal | single-shot | the loop only | **H3** (A vs B3) |

Design notes that keep the comparisons honest:

- **A vs B2 varies only the prompt.** Same grounding, same loop budget — the *only*
  difference is minimal vs heavy scaffold. That is the clean test of H1.
- **B2's corrective rounds add *more scaffold*, not grounding.** This is deliberate: B2 is
  the good-faith "someone who doesn't believe the thesis" arm. On failure they'd spoon-feed
  more steps, so B2 does too. It is the anti-method, played straight.
- **B2 must be a strong-faith scaffold, not a strawman.** The heavy-scaffold prompt has to
  be a genuinely competent step-by-step plan a careful engineer would write. Rigging B2 weak
  would fake a win for A. The heavy prompts are authored once, reviewed, and frozen per task.
- **A vs B3 varies only the loop.** Identical first-round prompt; B3 simply stops after
  round 1. Any delta is attributable to the correction loop.

## Task suite

The current journal only has trivial write-from-scratch tasks (`hello.txt`) — the "clean"
case that never exercises the interesting failure modes. A real suite must span the three
edit modes from DESIGN.md, graded by difficulty, **each with a machine-checkable oracle.**

| ID | Edit mode | Difficulty | Sketch | Oracle |
|---|---|---|---|---|
| `T1-scratch-easy` | write-from-scratch | easy | create a small self-contained script with a specified behaviour | run it; assert exact stdout / exit 0 |
| `T2-scratch-med` | write-from-scratch | medium | new module + its passing unit test, from a spec | `npm test` (or fixture's test cmd) green |
| `T3-additive-med` | additive | medium | add a function/route/case to an existing file **without touching the rest** | build+tests pass **and** pre-existing lines byte-identical (scoped diff) |
| `T4-additive-hard` | additive | hard | add a feature threading through 2–3 files | full test suite green; no unrelated files changed |
| `T5-inplace-med` | in-place edit | medium | modify the body of an existing function | tests pass **and** no token-corruption (dropped/added spaces, wrong casing) outside the intended span |
| `T6-inplace-hard` | in-place edit | hard | refactor a function's signature + call sites | tests green; diff limited to intended symbols |

The in-place tasks (T5/T6) target ornith's known corruption mode — the place the method is
most likely to either prove its worth (grounding + diff verification catches/prevents it) or
show its limit. `additive` and `scratch` are the cases ornith handles cleanly, so they form
the control ceiling.

### Each task is a self-contained fixture

A task directory carries everything needed to run it under any arm and check it automatically:

```
benchmarks/T3-additive-med/
  fixture/            # pristine repo/workdir, restored git-clean before every run
  goal.md             # the goal statement (shared by all arms)
  grounding.md        # paths/versions/routes/selectors — given to A, B2, B3; withheld from B1
  scaffold-heavy.md   # frozen good-faith step-by-step plan — B2 only
  oracle.sh           # exit 0 = pass; reads workdir + run-record JSON, never agent prose
  meta.json           # edit mode, difficulty, test command, expected-changed-files glob
```

The prompt each arm sends is assembled mechanically from these files (goal only / goal+
grounding / goal+grounding+heavy), so prompt construction is reproducible and not
author-improvised per run.

### The oracle is non-negotiable and external

Ornith confabulates success, **and** the reviewing host can misread the run summary — the
opencode journal recorded qwen-35b reporting `stopped-before-tool-call` +
`claimed-done-no-change` when the run record showed 7 executed tool calls and
`changed=true`. So the oracle:

- reads the **actual workdir** and the **machine-readable `runs/<id>.json`** as ground
  truth — never any agent's prose recap;
- returns a hard pass/fail exit code (build/test/diff/exact-output), no human judgement in
  the scoring path;
- for edit tasks, also asserts the **change is scoped** (expected files only; pre-existing
  content intact) — a test-passing diff that corrupted an unrelated line is a fail.

## Metrics

Per (task, arm), aggregated over K repeats:

- **`pass@1`** — fraction of repeats where round 1 satisfies the oracle. Primary for B1/B3
  (single-shot) and the headline "first-try" number for A/B2.
- **`pass@N`** (N=3) — fraction passing within the loop budget. Primary for A/B2.
- **rounds-to-pass** — distribution (1/2/3/never) for looped arms; quantifies loop cost.
- **failure-flag rates** — frequency of `tool-call-as-text`, `stopped-before-tool-call`,
  `claimed-done-no-change` (from the run record). Which failure mode dominates per arm.
- **self-scaffold shape** — tool-sequence length and distinct-tool count. Direct evidence
  for/against H1: does minimal prompting produce *richer* self-built scaffolds (read-after-
  write, shell-out-to-check) than heavy prompting, and does richer correlate with passing?
- **(recorded, non-scoring)** wall-clock, thinking-block count.

Report per task and pooled by edit mode. The headline deliverables are the deltas
**A−B1 (H2)**, **A−B2 (H1)**, **A−B3 (H3)**.

## Protocol

- **Repeats:** K ≥ 5 per (task, arm). The model is local and sampled — one run is a sample,
  not a rate. Report the rate with a simple interval; K is a knob (raise for tighter bounds).
- **Determinism:** set an Ollama seed per repeat if the provider honours it; otherwise treat
  runs as independent samples and lean on K. Record the seed (or "none") in each run record.
- **Isolation:** restore each task's `fixture/` to a git-clean state **before every run** so
  no arm inherits another's changes and B1 never accidentally sees grounding left on disk.
- **Blinding of scoring:** scoring is `oracle.sh` — mechanical, arm-agnostic, run after the
  fact over the run record + workdir. The person authoring prompts does not score.
- **Model:** default `ornith-1.0-9b-64k`; the same suite re-runnable against a larger
  tools-capable model (e.g. `qwen3.6-35b-a3b-64k`) as a cross-model comparison, holding tasks
  and arms fixed.
- **Pre-registration:** freeze the task suite, the heavy-scaffold prompts, K, and the
  hypotheses **before** running. No adding/removing tasks after seeing results.

## Honest-null clause

Pre-committed interpretation, so the result can't be rationalized after the fact:

- **A > B2 (H1 holds):** evidence for "don't steal the nest" — the central thesis stands.
- **A ≈ B2 or A < B2:** the thesis is wrong or scaffold-neutral for this model. Report it.
- **A ≈ B1 and A ≈ B3:** the method does **not** move the success rate. The honest
  conclusion is then exactly the user's hypothesis: *ornith-loop is a **usability/
  observability wrapper** — it makes ornith convenient and measurable, but is not a
  performance multiplier.* That is a legitimate finding and should be stated plainly in the
  journal and README, not buried.

A "wrapper, not multiplier" outcome still leaves real value (reproducibility, the failure-
mode flags, the journal as accumulated knowledge) — but we would stop claiming a success-rate
lift we can't show.

## Threats to validity

- **Reviewer confabulation** (observed) → oracle reads run-record JSON + workdir only.
- **Small-model variance** → K repeats + reported intervals; never conclude from one run.
- **Grounding leakage across arms** → git-clean fixture restore before every run.
- **Strawman B2** → heavy-scaffold prompts are good-faith, reviewed, and frozen.
- **Task-selection bias** → suite spans all three edit modes incl. the cases ornith handles
  cleanly; pre-registered, no post-hoc curation.
- **Prompt-author bias in A** → minimal prompts are goal+grounding assembled mechanically
  from the fixture files, not hand-tuned per run.

## Mapping onto the existing tooling

`orn` already produces most of the per-run signal the metrics need: the self-built tool
sequence, the failure-mode flags, `workdirChange.changed`, thinking-block count, final text,
and a `schemaVersion: 1` run record under `runs/`. What does **not** exist yet:

- the task-fixture format (`goal.md` / `grounding.md` / `scaffold-heavy.md` / `oracle.sh` /
  `meta.json`);
- a multi-run driver that assembles the per-arm prompt, restores the fixture, invokes `orn`
  K times per (task, arm), and runs the oracle;
- an aggregator that rolls run records + oracle verdicts into the per-task/per-arm table and
  the H1/H2/H3 deltas.

A future `orn bench` (or a standalone script under `benchmarks/`) would own the driver +
aggregator; `orn run` stays the single-invocation primitive it is today. **Not built here —
this doc is the spec it would implement.**

## Phasing

- **Phase 0 (this doc):** design, hypotheses, arms, metrics, honest-null clause.
- **Phase 1 — pilot:** 2–3 tasks (one per edit mode, incl. one in-place) × all four arms ×
  K=5, driven semi-manually via `orn run` + a hand-written `oracle.sh`. Goal: confirm the
  arms produce *distinguishable* numbers before investing in automation. If A, B1, B2, B3 are
  indistinguishable on the pilot, that is itself the H2/H3-null signal.
- **Phase 2 — automate:** build the driver + aggregator (`orn bench`) only if the pilot shows
  the design separates the arms; then run the full suite and both models.

## Success criteria for the benchmark itself

- Produces the three deltas (A−B1, A−B2, A−B3) with repeat-based rates, per edit mode.
- Every pass/fail traces to a mechanical oracle over ground truth, never agent prose.
- Can conclude "usability wrapper, not multiplier" as cleanly as it can conclude the thesis
  holds.
- Re-runnable against a second model with tasks/arms unchanged.
