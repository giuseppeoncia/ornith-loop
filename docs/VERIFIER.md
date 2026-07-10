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

## Candidate shortlist (validate, don't assume)

Starting points for the first pass; the winner is whatever `verify-report` says, not this
list. The adjudication load is lighter than open-ended bug-hunting because the mechanics are
pre-computed, so a small model may suffice:

- **`qwen3-coder-next`** — MoE, ~3B active / ~80B total, runs in ~16 GB; strong code
  comprehension at a light footprint — a good swap-in verifier.
- **`qwen3-coder-14b`** (Q4) — dense sweet-spot for modest hardware.
- **`qwen3.6-35b-a3b-64k`** — already used in the repo as the reliable tools-capable model;
  useful as a heavier **reference ceiling** to see how much the light models give up.

## Success criteria for this experiment

- Produces `effectiveFalsePass` + escalation per candidate, over the benchmark suite incl.
  the in-place tasks.
- Every gold label traces to a mechanical oracle, never agent prose.
- Can conclude "no local model is safe enough; keep Claude primary" as cleanly as it can pick
  a winner.
- Re-runnable as new local models appear, suite and rubric unchanged.

Distil each campaign into `journal/YYYY-MM-DD-verifier-selection.md`.
