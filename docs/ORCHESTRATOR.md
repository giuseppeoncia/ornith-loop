# ornith-loop — Local orchestrator selection

_Status: design (no orchestrator-selection runner implemented yet). Selection would run on a
local ollama workstation, not in a remote container._

Companion to [`DESIGN.md`](DESIGN.md) (the three roles), [`BENCHMARK.md`](BENCHMARK.md) (the
method experiment and its oracle-scored suite), and [`VERIFIER.md`](VERIFIER.md) (which this
doc deliberately parallels). It answers one question with evidence:

> Can the **orchestrator** — the host that runs the `ornith-loop` skill, today Claude — also
> be a **lightweight local model that does only that job**, keeping Claude as an escalation
> tier? And what must such a model have?

The repo has been peeling roles off Claude one at a time, each move anchored to the
mechanical oracle and settled by a falsifiable campaign, not by assertion:

- **Layer 0 verification** was always local (the mechanical oracle — `BENCHMARK.md`).
- **Layer 1 verification** is now delegated to a lightweight local model (`qwen3.5:4b`,
  effFP = 0 % confirmed at K=20 — `journal/2026-07-10-verifier-selection.md`), with Claude
  kept only as the audit tier for `fail` / `uncertain`.

The orchestrator is the logical next peel. The short answer is **feasible as _local-first
with escalation_, not as a wholesale swap** — for the same reason the verifier is: a fully
local loop must not become three confabulators in a row (§4).

## 1 · The role being filled

The orchestrator is what the [`ornith-loop` skill](../skill/ornith-loop/SKILL.md) encodes —
six steps. It is a **loop controller** with a few genuinely-cognitive cores wrapped in
mechanical glue. Decomposed by delegability:

| Sub-task (skill step) | Nature | Delegability status |
|---|---|---|
| **1 · Grounding recon** — real paths, versions, test command, routes, selectors | agentic codebase comprehension | **hard core** — un-mechanized |
| **2 · Minimal-scaffold prompt authoring** — goal + grounding, then _stop_ | discipline / restraint | **already mechanical** in the benchmark — the arm prompt is assembled from `goal.md` + `grounding.md` (`src/bench.js`), no model needed |
| **3 · `orn run`** | mechanical | already CLI-only |
| **4 · Verification** — Layer 0 oracle + Layer 1 reviewer | deterministic + judgement | **already delegated** — Layer 0 local; Layer 1 → `qwen3.5:4b` |
| **5 · Corrective-grounding synthesis** — diagnose the failure, add the missing _fact_ (never a step), bounded to N | diagnosis + fact synthesis | **hard core** — highest escalation candidate |
| **6 · Journal** — write the entry from ground-truth signals | templated write over ground truth | low risk |

So the loop's mechanical parts (3), record-keeping (6), and verification (4) are already
delegated or trivially delegable, and on the *benchmarked* path even the prompt (2) is pure
templating. **Only two sub-tasks are genuinely model-hard and un-mechanized: grounding recon
(1) and corrective-grounding synthesis (5).** They are the whole question.

Both share the discipline the project is named for: the orchestrator must supply *grounding*,
never *scaffold*. Its hardest job is not producing text — it is **restraint** (step 2) and
**correct diagnosis without spoon-feeding** (step 5). That reframes what "capable enough"
means (§5).

## 2 · The falsifiable question

**O1 — "a local model can drive the loop":** there exists a lightweight local model that, as
the orchestrator, matches **Claude-orchestrated `pass@N`** on the frozen benchmark suite, at
an escalation rate low enough to be worth it. If no candidate reaches Claude's `pass@N`
without escalating almost every non-trivial decision, the honest conclusion is *"keep Claude
as the orchestrator"* — a valid, publishable outcome, exactly as `VERIFIER.md` V1 lets
"keep Claude primary" be a clean result.

Directional and falsifiable. Rejecting O1 does **not** contradict the project's thesis (the
thesis is about the *executor's* self-scaffolding, not about who orchestrates); it only bounds
how far the human-in-the-loop can be automated away.

## 3 · The metric that can sink the design

The verifier campaign was cheap to run because Layer 0 handed it **gold labels for free** —
every run has a mechanical pass/fail. The orchestrator has **no per-decision oracle**: "is
this the right grounding?" and "is this prompt minimal-enough?" have no mechanical pass/fail.
This is the structural difference from `VERIFIER.md`, and it is why the orchestrator is the
harder role to validate.

