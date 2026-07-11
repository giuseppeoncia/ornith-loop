# Spec — `bench.mjs orchestrate` driver, milestone M1

_Date: 2026-07-12 · Status: approved design, pre-implementation · Topic: orchestrator-selection track 2_

Companion to [`docs/ORCHESTRATOR.md`](../../ORCHESTRATOR.md) (the experiment) and the
Phase-1 baseline in [`journal/2026-07-12-orchestrator-selection.md`](../../../journal/2026-07-12-orchestrator-selection.md).
This spec turns the "honest stub" `bench.mjs orchestrate` into a real driver that puts a
candidate **local** model in the orchestrator seat — for the first, incremental milestone.

## Goal

Produce, per (task, repeat), one scoring row for a candidate orchestrator model driving the
ornith-loop, so `orchestrate-report` can compute its **pass@N delta vs the Claude baseline**
and its **effectiveFalseSuccess**. The row schema is the one the baseline already used
(`ORCHESTRATOR.md §9`): `{ task, repeat, orchestratorModel, orchestratorOutcome, pass,
orchestratorRounds?, orchestratorReason? }`.

## Scope — M1 vs later

**M1 (this spec):** the candidate owns the two things it can own without recon extractors —
the **per-round loop-control decision** (done / retry / escalate) and the **corrective-grounding
synthesis** on a retry. **Recon is held fixed:** round-1 grounding is the frozen `grounding.md`,
identical to what Claude sent in the baseline.

**Deferred to M2 (out of scope):** deterministic recon extractors + candidate-driven grounding
selection (`ORCHESTRATOR.md §6.2`). Until then, recon is not delegated.

Rationale: `ORCHESTRATOR.md §6` prescribes incremental delegation, safest-first. Holding recon
fixed makes round-1 prompts identical to the baseline, so the **pass@N delta isolates the
quality of the corrective loop** — the hardest core (§5.4) — with no extractor build.

## Architecture

Approach A (chosen): the JS driver owns the mechanical loop; the candidate is invoked via
`orn run --no-tools` **only** for the per-round decision. Two presidia stay immovable (§4):

1. **Layer-0 oracle = anchor of truth**, used only for post-hoc scoring of the final workdir —
   never shown to the candidate.
2. **Layer-1 verifier (`qwen3.5:4b`, effFP=0 confirmed) stays a separate role.** The candidate
   does **not** verify its own runs — that would collapse verifier+orchestrator into one model
   ("three confabulators", §4). The candidate consumes the verifier's verdict.

## The loop — per (task, repeat), bounded to N rounds (default 3)

1. Assemble prompt = `goal` + accumulated grounding. Round 1 grounding = frozen `grounding.md`
   (recon fixed). Round r>1 = round-1 grounding + the corrective grounding the candidate
   authored on prior rounds (append-only, as `bench.mjs run --round --extra` does — a fresh
   workdir per round, not a continuation on the dirty tree).
2. `runOrn` the **executor** (ornith) into a fresh workdir. _(reuse existing `runOrn`)_
3. `gatherEvidence` — test output, staged diff, changed-file list. _(reuse existing)_
4. `adjudicate` with the **Layer-1 verifier** → `pass` / `fail` / `uncertain`. _(reuse existing
   `adjudicate` / `buildEvidencePacket` / `parseVerdict`)_
5. **Candidate orchestrator call** (`orn run --no-tools`): prompt = orchestrator rubric + goal +
   grounding-so-far + evidence packet + the verifier verdict/reason → JSON
   `{ action: "done"|"retry"|"escalate", grounding?, reason }`.
6. Dispatch on `action`:
   - `done` → stop; terminal outcome = **done**.
   - `retry` **and** rounds remain → append `grounding` to the accumulated grounding; next round.
   - `retry` **and** no rounds remain → stop; terminal outcome = **escalate**.
   - `escalate` → stop; terminal outcome = **escalate**.
7. After the loop: `runOracle` (Layer-0 gold) on the final workdir → boolean `pass`. _(reuse)_
8. Append the row to `results/<task>__orch-<orchestratorModel>.jsonl`.

`orchestratorRounds` = rounds actually run; `orchestratorReason` = the candidate's last `reason`.

## Components — new and touched

