# ornith-loop — Local verifier selection

_Status: design + harness (selection runs on a local ollama workstation, not in a remote
container)._

Companion to [`DESIGN.md`](DESIGN.md) (two-tier verification) and [`BENCHMARK.md`](BENCHMARK.md)
(the method experiment). This doc answers a single question with evidence:

> Which lightweight **local** model is safe enough to be the **first-pass verifier** — i.e.
> its `pass` verdicts can be auto-accepted — with Claude kept only as the audit tier for
> `fail`/`uncertain`?

## The role being filled

Layer 1 of verification (DESIGN.md). The verifier does **not** re-implement the oracle. The
harness/host runs the tests, computes the diff, and lists the changed files; the verifier
**adjudicates** that evidence and returns a structured verdict. This keeps the model's job
narrow — read ground truth, decide — which is why a small model can plausibly do it.

Instructions live in [`../verifier/rubric.md`](../verifier/rubric.md). The evidence packet is
built by `buildEvidencePacket` (`src/verifier.js`) and deliberately **excludes**:

- **ornith's own prose / finalText** — the executor confabulates; a verifier that reads its
  self-report inherits the confabulation.
- **the task answer-key** (`meta.json`'s `allowedChangedFiles`, the oracle's byte-guard
  strings) — the model must *infer* the intended scope from goal + grounding + diff, exactly
  as it must on a real task that ships no oracle. Handing it the key would measure the wrong
  thing.

## The falsifiable question

**V1 — "a local model can be a safe first pass":** there exists a lightweight local model
whose **false-pass rate is ≈ 0** on the benchmark suite, at an escalation rate low enough to
be worth it. If no candidate reaches ≈ 0 false-pass without escalating almost everything, the
honest conclusion is *"keep Claude as the primary reviewer"* — a valid, publishable outcome.

## Why false-pass is the only metric that can sink the design

The verdicts map to actions asymmetrically:

- **`pass` → auto-accepted.** A wrong `pass` (oracle says fail) is a **false-pass**: a real
  failure ships unreviewed. Since ornith *already* confabulates success, a false-passing
  verifier is worse than no verifier — two confabulators in a row.
- **`fail` / `uncertain` → escalate to Claude.** A wrong `fail` (oracle says pass) only costs
  an audit; `uncertain` is the model correctly declining to guess. Both are cheap.

So the selection metric is **`effectiveFalsePass` = P(oracle fail | verdict pass)** — of the
runs the verifier auto-accepts, how many were actually broken. Pick the **lightest** model
with `effectiveFalsePass ≈ 0`, then break ties by the **lowest escalation rate** (least Claude
load). `scoreVerifier` (`src/verifier.js`) computes these; `bench.mjs verify-report` prints
them, sorted safest-first.

## Protocol

1. **Gold labels come free.** The benchmark oracles (`benchmarks/tasks/*/oracle.mjs`) already
   produce a mechanical pass/fail per run — that is the ground truth the verifier is scored
   against. No new labelling.
2. **Run each candidate over the existing suite.** For every `(task, arm)` you benchmark, add
   `--verifier-model <id>`; the driver runs the oracle (gold) **and** the candidate verifier
   (prediction) on the same workdir, and records both in the result row:

   ```bash
   node benchmarks/bench.mjs run --task T3-inplace --arm A --repeats 5 --verifier-model qwen3-coder-14b
   node benchmarks/bench.mjs verify-report
   ```
3. **Span the failure modes.** Include the in-place tasks (T3, T6) — the corruption cases are
   where a lazy verifier most easily false-passes a green-but-corrupt diff. A verifier that
   only ever sees clean passes is untested exactly where it matters.
4. **K repeats, no pinned seed** (as in BENCHMARK.md). Report rates with the same "±2 runs at
   K=5" caution; raise K to tighten.
5. **Model swapping.** The executor and the verifier are different Ollama models. On a single
   GPU that can't hold both, each `--verifier-model` call swaps weights (executor out, verifier
   in) and back — accepted (cost/speed are non-goals). Alternatives if it bites: size both to
   co-reside, or batch all executions then all verifications.
   This decoupled flow is implemented: `run --save-corpus <dir>` freezes each run's evidence +
   gold label, and `verify-corpus --corpus <dir> --verifier-model <id>` replays any candidate
   over that identical corpus (ornith runs once). See `benchmarks/README.md`.
6. **The verifier runs read-only.** It is invoked with `orn run --no-tools`, so pi disables all
   tools and the model's only way to answer is an inline reply. This is load-bearing: without
   it pi runs in the driver's cwd (the repo) with write tools live, and a tool-eager verifier
   writes its verdict to a *file* instead of returning it — polluting the tree and scoring as
   an unparseable reply → silent `uncertain`, which confounds the escalation rate. (Regression
   found and fixed 2026-07-10; see the journal.)

## Candidate shortlist (validate, don't assume)

Starting points for the first pass; the winner is whatever `verify-report` says, not this
list. The adjudication load is lighter than open-ended bug-hunting because the mechanics are
pre-computed, so a small model may suffice:

- **`qwen3-coder:30b`** (a3b MoE, ~17 GB Q4) — the dense-ish sweet-spot for modest hardware,
  and it co-resides with the 9.5 GB executor on a 48 GB machine (no per-run weight swap).
- **`qwen3.5:4b`** (~3.4 GB) — a floor candidate: is even a tiny general model a safe first
  pass? (In the 2026-07-10 campaign it was, at the lowest escalation — see the journal.)
- **`qwen3.6-35b-a3b-64k`** (~37 GB) — already used in the repo as the reliable tools-capable
  model; useful as a heavier **reference ceiling** to see how much the light models give up.
  Cannot co-reside with the executor on 48 GB, so it swaps weights every call.

> **Hardware note (validated 2026-07-10).** The `qwen3-coder-next` MoE is **~48 GB** at Q4
> (an 80B model), not the ~16 GB once assumed — it exceeds a 48 GB machine and is unfit as a
> local verifier there (its only smaller tag is `:cloud`, which is not local). `qwen3-coder`
> ships no 14b tag; `:30b` is the real light-coder option. Validate sizes with the ollama
> manifest before pulling.

## Success criteria for this experiment

- Produces `effectiveFalsePass` + escalation per candidate, over the benchmark suite incl.
  the in-place tasks.
- Every gold label traces to a mechanical oracle, never agent prose.
- Can conclude "no local model is safe enough; keep Claude primary" as cleanly as it can pick
  a winner.
- Re-runnable as new local models appear, suite and rubric unchanged.

Distil each campaign into `journal/YYYY-MM-DD-verifier-selection.md`.