The way through: **the benchmark suite is itself an end-to-end oracle.** You do not need to
score individual decisions — you score the *loop's outcome*.

- **Primary metric — `pass@N` delta vs the Claude baseline**, per task, over K repeats. A
  candidate orchestrator drives arm A (grounding + minimal scaffold + corrective loop) end to
  end; the task oracle (`benchmarks/tasks/*/oracle.mjs`) scores each attempt. Compare to
  Claude driving the identical arm. `≈ 0` delta = the local orchestrator lost nothing.
- **The metric that can sink it — `false-success` / `false-stop`**, the orchestrator's analog
  of the verifier's `effectiveFalsePass`. Of the runs the local orchestrator **declares done
  / stops the loop on**, how many does the oracle say **fail**? This is the asymmetric error:
  shipping a broken run as finished. Since ornith already confabulates success, an
  orchestrator that also rubber-stamps a broken result is worse than none. It must be `≈ 0`.
- **Cheap error — over-escalation.** Escalating a decision it could have made only costs a
  Claude audit; a wrong "stop, this passed" costs a shipped failure. So, as with the verifier,
  pick the **lightest** model with `false-success ≈ 0`, then break ties by the **lowest
  escalation rate**.

The scoring path stays mechanical and arm-agnostic: the oracle reads workdir + `runs/<id>.json`,
never any agent's prose — the same anti-confabulation discipline as `BENCHMARK.md`.

## 4 · The load-bearing constraint — do not create three confabulators

`DESIGN.md` warns that a lone local reviewer plus a confabulating executor is **"two
confabulators in a row [that] erase the only independent check."** Replacing the orchestrator
compounds this: executor + verifier + orchestrator all small-local would remove every
competent independent check from the common path.

So a local orchestrator is only admissible with **two presidia kept immovable**:

1. **Layer 0 — the mechanical oracle — stays the anchor of truth.** A red test or an
   out-of-scope diff overrides any model, orchestrator included. (On real tasks with no
   oracle, the *mechanical* part — running tests, computing the diff — is still done by the
   host, not a model.)
2. **Claude stays the escalation tier.** On doubt — a failure it cannot diagnose, a decision
   below its confidence bar — the local orchestrator **escalates rather than guesses**, the
   verifier's `uncertain` safety-valve lifted up to orchestration.

The design is therefore **local-first with escalation**, identical in shape to the two-tier
verifier — not a bare swap. A full-local *common path* with a Claude *audit tier* preserves
the one independent check the project refuses to lose.

## 5 · Characteristics the orchestrator model needs

Ordered by importance. The verifier campaign's headline — *"size is not the lever,
calibration is"* — applies with even more force here, because the orchestrator's failure mode
is **over-helping**, not under-capability.

1. **Calibration / restraint over helpfulness (the decisive trait).** Most instruct models
   are RLHF-tuned toward maximal helpfulness, which *is* step-by-step scaffold — i.e. stealing
   the nest. The orchestrator must hold a tight "goal + facts, **zero steps**" line and must
   **escalate on doubt** instead of spoon-feeding. A well-calibrated small model beats a
   capable but eager large one here.
2. **Reliable, parsable function-calling.** Grounding recon is agentic (Read / Grep / Bash).
   Avoid the two documented failure modes: `ornith-1.0-9b` emits tool calls only
   intermittently, and `qwen3-coder:30b` *wrote its answer to a file* instead of replying
   (`journal/2026-07-10-verifier-selection.md`). Want a disciplined **tools-capable instruct**
   model, **not** a tool-happy coder model.
3. **Codebase comprehension — reduced to selection.** Recon is the sub-task most sensitive to
   model size. The move that made a 4 B verifier viable was **pre-computing the mechanics** so
   the model only *selects/adjudicates*. Apply it here: deterministic extractors gather most
   grounding (parse `package.json`, detect the test command, `git grep` paths/routes/selectors),
   and the model's job shrinks to *selecting and assembling* the relevant facts — narrow job
   → small model plausibly suffices.
4. **Failure diagnosis for corrective grounding.** The hardest reasoning in the loop:
   read run-signals + diff + oracle verdict and synthesize the *missing fact* (not just judge
   pass/fail, as the verifier does). This is the **#1 escalation candidate** — do not force a
   small model to own it; let it escalate to Claude when the diagnosis is not obvious.