### `src/orchestrator.js` (pure, unit-tested)
- **New `parseRoundDecision(text)` → `{ action, grounding, reason }`.** Robust to prose /
  ```json fences (reuse the module's `extractJsonObject`). Closed action set
  `["done","retry","escalate"]`. **Golden rule (mirrors `parseVerdict` / `parseOrchestratorOutcome`):**
  anything not confidently `done` or a `retry` **with** non-empty grounding defaults to
  **`escalate`** — never fabricate a `done`, and a `retry` with no grounding fact is treated as
  `escalate` (it gave no corrective fact, so there is nothing to add — route to Claude).
- `parseOrchestratorOutcome` (existing) is unchanged; it still parses the terminal record shape.
  `parseRoundDecision` is the per-round decision; the terminal `orchestratorOutcome` is derived
  by the driver from the sequence (last `done` → done; ending in escalate / budget-exhaust → escalate).

### `orchestrator/rubric.md` (new)
Instructs the candidate as a **loop controller**, not a coder. Given the goal, the grounding
already sent, the mechanical evidence, and the Layer-1 verifier verdict for the last round,
decide `done` / `retry` / `escalate`. On `retry`, supply **one corrective grounding _fact_ the
run revealed was missing — never a step-by-step plan** (do not steal the nest). Escalate on
doubt. Emphasise calibration/restraint (§5.1) and that it must judge from evidence, never from
ornith's prose. Carries a stable sentinel header (e.g. `# ORCHESTRATOR DECISION`) so the driver
and the test fixture can recognise the call.

### `benchmarks/bench.mjs`
`cmdOrchestrate(o)` replaces the honest stub. Flags: `--task`, `--repeats` / `--repeat`,
`--orchestrator-model <id>` (required), `--verifier-model <id>` (default `qwen3.5:4b`),
`--rounds <N>` (default 3), `--results-dir <path>`. Reuses `loadTask`, `makeWorkdir`, `runOrn`,
`gatherEvidence`, `adjudicate`, `runOracle`, `keepAwake`. The `orchestrate` dispatch line
already exists (points at the stub) — repoint it. `orchestrate-report` is unchanged and already
consumes the rows. Row filename `results/<task>__orch-<slug>.jsonl` where `<slug>` is the
orchestrator model id with non-alphanumerics replaced (e.g. `gemma3:4b` → `gemma3-4b`), so a
model tag with a `:` yields a clean filename; the `orchestratorModel` field keeps the raw id.

### `test/fixtures/fake-pi.js`
Add a third recognised role: when the prompt carries the orchestrator sentinel
(`# ORCHESTRATOR DECISION`), emit a stubbed round decision (default `{action:"done"}`, overridable
via an env var e.g. `FAKE_PI_ACTION` / `FAKE_PI_GROUNDING`) — exactly as it already special-cases
`# EVIDENCE PACKET` for the verifier. This makes `orchestrate` dry-runnable end-to-end without ollama.

## Metrics & scoring

`orchestrate-report` already renders the scoring rollup and the per-task delta-vs-baseline
table. Honest note (to be stated in the journal when M1 runs): with **recon fixed**, round-1
prompts equal the baseline, so the **pass@N delta vs Claude isolates corrective-loop quality**.
`effFS` is expected to stay ≈0 because the Layer-1 verifier is reliable (effFP=0) — so in M1
`effFS` is a **safety check** (the presidium holding), not the discriminating metric; the
discriminating metric is the **pass@N delta**. M1 does not claim to measure recon quality.

## Testing

- **Unit** (`test/orchestrator.test.js`): `parseRoundDecision` — clean JSON; JSON in prose/fences;
  unknown/absent action → `escalate`; `retry` with empty/missing grounding → `escalate`;
  action set is closed.
- **Integration dry-run** (no ollama): `orchestrate --task T4-additive-hard --repeats 1
  --orchestrator-model fake` with `ORN_PI_BIN=fake-pi` (executor success + verifier pass +
  decision done) → exactly one row `orchestratorOutcome:"done"`. Assert the row shape and that
  `orchestrate-report` reads it.
- **Real run** (deferred to the run session): pick a candidate via `--orchestrator-model` — the
  §8 shortlist wants a disciplined ~4–14B tools-capable **instruct** model; none is pulled yet,
  so the model is chosen (and its ollama manifest size validated) at run time, not fixed here.

## Success criteria

- `bench.mjs orchestrate --orchestrator-model <id>` runs the bounded loop and emits one
  schema-correct row per (task, repeat), scored by the Layer-0 oracle.
- `orchestrate-report` shows the candidate row and a per-task pass@N delta vs the `claude` baseline.
- The dry-run path works with `fake-pi` (CI-safe, no ollama).
- Both presidia preserved: Layer-0 oracle scores; Layer-1 verifier is a separate model; the
  candidate never sees the gold label.
- `npm test` green.
