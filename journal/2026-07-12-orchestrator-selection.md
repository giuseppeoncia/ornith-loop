# orchestrator-selection — 2026-07-12

Phase-1 **baseline** for the orchestrator-selection campaign (`docs/ORCHESTRATOR.md`).
Question O1: can a lightweight *local* model drive the whole ornith-loop as well as Claude?
Before any candidate can be measured, we need the **reference row** — Claude-in-seat driving
the identical loop — and a validated `orchestrate-report`. This entry establishes both.

- **Host / orchestrator (this campaign's subject):** Claude Code (Opus 4.8), Claude-in-seat
  — i.e. the session itself did the grounding recon, minimal-scaffold prompt authoring,
  and corrective-grounding synthesis. `orchestratorModel: "claude"`.
- **Machine:** Mac17,8, 48 GB unified memory; ollama + pi 0.80.3, Node v24.16.0
- **Executor (the model being driven):** `ornith-1.0-9b-64k`, `--thinking off` (orn default)
- **Verification (Layer 0):** the per-task mechanical oracle (`benchmarks/tasks/*/oracle.mjs`)
  — suite green + scope check + (T6) a byte-guard on `roundCents`. The anchor of truth; no
  model verdict was allowed to override it.
- **Tasks:** `T6-inplace-hard`, `T4-additive-hard` — the two hard tasks the protocol
  (§7.3) names, where round-1 failures fire so the corrective loop (the orchestrator's hard
  core, step 5) is actually exercised.
- **Repeats (K):** 5 per task, no pinned seed (report rates with the ±2-runs-at-K=5 caution).
- **Corrective budget:** 3 rounds; corrective rounds are a fresh workdir + the round-1 prompt
  augmented with *grounding only* (mirrors `bench.mjs run --round N --extra`, not a
  continuation on the dirty tree).

## Method note — what "Claude-in-seat" did here

A small scratch harness (`orch.mjs`) owned only the mechanical glue — seed a git-clean
workdir from the task template, `orn run` the prompt into it, run the oracle, and print the
mechanical evidence (test output + staged diff + changed-file list). **Every prompt and every
done/escalate decision was Claude's**, from that ground-truth evidence — never ornith's prose.
The round-1 prompt was exactly `goal.md + grounding.md` (the disciplined minimal-scaffold
prompt); corrective grounding was authored by Claude from the observed failure.

## Results (`node benchmarks/bench.mjs orchestrate-report`)

```
Orchestrator vs oracle (sorted safest-first)
model                          n  autoPass  falseSucc  effFS  escalate
claude                        10  100%      0%     0%     0%
```

Per-task pass@N (autonomous, oracle-confirmed): **T6-inplace-hard 5/5**, **T4-additive-hard
5/5**. The per-task delta table is empty by construction — deltas are computed only for
*non-baseline* models, so it populates once track 2 produces candidate rows. Both tables were
independently confirmed to render (scoring rollup + per-task delta vs baseline) with a
throwaway candidate row, since removed.

**effectiveFalseSuccess = 0 %** — the safety bar. It is 0 by construction for the Claude
baseline: Claude declares `done` only after the Layer-0 oracle is green, so a `done` can never
sit on a red run. This is exactly the reference behaviour a local candidate must match (§3):
its `done` calls must be as trustworthy as Claude's.

## Per-repeat detail (gold label from the oracle, not agent prose)

**T6-inplace-hard** (in-place signature refactor across two files; `roundCents` is the
byte-exact corruption guard):

| repeat | rounds | outcome | note |
|---|---|---|---|
| k1 | 1 | done/pass | clean: `withTax(amount, rate)` + both call sites at `0.1`, roundCents intact, scope clean |
| k2 | 1 | done/pass | clean |
| k3 | 2 | done/pass | **round-1 source edits were correct**, but ornith ran `npm` and created an out-of-scope `package-lock.json` → oracle scope-fail. Corrective grounding (below) → round-2 clean |
| k4 | 1 | done/pass | clean (churny: 21 tool calls, but correct + in scope) |
| k5 | 1 | done/pass | clean |

**T4-additive-hard** (add a `pow` operator; two coordinated edits — implement in `ops.mjs`,
register in `registry.mjs`):

| repeat | rounds | outcome | note |
|---|---|---|---|
| k1 | 1 | done/pass | clean: pow implemented + registered, scope clean |
| k2 | 1 | done/pass | clean |
| k3 | 1 | done/pass | clean |
| k4 | 2 | done/pass | **round-1 destructive**: ornith *deleted* the entire `evaluate()` from `registry.mjs`, added a `pow` import with no matching `ops.mjs` export (→ SyntaxError), and never touched `ops.mjs`. Corrective grounding (below) → round-2 clean |
| k5 | 1 | done/pass | clean |

## Failure modes observed (round 1) and the corrective grounding that fixed them

Round-1 clean rate was **8/10** (4/5 each task). The two failures are the two the tasks were
designed to provoke, and both were fixed by adding a *fact*, never a step:

- **T6-k3 — out-of-scope file via a package-manager call.** ornith's edits were right but it
  ran `npm`, creating a tracked `package-lock.json` the scope check rejects. Missing fact:
  *"do not run npm — `node --test` needs no install, and npm creates a tracked lockfile that
  is out of scope; only `src/pricing.mjs` and `src/checkout.mjs` may differ."* This is
  grounding (an environment fact it could not derive), not scaffold.
- **T4-k4 — destructive partial edit (ornith's known in-place corruption mode).** It deleted
  `evaluate()` and edited only one of the two files. Missing fact: *"this is purely additive —
  preserve every existing function including `evaluate`; both files must change; an import of
  `pow` with no `ops.mjs` export is a SyntaxError."* Again a state fact + the additive
  constraint, not a numbered plan.

Both diagnoses are precisely the "corrective-grounding synthesis" that `ORCHESTRATOR.md §1/§5`
flags as one of the two genuinely model-hard cores of the role — the sub-task a local
candidate is *least* likely to own and most likely to have to escalate.

## Reading — what the baseline tells us for O1

- The reference is now concrete: **pass@N = 100 % on both hard tasks, effFS = 0 %, escalation
  0 %, with a mean of 1.2 corrective rounds** (2 of 10 repeats needed a round 2). A local
  candidate "matches Claude" only if it reaches this pass@N *without* its `done` calls ever
  sitting on a red oracle (effFS ≈ 0).
- The corrective rounds are the interesting part for candidate selection: both required
  reading a diff/test-output and synthesizing a missing *fact*. A tool-happy or over-helpful
  small model will tend to respond with a step-by-step rewrite (stealing the nest) instead —
  which is exactly the calibration trait §5.1 says decides the role. Track 2 must measure that.

## Threats / caveats

- **K=5, no pinned seed** — rates carry ±2-runs variance; the round-1 clean rate especially is
  a small-sample estimate. Raise K to tighten before drawing model-comparison conclusions.
- **Baseline effFS = 0 is structural, not empirical luck** — Claude gates `done` on the oracle,
  so it *cannot* false-succeed here. The metric only becomes discriminating for candidates that
  might declare `done` without (or against) an oracle check. That is the whole point of the
  presidium in §4.
- **Corrective-round semantics** (fresh workdir + augmented prompt) match the existing
  `bench.mjs` arm-A convention; a "continue on the dirty tree" variant would be a different
  experiment.
- Run records under `runs/` are ephemeral; the mechanical facts (oracle verdict, changed
  files, diff shape) are embedded above.

## Next (track 2)

Build the agentic `bench.mjs orchestrate` driver so a *candidate local* model sits in the seat
and drives this same loop autonomously, emitting one row per (task, repeat) in the schema this
baseline used. Then the delta-vs-claude table (empty here) becomes the headline. Candidate
shortlist and the calibration-over-size caution: `ORCHESTRATOR.md §5/§8`.