5. **Determinism (low temperature).** It is a controller, not a creative writer —
   reproducibility matters more than variety.
6. **Hardware co-residence.** On the 48 GB reference machine, executor (`ornith-9b`, ~9.5 GB)
   + verifier (`qwen3.5:4b`, ~3.4 GB) + orchestrator must fit. A ~4–14 B orchestrator
   co-resides with both (no weight-swap); a large one forces per-call swaps that dominate
   wall-clock, as the 37 GB verifier ceiling did. Another pressure toward *smallest that is
   calibrated enough*.

## 6 · Delegation order (safest → hardest)

Peel the role incrementally, oracle-anchored, exactly as the verifier was adopted:

1. **Journal (6), `orn` invocation (3), prompt assembly (2), Layer-1 verify (4)** — ≈ 0 risk
   or already delegated. Do these first / they are effectively done.
2. **Grounding recon (1)** — delegate *via pre-compute*: deterministic extractors do the
   gathering, the model only selects.
3. **Corrective-grounding synthesis (5)** — last, and keep the Claude escalation path live.
   This is where local-first most needs its audit tier.

## 7 · Protocol — the "orchestrator-selection" campaign

Mirrors `VERIFIER.md` §Protocol:

1. **Gold labels come free** from the benchmark oracles, as always.
2. **Run the frozen suite with the candidate as orchestrator**, driving arm A end to end
   (recon → minimal-scaffold prompt → `orn run` → verify → bounded corrective loop). Compare
   `pass@N` per task to the **Claude-orchestrated** baseline; record `false-success` /
   `false-stop` and the escalation rate.
3. **Span the failure modes.** Include the hard tasks **`T6-inplace-hard`** and
   **`T4-additive-hard`** — the ones where round-1 failures actually fire, so the corrective
   loop (step 5, the hard core) is genuinely exercised and not saturated away. Easy/medium
   tasks (T1–T3) alone would never test the orchestrator where it matters (cf. the pilot's
   ceiling effect, `journal/2026-07-08-benchmark-pilot.md`).
4. **K repeats, no pinned seed** (BENCHMARK.md convention); report rates with the same
   "±2 runs at K=5" caution; raise K to tighten.
5. **Keep Layer 0 as gold and Claude as audit tier** throughout (§4). The candidate's declared
   successes are checked against the oracle; its escalations are served by Claude and counted.
6. **Model swapping / co-residence** as in `VERIFIER.md` §5: prefer executor + verifier +
   orchestrator co-resident on 48 GB to avoid per-call weight swaps.

## 8 · Candidate shortlist (validate, don't assume)

Starting points only — the winner is whatever the campaign says, not this list. Verified
against the ollama registry in July 2026; re-check before pulling (sizes/tags drift, and the
verifier campaign already caught the registry advertising wrong ones).

**First, split the requirement by role — it changes what "capable enough" means:**

- The **Layer-1 verifier** and the **orchestrator in milestone M1** both answer *inline* via
  `orn … --no-tools` (a structured JSON verdict / a `done`·`retry`·`escalate` decision). They
  make **no tool calls**, so function-calling ability is *not* the constraint for them —
  calibration and instruction-adherence (§5.1) are. A weak tool-caller that is a disciplined
  *instruct* model is perfectly admissible here.
- Function-calling only becomes load-bearing at **M2**, where the orchestrator does *agentic*
  grounding recon (Read / Grep / Bash). Weigh tool-calling reliability only for that milestone.

So don't exclude a well-calibrated model just because its family is a weak tool-caller: test it
for the inline roles first, and gate on tool-calling only when M2 lands.

**Candidates that co-reside on 48 GB** alongside the executor (`ornith-1.0-9b`, ~9.5 GB) and
the 4 B verifier (`qwen3.5:4b`, ~3.4 GB) — leaving ~35 GB — with their Q4 download sizes:

| Model | Q4 size | Family tool-calling | Notes |
|---|---|---|---|
| `qwen3:8b` / `qwen3:14b` | 5.2 / 9.3 GB | strong (trained for it) | same family as the confirmed verifier; natural first pick + reference |
| `gemma4:e4b-it` | 9.6 GB | reportedly weak (Gemma) — **test, don't assume** | latest-gen Gemma, effective-4 B footprint; strong *inline* candidate (verifier / M1) |
| `gemma4:12b-it` | 7.6 GB | reportedly weak (Gemma) — **test, don't assume** | denser Gemma 4, still co-resident |
| `llama3.1:8b` | ~4.9 GB | wide tool support | cross-family diversity; the M2-friendly option |

