# Spec — `bench.mjs orchestrate` driver, milestone M2 (delegated recon)

_Date: 2026-07-12 · Status: approved design, pre-implementation · Topic: orchestrator-selection track 2, M2_

Companion to [`docs/ORCHESTRATOR.md`](../../ORCHESTRATOR.md) (the experiment, §5.3 / §6.2) and
the [M1 spec](2026-07-12-orchestrate-driver-m1-design.md). M1 put a candidate in the
orchestrator seat but **held recon fixed** (round-1 grounding = the frozen `grounding.md`), so
its pass@N delta isolated the *corrective loop*. M2 delegates the **recon** itself: the
candidate assembles round-1 grounding from a deterministic fact-pool, instead of being handed
the gold `grounding.md`.

## Goal

Answer, with oracle-anchored evidence: **can a candidate local model assemble adequate round-1
grounding itself** — from the output of deterministic extractors — rather than being handed the
hand-authored gold grounding? This isolates the **recon-selection** sub-task, the part §5.3
calls the most size-sensitive, by reducing recon to *pre-compute the mechanics, model only
selects/assembles* — the exact move that made a 4 B verifier viable.

Per (task, repeat) it still emits one scoring row `orchestrate-report` can read; the new axis is
`reconMode: "candidate"` (vs M1's implicit `"fixed"`).

## Scope — M2 vs M1 vs later

**M2 (this spec):** the candidate additionally owns **round-1 grounding assembly** — it selects
and phrases grounding *facts* from a deterministic fact-pool. Delivery is **pre-compute + select**
(`ORCHESTRATOR.md §6`, the safest-first path): deterministic JS extractors gather; the candidate
answers **inline** (`orn run --no-tools`), no function-calling. Everything from round 1 onward is
the **M1 loop, unchanged**.

**Not in scope — a later milestone (M3):** *agentic* recon where the candidate itself drives
Read/Grep/Bash tools to explore the repo (`ORCHESTRATOR.md §5.2` / §8 — where function-calling
becomes load-bearing). M2 deliberately keeps tools out of the critical path so the result speaks
to *selection/assembly*, not tool-calling reliability.

Rationale: `§6` prescribes delegating recon **via pre-compute** before anything agentic. Holding
the loop identical to M1 means the **M2−M1 pass@N delta (same candidate) isolates the cost of
self-assembled recon** against gold recon, with no confound from loop changes.

## Architecture

Two presidia stay immovable (§4), exactly as M1:

1. **Layer-0 oracle = anchor of truth**, post-hoc scoring of the final workdir only — never
   shown to the candidate.
2. **Layer-1 verifier (`qwen3.5:4b`, effFP=0) stays a separate role.** The candidate does not
   verify its own runs.

M2 inserts **one new step before round 1** — deterministic extraction → candidate recon-assembly
→ the assembled text becomes the round-1 grounding — then runs the M1 loop for rounds 1..N.

```
[extractors: pure JS]            [candidate: orn --no-tools]        [M1 loop, unchanged]
 workdir + goal.md  ──▶ fact-pool ──▶ SELECT/ASSEMBLE ──▶ round-1  ──▶ executor ─▶ evidence
                                        grounding (facts)   grounding      ▲          │
                                                                           │      Layer-1 verify
                                                             corrective ───┘          │
                                                             grounding ◀── done/retry/escalate
                                                                          (candidate decision)
                                                                                      │
                                                             final workdir ─▶ Layer-0 oracle (gold)
```

## The recon step (new, M2-only)

### 1 · Deterministic extractors — `src/recon.js` (pure, unit-tested)

Task-agnostic JS. **No model, no judgment, no network.** Input: the run workdir (a fresh
`makeWorkdir(task)` checkout) + the goal text. Output: a structured `factPool` object and a
rendered text block. Fields:

- `testCommand` — `meta.testCmd` joined (e.g. `node --test`). Legitimate grounding (how to run
  the tests); M1's `grounding.md` states it too.
- `fileTree` — tracked files via `git -C <wd> ls-files` (the workdir is a git checkout;
  `makeWorkdir` already `git init`s + commits). Excludes nothing extra — the template has no
  `node_modules`.
- `packageJson` — if present: `{ name, scripts, engines }` only (not the whole file).
- `goalTokens` — identifiers extracted from `goal.md`, **deterministically**: (a) all backtick
  spans, (b) identifier-like words matching `/[A-Za-z_$][A-Za-z0-9_$]*/` that are camelCase or
  appear in backticks. Lowercased dedupe; drop a small stoplist of English words. (e.g. T6 →
  `withTax`, `roundCents`, `lineTotal`, `cartTotal`.)
- `grepHits` — for each token, `git -C <wd> grep -n -F <token>` → `{ token, file, line, text }[]`,
  capped (e.g. ≤ 40 hits total, note if truncated).
- `sourceOfHitFiles` — full contents of the **distinct files** that grep hits land in (source +
  test files), deduped, each capped (e.g. ≤ 400 lines / ≤ 16 KB, note if truncated).

**Hard exclusion (load-bearing):** never read or surface `meta.allowedChangedFiles` (the
oracle's scope answer-key) or `oracle.mjs` / `grounding.md` / `scaffold-heavy.md` (the gold
recon and its variants). The extractor sees the *template repo + goal + testCmd* only — the same
information a real task ships. This is the analogue of the verifier's evidence packet excluding
the answer-key.

`renderFactPool(factPool) → string` produces a stable, sectioned `# RECON FACT-POOL` block.

### 2 · Candidate recon-assembly call — `orn run --no-tools`, inline

Prompt = `orchestrator/recon-rubric.md` + `## GOAL` + the rendered fact-pool. The rubric asks
the candidate to reply with a single JSON object **`{ "grounding": "<facts as a markdown
bullet list>" }`** (same shape discipline as the M1 decision call, so one parser style covers
both). The `grounding` string is a set of grounding **facts** (paths, current vs required
signatures, constraints like "keep X byte-exact", the test command). Parsed by a new
`parseGrounding(text)` = `extractJsonObject` → read `.grounding`; if no parseable object, fall
back to the stripped fenced/plain body; blank → `{ empty: true }`. Its content is used
**verbatim** as round-1 grounding — we do **not** sanitize or rewrite it; whether it stays
"facts, not steps" is part of what we measure.

- **Empty / unusable output** → send *goal only* as round-1 grounding (an honest recon failure;
  the loop then does its normal thing). Recorded via a row flag `reconEmpty: true` for the journal.
- The recon-assembly call is **round-0**; it does not count toward the corrective-round budget.

### 3 · `orchestrator/recon-rubric.md` (new)

Instructs the candidate as a **grounding assembler, not a coder and not a planner**. Given the
goal and the mechanical fact-pool, select the facts the executor will need and state them as
grounding: real paths, current code vs. required shape, invariants to preserve, the test command.
**Forbid step-by-step plans / ordered procedures** ("first…, then…") — that is scaffold, and
stealing the nest is the one thing the wrapper must not do (`ORCHESTRATOR.md §5.1`, DESIGN.md).
Emphasise: include only facts supported by the fact-pool (do not invent); prefer omission to
guessing. Carries a stable sentinel header `# RECON ASSEMBLY` so the driver and the `fake-pi`
fixture can recognise the call (mirrors `# ORCHESTRATOR DECISION` / `# EVIDENCE PACKET`).

## The loop — per (task, repeat)

Identical to the M1 spec §"The loop" **except step 0**:

0. **(M2 only)** `factPool = extractRecon(wd, goalText)` → candidate recon-assembly call →
   `round1Grounding`. In M1 this was `t.parts.grounding` (frozen). Everything below is unchanged.
1. Round-1 grounding = `round1Grounding`; round r>1 = round-1 grounding + accumulated corrective
   grounding (append-only, fresh workdir per round).
2. `runOrn` executor into a fresh workdir. 3. `gatherEvidence`. 4. `adjudicate` (Layer-1
   verifier). 5. Candidate `done`/`retry`/`escalate` decision (M1's `parseRoundDecision`).
6. Dispatch (done → stop; retry+budget → append + continue; retry-no-budget / escalate → stop
   escalate). 7. `runOracle` on the final workdir. 8. Append the row.

Note the fact-pool is computed **once per repeat** from a clean checkout (deterministic given the
template), reused across corrective rounds — recon is a round-0 activity, not re-run per round.

## Components — new and touched

### `src/recon.js` (new, pure)
`extractRecon(workdir, goalText, { testCmd }) → factPool`, `renderFactPool(factPool) → string`,
`extractGoalTokens(goalText) → string[]`. No I/O beyond reading files in `workdir` and spawning
`git ls-files` / `git grep` in it (sync, like the existing helpers). Never touches `meta.json`'s
`allowedChangedFiles` / `oracle.mjs` / `grounding.md`.

### `src/orchestrator.js` (touched)
Add **`parseGrounding(text) → { grounding, empty }`** with the same defensive posture as
`parseRoundDecision`: `extractJsonObject` → `.grounding`; fall back to the stripped body if no
object parses; blank/whitespace → `{ grounding: "", empty: true }`. `parseRoundDecision` /
`parseOrchestratorOutcome` unchanged.

### `benchmarks/bench.mjs` (touched)
- `cmdOrchestrate(o)` gains **`--recon fixed|candidate`** (default `fixed` → today's M1 path,
  fully back-compat). When `candidate`: run the recon step (0) to get round-1 grounding, tag rows
  `reconMode:"candidate"`, and write to a **separate file** `results/<task>__orch-<slug>-recon.jsonl`
  (M1 `fixed` rows keep `results/<task>__orch-<slug>.jsonl` untouched, avoiding mixed-mode append).
- New **`cmdRecon(o)`**: `bench.mjs recon --task <id>` prints the rendered fact-pool for a task
  (fresh workdir) and exits. Transparency + lets the **Claude-M2 ceiling** be produced against the
  identical fact-pool, and drives the extractor's real-repo smoke test.
- Row schema += `reconMode: "fixed"|"candidate"` and (candidate only) optional
  `reconGrounding` (what the candidate assembled — for the journal) and `reconEmpty?`.

### `benchmarks/bench.mjs` — `orchestrate-report` (touched)
Partition rows by `reconMode` (absent ⇒ `"fixed"`, back-compat). Render the existing rollup per
mode, and add a **recon-delegation delta**: for each candidate, `candidate-M2 pass@N − same
candidate's M1 (fixed) pass@N`, per task, alongside the existing vs-`claude` deltas. The
`claude` rows exist in both modes (M1 baseline + the M2 ceiling).

### `test/fixtures/fake-pi.js` (touched)
Add a `# RECON ASSEMBLY` role: when the prompt carries that sentinel, emit a stub grounding
(default a canned fact line, overridable via `FAKE_PI_GROUNDING`; empty via `FAKE_PI_RECON_EMPTY=1`),
exactly as it special-cases `# ORCHESTRATOR DECISION` / `# EVIDENCE PACKET`. Keeps `--recon
candidate` dry-runnable without ollama.

## Baselines & how to read M2

For each candidate, run `--recon candidate` on `T6-inplace-hard` + `T4-additive-hard`, K=5, and
compare against:

1. **Its own M1 rows** (`reconMode:"fixed"`, gold `grounding.md`) — the **recon-delegation cost**:
   how much pass@N drops when the model must assemble grounding instead of receiving it.
2. **Claude-M2 ceiling** (`orchestratorModel:"claude", reconMode:"candidate"`) — Claude assembles
   grounding from the same fact-pool (`bench.mjs recon` output), then the loop runs. Produced
   semi-manually, exactly as the M1 Claude baseline was. The best-case for the assembly task.
3. **Claude-M1 loop baseline** (exists) — the overall reference.

Candidate set: the M1 shortlist, prioritising the M1 standouts (`llama3.1:8b`, `qwen3:14b`) plus
at least one weaker one (`gemma4:12b`) to see whether recon-assembly widens or preserves the M1
ordering.

## Metrics & honesty

- **Discriminating metric:** candidate-M2 pass@N vs its own M1 pass@N (recon-delegation cost),
  and vs the Claude-M2 ceiling. Because the loop is byte-identical to M1 and per-candidate M1
  numbers already exist, the **M2−M1 delta isolates recon-assembly quality**.
- **`effFS` remains the safety check** (expected ≈ 0 — the Layer-1 verifier still gates), not the
  discriminator. A candidate that assembles thin/wrong grounding should show up as *more
  corrective rounds / escalations / lower pass@N*, **not** as false-success.
- **Watch for nest-stealing:** if a candidate emits ordered plans instead of facts, that is a
  qualitative finding for the journal (recon rubric not held) — captured via `reconGrounding`.
- K=5 / no pinned seed → ±~2-runs noise, as always; the robust readings are ordering + effFS.

## Testing

- **Unit `test/recon.test.js`:** `extractGoalTokens` (backtick + camelCase, stoplist, dedupe);
  `extractRecon` on a fixture repo — deterministic fact-pool, grep hits resolve, `sourceOfHitFiles`
  dedupe + caps, **`allowedChangedFiles` / `oracle.mjs` / `grounding.md` never read**;
  `renderFactPool` stable. `parseGrounding` — fenced/plain/`{grounding}` JSON, prose framing,
  empty → `{empty:true}`.
- **Unit `test/orchestrator.test.js`:** `parseGrounding` cases (co-located if preferred).
- **Integration dry-run (no ollama):** `orchestrate --recon candidate --task T4-additive-hard
  --repeats 1 --orchestrator-model fake` with `ORN_PI_BIN=fake-pi` → exactly one row
  `reconMode:"candidate"`, `orchestratorOutcome:"done"`; assert `orchestrate-report` reads it and
  partitions by mode. Also `bench.mjs recon --task T6-inplace-hard` prints a non-empty fact-pool
  that excludes `allowedChangedFiles`.
- **Real candidate runs:** deferred to a run session with ollama (models already pulled from M1).

## Success criteria

- `bench.mjs orchestrate --recon candidate --orchestrator-model <id>` runs extraction →
  candidate assembly → the M1 loop, and emits one schema-correct `reconMode:"candidate"` row per
  (task, repeat), scored by the Layer-0 oracle.
- `bench.mjs recon --task <id>` prints the deterministic fact-pool (answer-key excluded).
- `orchestrate-report` partitions by `reconMode` and shows the candidate-M2 vs own-M1 delta.
- The dry-run path works with `fake-pi` (CI-safe, no ollama); M1 (`--recon fixed`) behavior and
  existing rows are unchanged.
- Both presidia preserved: Layer-0 oracle scores; Layer-1 verifier separate; the candidate never
  sees the gold label or `allowedChangedFiles`.
- `npm test` green.