Explicitly **not** a tool-happy coder model (`qwen3-coder:30b` failed the reply-inline
discipline as a verifier; the orchestrator's M2 recon would only make that worse). `llama4` is
MoE-only (16×17B / 128×17B) and does not co-reside — out of class. Gemma 4's `26b-a4b` (18 GB)
and `31b` (20 GB) fit but abandon the "smallest calibrated" principle (§5); hold them as
heavier references only.

> Validate sizes/tags against the ollama registry before pulling — the verifier campaign found
> advertised sizes wrong (`qwen3-coder-next` was 48 GB, not ~16 GB; a claimed `qwen3-coder-14b`
> tag did not exist). And the "Gemma is a weak tool-caller" note above is a *reported* prior
> from secondary sources, not a measured result — the campaign tests it, it does not trust it.

## 9 · Mapping onto the existing tooling (the skeleton)

The scoring layer exists; the agentic execution driver does not — the same split
`BENCHMARK.md` drew for `orn bench` ("this doc is the spec it would implement").

**Built (pure, unit-tested — `src/orchestrator.js`, mirrors `src/verifier.js`):**
- `parseOrchestratorOutcome(text)` — parses the orchestrator's terminal declaration into
  `{ outcome, roundsUsed, reason }`. Golden rule, as with the verifier: anything not clearly
  `done` defaults to **`escalate`** — a confabulated or unparseable "I'm finished" routes to
  Claude, never ships silently.
- `scoreOrchestrator(rows)` — per-model rollup with the safety metric
  **`effectiveFalseSuccess` = P(oracle fail | outcome `done`)**, plus `autonomousPassRate`
  and `escalationRate`; sorted safest-first (§3).
- `orchestratorDeltas(rows, {baselineModel})` — per-task **pass@N delta vs the Claude
  baseline** (§3, primary metric).
- `benchmarks/bench.mjs orchestrate-report [--baseline <model>]` — prints both tables over
  `benchmarks/results/*.jsonl`, exactly as `verify-report` does for the verifier.

**Row schema** (append to `benchmarks/results/*.jsonl`, as the verifier pilot did
semi-manually): `{ task, repeat, orchestratorModel, orchestratorOutcome: "done"|"escalate",
pass: <oracle gold label>, orchestratorRounds?, orchestratorReason? }`. Baseline rows use
`orchestratorModel: "claude"`.

**Built (M1, 2026-07-12):** `bench.mjs orchestrate --task <id> --orchestrator-model <id>
[--repeats N]` puts a candidate LOCAL model in the orchestrator seat and runs it through the
loop (fixed round-1 recon → `orn run` executor → evidence → `qwen3.5:4b` verifier → the
candidate's `done`/`retry`/`escalate` decision → bounded corrective rounds), emitting one row
per (task, repeat). In M1 the recon is held fixed (round-1 grounding = the frozen
`grounding.md`) so the pass@N delta isolates the *loop*, not grounding assembly. Results in
§11. The Phase-1 Claude-in-seat baseline was driven semi-manually and scored the same way
(`orchestratorModel: "claude"`), the phasing `BENCHMARK.md` used.

**Built (M2, 2026-07-13):** `bench.mjs orchestrate --recon candidate` delegates the round-1
recon — deterministic extractors (`src/recon.js`) build a fact-pool (test command, file tree,
`package.json`, goal-token grep hits + the source of hit-files; answer-keys excluded), the
candidate assembles round-1 grounding from it inline (`orchestrator/recon-rubric.md`,
`parseGrounding`), and the M1 loop runs unchanged. `bench.mjs recon --task <id>` prints the
fact-pool; `orchestrate-report` partitions by `reconMode` and shows the candidate-M2-vs-own-M1
delta. Spec: `docs/superpowers/specs/2026-07-12-orchestrate-driver-m2-design.md`; results land
in §11 once the run session completes.

## 10 · Success criteria for this experiment

- Produces, per candidate, the **`pass@N` delta vs Claude** and the **`false-success` rate**
  over the benchmark suite, including the hard in-place / additive tasks that exercise the
  corrective loop.
- Every gold label traces to a mechanical oracle, never agent prose.
- Can conclude **"no local model is safe/capable enough; keep Claude as orchestrator"** as
  cleanly as it can pick a winner (the O1 honest-null).
- Preserves the two presidia (§4) in every configuration tested: Layer 0 oracle as anchor,
  Claude as escalation tier.
- Re-runnable as new local models appear, suite and skill unchanged.

Distil each campaign into `journal/YYYY-MM-DD-orchestrator-selection.md`.

## 11 · Results — candidate sweep (2026-07-12, M1)

The findings. Full narrative + per-candidate reading in
[`../journal/2026-07-12-orchestrator-selection-2.md`](../journal/2026-07-12-orchestrator-selection-2.md)
(and the Phase-1 baseline in `…-orchestrator-selection.md`); this section is the durable record
of the numbers. Reproduce with `node benchmarks/bench.mjs orchestrate-report`.

**Run matrix.** Host: Mac17,8, 48 GB unified memory; ollama 0.31.2 + pi 0.80.3, Node v24.16.0.
Executor `ornith-1.0-9b-64k` `--thinking off` (exact build: `benchmarks/README.md` → "The
executor model (exact build)"). Layer-1 verifier `qwen3.5:4b` (separate model, §4). Tasks
`T6-inplace-hard` + `T4-additive-hard`; K=5 per (candidate, task), no pinned seed; corrective
budget 3 rounds; M1 fixed recon. Five §8 candidates + the Claude baseline (n=10 each).

```
model                          n  autoPass  falseSucc  effFS  escalate
claude                        10   100%      0%         0%     0%     (baseline)
llama3.1:8b                   10   100%      0%         0%     0%
qwen3:14b                     10   100%      0%         0%     0%
gemma4:e4b                    10    90%      0%         0%    10%
qwen3:8b                      10    90%      0%         0%    10%
gemma4:12b                    10    80%      0%         0%    20%

Per-task pass@N delta vs baseline 'claude' (passN = loop self-finished 'done' AND oracle PASS;
                                            an escalate routes to Claude and is NOT a passN)
task              model        passN  baseN  delta
T4-additive-hard  gemma4:12b    60%    100%   -40%     (2/5 escalated: 1 correct-fail, 1 over-caution)
T6-inplace-hard   gemma4:e4b    80%    100%   -20%     (1/5 escalated: correct-fail, caught corruption)
T6-inplace-hard   qwen3:8b      80%    100%   -20%     (1/5 escalated: over-caution on a passing run)
  …all other (candidate × task) cells: passN 100%, delta 0%
```

**The headline — `effectiveFalseSuccess = 0 % for every candidate.`** None of the five local
models ever shipped a broken run as `done` (O1 safety bar met across the shortlist). Every
negative delta is an escalation to the Claude audit tier, **not** a shipped failure — the two
presidia (§4) held in every configuration. Two escalations were *correct refusals* of genuine
failures (`gemma4:e4b` caught in-place `roundCents` structural corruption; `gemma4:12b` refused
after exhausting the retry budget); two were *over-caution* on runs the oracle passed (the cheap
error). Corrective loops recovered runs at rounds 2–3 for every model, with `done` reasons
citing real evidence (test exit 0, in-scope files, `roundCents` intact).

**Reading.** `llama3.1:8b` (~4.9 GB, the *smallest* tested) and `qwen3:14b` match Claude exactly
(100 % autoPass, 0 escalate) — restraint + a working loop, not size, is what the M1 seat needs.
`gemma4:e4b` and `qwen3:8b` are safe at 90 % autoPass (one escalation each). `gemma4:12b` is the
weakest (80 %) and — notably — *more* cautious than the smaller `gemma4:e4b`: size did not buy
calibration, echoing the verifier campaign's "calibration, not size" finding (`VERIFIER.md` →
Results). **Ranking (all effFS 0):** `llama3.1:8b` ≈ `qwen3:14b` > `gemma4:e4b` ≈ `qwen3:8b` >
`gemma4:12b`.

**Caveats.** K=5 / no seed → ±~2-runs noise; the −20/−40 % deltas are 1–2 escalations, within
noise, so the robust findings are the *ordering* and effFS=0, not exact rates. `passN` penalises
correct refusals by construction (a caught failure scores as a non-pass) — read it as *autonomy
vs Claude*, and `effFS` as *safety*. M1 held recon fixed; M2 (§6.2) will test whether a candidate
can also assemble the grounding.
