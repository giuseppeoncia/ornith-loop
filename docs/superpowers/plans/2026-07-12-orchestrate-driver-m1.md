# orchestrate Driver M1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the honest-stub `bench.mjs orchestrate` into a real driver that puts a candidate local model in the orchestrator seat, driving the ornith-loop with recon held fixed, and emits one scoring row per (task, repeat).

**Architecture:** Approach A (pre-compute + delegate). A JS driver owns the mechanical loop (fresh workdir → run ornith executor → gather evidence → Layer-1 verifier verdict → oracle). The candidate is invoked via `orn run --no-tools` ONLY for the per-round loop-control decision (`done`/`retry`/`escalate`) and, on retry, the one corrective grounding fact. The Layer-0 oracle scores the final workdir post-hoc and is never shown to the candidate; the Layer-1 verifier stays a separate model.

**Tech Stack:** Node ≥ 24 ESM, zero dependencies, `node --test`. Reuses `orn` CLI + existing `benchmarks/bench.mjs` helpers (`loadTask`, `makeWorkdir`, `runOrn`, `gatherEvidence`, `adjudicate`, `runOracle`, `keepAwake`) and `src/orchestrator.js`.

## Global Constraints

- **Node ≥ 24**, ESM only, **zero dependencies** (test with `node --test`).
- **Golden rule** (mirrors `parseVerdict`/`parseOrchestratorOutcome`): anything not confidently `done`, and any `retry` without a non-empty grounding fact, defaults to **`escalate`** — never fabricate `done`.
- **Two presidia:** the Layer-0 oracle (`benchmarks/tasks/*/oracle.mjs`) is the anchor of truth, used only for post-hoc scoring and **never shown to the candidate**; the Layer-1 verifier (default `qwen3.5:4b`) is a **separate** model, not the candidate.
- **Recon fixed in M1:** round-1 grounding is the frozen `benchmarks/tasks/<task>/grounding.md`; corrective grounding the candidate authors is appended append-only on later rounds.
- **Row schema (verbatim):** `{ task, repeat, orchestratorModel, orchestratorOutcome: "done"|"escalate", pass, orchestratorRounds, orchestratorReason, verifierModel }`.
- **Prompt sentinels are mutually exclusive:** the orchestrator-decision prompt uses headers `# ORCHESTRATOR DECISION` / `# LAST ROUND EVIDENCE` and MUST NOT contain the string `# EVIDENCE PACKET` (the verifier sentinel).
- Changelog follows Keep a Changelog; add an `[Unreleased]` entry.

---

### Task 1: `parseRoundDecision` pure helper

**Files:**
- Modify: `src/orchestrator.js` (add export near `parseOrchestratorOutcome`)
- Test: `test/orchestrator.test.js` (append tests + import)

**Interfaces:**
- Consumes: the module-private `extractJsonObject(text)` already in `src/orchestrator.js`.
- Produces:
  - `export const ROUND_ACTIONS = ["done", "retry", "escalate"]`
  - `export function parseRoundDecision(text): { action: "done"|"retry"|"escalate", grounding: string|null, reason: string }`

- [ ] **Step 1: Write the failing tests**

Append to `test/orchestrator.test.js` (and add `ROUND_ACTIONS, parseRoundDecision` to the existing import from `../src/orchestrator.js`):

```js
test("ROUND_ACTIONS is the closed set", () => {
  assert.deepEqual(ROUND_ACTIONS, ["done", "retry", "escalate"]);
});

test("parseRoundDecision: clean done", () => {
  const d = parseRoundDecision('{"action":"done","reason":"tests green, in scope"}');
  assert.equal(d.action, "done");
  assert.equal(d.grounding, null);
  assert.equal(d.reason, "tests green, in scope");
});

test("parseRoundDecision: retry carries its corrective grounding fact", () => {
  const d = parseRoundDecision('{"action":"retry","grounding":"node --test needs no npm install","reason":"stray lockfile"}');
  assert.equal(d.action, "retry");
  assert.equal(d.grounding, "node --test needs no npm install");
});

test("parseRoundDecision: retry with no grounding fact degrades to escalate", () => {
  assert.equal(parseRoundDecision('{"action":"retry"}').action, "escalate");
  assert.equal(parseRoundDecision('{"action":"retry","grounding":"   "}').action, "escalate");
});

test("parseRoundDecision: explicit escalate, unknown action, and empty all escalate", () => {
  assert.equal(parseRoundDecision('{"action":"escalate","reason":"can\'t diagnose"}').action, "escalate");
  assert.equal(parseRoundDecision('{"action":"finish"}').action, "escalate");
  assert.equal(parseRoundDecision("").action, "escalate");
  assert.equal(parseRoundDecision(null).action, "escalate");
});

test("parseRoundDecision: JSON in prose/fences parses; a lone done in prose is accepted; ambiguity escalates", () => {
  assert.equal(parseRoundDecision('ok:\n```json\n{"action":"DONE"}\n```').action, "done");
  assert.equal(parseRoundDecision("I think we are done").action, "done");
  assert.equal(parseRoundDecision("done, or maybe retry").action, "escalate");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/orchestrator.test.js`
Expected: FAIL — `parseRoundDecision is not a function` / `ROUND_ACTIONS` undefined.

- [ ] **Step 3: Implement `parseRoundDecision`**

Add to `src/orchestrator.js` (after `parseOrchestratorOutcome`, before `extractJsonObject`):

```js
// The closed set of per-round loop-control actions the orchestrator can take.
// `done` = stop, task complete; `retry` = run again with one added grounding
// fact; `escalate` = hand to the Claude auditor. (Distinct from OUTCOMES, which
// is the TERMINAL record: a retry chain that never resolves ends as `escalate`.)
export const ROUND_ACTIONS = ["done", "retry", "escalate"];

// Parse the orchestrator's per-round decision into { action, grounding, reason }.
// GOLDEN RULE (mirrors parseVerdict / parseOrchestratorOutcome): anything not
// confidently `done`, and any `retry` without a non-empty corrective grounding
// fact, defaults to `escalate` — never fabricate a `done`, and a retry with no
// fact to add has nothing to retry with, so route to Claude.
export function parseRoundDecision(text) {
  const raw = typeof text === "string" ? text : "";
  const obj = extractJsonObject(raw);
  const esc = (reason) => ({ action: "escalate", grounding: null, reason });

  if (obj && typeof obj.action === "string") {
    const a = obj.action.trim().toLowerCase();
    const reason = typeof obj.reason === "string" ? obj.reason : "";
    if (a === "done") return { action: "done", grounding: null, reason };
    if (a === "retry") {
      const g = typeof obj.grounding === "string" ? obj.grounding.trim() : "";
      return g ? { action: "retry", grounding: g, reason } : esc(reason || "retry with no corrective grounding fact");
    }
    if (a === "escalate") return esc(reason);
    return esc("unrecognized action; defaulting to escalate");
  }

  // Prose fallback: only a lone, unambiguous `done` is accepted (retry needs a
  // structured grounding fact we cannot extract from prose).
  const doneHit = /\bdone\b/i.test(raw);
  const otherHit = /\b(retry|escalate)\b/i.test(raw);
  if (doneHit && !otherHit) return { action: "done", grounding: null, reason: "parsed from prose (no JSON action object found)" };
  return esc("no parseable action; defaulting to escalate (route to Claude)");
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/orchestrator.test.js`
Expected: PASS (all existing + 6 new tests).

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator.js test/orchestrator.test.js
git commit -m "feat(orchestrator): parseRoundDecision — per-round done/retry/escalate"
```

---

### Task 2: the `orchestrate` driver (rubric + fake-pi + cmdOrchestrate + dry-run test)

**Files:**
- Create: `orchestrator/rubric.md`
- Modify: `test/fixtures/fake-pi.js` (add orchestrator-decision role, checked BEFORE the verifier role)
- Modify: `benchmarks/bench.mjs` (import `parseRoundDecision`; add `ORCH_RUBRIC_PATH`; replace stub `cmdOrchestrate`; update the usage string)
- Modify: `CHANGELOG.md` (`[Unreleased]` → Added)
- Test: `test/orchestrate.test.js` (new — integration dry-run via fake-pi)

**Interfaces:**
- Consumes: `parseRoundDecision`, `ROUND_ACTIONS` (Task 1); existing `loadTask`, `makeWorkdir`, `runOrn`, `gatherEvidence`, `adjudicate`, `runOracle`, `keepAwake`, `die`, `RESULTS_DIR`, `HERE` in `benchmarks/bench.mjs`.
- Produces: `bench.mjs orchestrate --task <id> --orchestrator-model <id> [--verifier-model <id>] [--repeats N | --repeat K] [--rounds N] [--results-dir path]`, appending rows to `results/<task>__orch-<slug>.jsonl`.

- [ ] **Step 1: Write `orchestrator/rubric.md`**

Create `orchestrator/rubric.md`:

```markdown
# Orchestrator rubric — the loop controller

You are the **orchestrator** driving a coding loop. A separate model (ornith) was given a
goal plus grounding and attempted the task; a separate Layer-1 verifier then judged the
result. Your ONLY job now is to decide what the loop does next. You are NOT a coder and you
do NOT edit files or write the solution.

## The one discipline — grounding, never scaffold

If you continue the loop, you may add **grounding**: a missing *fact* the run revealed — a
real path, a constraint, an environment truth, a scope rule ornith could not derive. You must
**never** supply *scaffold*: a plan, a numbered sequence of steps, or the solution itself.
Ornith is trained to build its own plan; handing it steps defeats the experiment. "Add the
rate parameter, then update both call sites, then run the tests" is scaffold — forbidden.
"The tests run with plain `node --test`; no `npm install` is needed" is grounding — allowed.

## What you are given

- **GOAL** and the **GROUNDING ALREADY SENT** to ornith.
- **LAST ROUND EVIDENCE** — the test exit code and output, the changed-file list, and the
  diff. All ground truth; never ornith's own prose about what it did.
- **LAYER-1 VERIFIER VERDICT** — `pass` / `fail` / `uncertain` with a reason: a separate
  model's independent read. Treat `pass` as a strong signal, but you may overrule it toward
  caution.
- How many rounds have been used, of the budget.

## Your decision

Choose exactly one action:

- **`done`** — you are confident the task is complete and in scope. Choose this only when the
  evidence (green tests, in-scope diff, no corruption) supports it; do not rubber-stamp a
  verdict you cannot see supported in the evidence.
- **`retry`** — the run failed or is incomplete AND you can name the single missing *fact*
  that would let ornith fix it. Supply that fact in `grounding`. Rounds permitting, the loop
  runs again with your fact appended.
- **`escalate`** — you cannot confidently finish: a failure you cannot diagnose into one
  grounding fact, contradictory evidence, or simple doubt. This hands the loop to the stronger
  Claude auditor. Escalating is cheap and safe.

## Golden rule

**When in doubt, `escalate` — never `done`.** Shipping a broken run as finished is the one
fatal error, because ornith already confabulates success. A `retry` with no concrete grounding
fact is not a retry — if you have no fact to add, `escalate`.

## Output — and nothing else

Reply with a single JSON object, no prose around it:

    {
      "action": "done | retry | escalate",
      "grounding": "the single missing fact — REQUIRED for retry, omit otherwise",
      "reason": "one or two sentences tying the action to the evidence"
    }
```

- [ ] **Step 2: Add the orchestrator-decision role to `test/fixtures/fake-pi.js`**

In `test/fixtures/fake-pi.js`, add the detection line next to `isVerifierCall`:

```js
const isOrchestratorCall = process.argv.some((a) => typeof a === "string" && a.includes("# ORCHESTRATOR DECISION"));
```

Then add this branch **before** the `else if (isVerifierCall)` branch (order matters — it wins if both sentinels ever co-occur):

```js
} else if (isOrchestratorCall) {
  const action = process.env.FAKE_PI_ACTION || "done";
  const grounding = process.env.FAKE_PI_GROUNDING || "";
  const text = JSON.stringify({ action, grounding, reason: "stubbed orchestrator decision" });
  const msg = { role: "assistant", stopReason: "stop", content: [{ type: "text", text }] };
  const lines = [
    { type: "session", version: 3, id: "33333333-3333-3333-3333-333333333333", timestamp: "2026-07-07T16:50:00.000Z", cwd: "/tmp/orch" },
    { type: "agent_start" },
    { type: "agent_end", messages: [msg] },
  ];
  process.stdout.write(lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  process.exit(0);
```

- [ ] **Step 3: Wire imports + rubric path in `benchmarks/bench.mjs`**

Change the orchestrator import line:

```js
import { scoreOrchestrator, orchestratorDeltas } from "../src/orchestrator.js";
```

to:

```js
import { scoreOrchestrator, orchestratorDeltas, parseRoundDecision } from "../src/orchestrator.js";
```

And add, next to `RUBRIC_PATH`:

```js
const ORCH_RUBRIC_PATH = resolve(HERE, "..", "orchestrator", "rubric.md");
```

- [ ] **Step 4: Replace the stub `cmdOrchestrate`**

In `benchmarks/bench.mjs`, replace the entire stub `function cmdOrchestrate() { ... }` (the one that writes "the local-orchestrator execution driver is not built yet" and calls `process.exit(2)`) with:

```js
// Drive a candidate LOCAL model as the orchestrator through the ornith-loop
// (docs/ORCHESTRATOR.md; spec docs/superpowers/specs/2026-07-12-orchestrate-driver-m1-design.md).
// M1: recon is FIXED (round-1 grounding = frozen grounding.md); the candidate owns
// only the per-round decision (done/retry/escalate) + the corrective grounding fact.
// Presidia: Layer-0 oracle scores post-hoc and is never shown to the candidate; the
// Layer-1 verifier is a separate model. One row per (task, repeat).
function cmdOrchestrate(o) {
  const task = o.task || die("--task required");
  const orchestratorModel = typeof o["orchestrator-model"] === "string" ? o["orchestrator-model"] : die("--orchestrator-model <id> required");
  const verifierModel = typeof o["verifier-model"] === "string" ? o["verifier-model"] : "qwen3.5:4b";
  const maxRounds = Number(o.rounds || 3);
  const repeats = o.repeat ? [Number(o.repeat)] : Array.from({ length: Number(o.repeats || 1) }, (_, i) => i + 1);
  const resultsDir = typeof o["results-dir"] === "string" ? o["results-dir"] : RESULTS_DIR;

  const t = loadTask(task);
  keepAwake();
  mkdirSync(resultsDir, { recursive: true });
  const slug = orchestratorModel.replace(/[^a-zA-Z0-9]+/g, "-");
  const resultsFile = join(resultsDir, `${task}__orch-${slug}.jsonl`);
  const rubric = readFileSync(ORCH_RUBRIC_PATH, "utf8");

  for (const repeat of repeats) {
    let grounding = (t.parts.grounding || "").trim(); // recon FIXED in M1
    let outcome = "escalate";
    let reason = "";
    let roundsUsed = 0;
    let finalWd = null;
    let finalRunsDir = null;

    for (let round = 1; round <= maxRounds; round++) {
      roundsUsed = round;
      // discard a prior round's workdir (rounds are fresh attempts, not continuations)
      if (finalWd) rmSync(finalWd, { recursive: true, force: true });
      if (finalRunsDir) rmSync(finalRunsDir, { recursive: true, force: true });
      const wd = makeWorkdir(t);
      const runsDir = mkdtempSync(join(tmpdir(), `bench-runs-${t.meta.id}-`));
      finalWd = wd;
      finalRunsDir = runsDir;

      const prompt = `${(t.parts.goal || "").trim()}\n\n${grounding}`.trim();
      const orn = runOrn({ prompt, workdir: wd, label: `${task}-orch-k${repeat}-r${round}`, runsDir });
      const ev = gatherEvidence(t, wd);
      const verdict = adjudicate({
        goal: t.parts.goal, grounding, evidence: ev,
        record: orn.record, model: verifierModel, label: `verify-${t.meta.id}`,
      });

      const decisionPrompt =
        `${rubric}\n\n---\n\n# ORCHESTRATOR DECISION\n\n` +
        `## GOAL\n${(t.parts.goal || "").trim()}\n\n` +
        `## GROUNDING ALREADY SENT\n${grounding}\n\n` +
        `## LAST ROUND EVIDENCE\n` +
        `test exit: ${ev.testExitCode}\nchanged files: ${ev.changedFiles.join(", ") || "(none)"}\n\n` +
        `test output:\n${ev.testOutput}\n\ndiff:\n${ev.diff}\n\n` +
        `## LAYER-1 VERIFIER VERDICT\nverdict: ${verdict.verdict}\nreason: ${verdict.reason}\n\n` +
        `Rounds used: ${round} of ${maxRounds}.`;
      const decRunsDir = mkdtempSync(join(tmpdir(), "bench-orch-"));
      let decision;
      try {
        const dec = runOrn({ prompt: decisionPrompt, model: orchestratorModel, label: `orch-${t.meta.id}-k${repeat}-r${round}`, runsDir: decRunsDir, noTools: true });
        decision = parseRoundDecision(dec.record?.finalText || "");
      } finally {
        rmSync(decRunsDir, { recursive: true, force: true });
      }
      reason = decision.reason;

      if (decision.action === "done") { outcome = "done"; break; }
      if (decision.action === "retry" && round < maxRounds) { grounding = `${grounding}\n\n${decision.grounding}`.trim(); continue; }
      outcome = "escalate"; break; // escalate, or retry with the round budget spent
    }

    // Layer-0 gold oracle on the FINAL workdir — the anchor, never shown to the candidate.
    const oracle = runOracle(t, finalWd, "");
    rmSync(finalWd, { recursive: true, force: true });
    rmSync(finalRunsDir, { recursive: true, force: true });

    const row = {
      task, repeat, orchestratorModel, orchestratorOutcome: outcome,
      pass: oracle.pass, orchestratorRounds: roundsUsed, orchestratorReason: reason, verifierModel,
    };
    appendFileSync(resultsFile, JSON.stringify(row) + "\n");
    process.stdout.write(`${task}-orch-k${repeat}: ${outcome} (rounds ${roundsUsed}, oracle ${oracle.pass ? "PASS" : "fail"})\n`);
  }
}
```

- [ ] **Step 5: Update the usage string**

In `benchmarks/bench.mjs`, replace the usage line:

```js
      "       node benchmarks/bench.mjs orchestrate            (stub — see docs/ORCHESTRATOR.md)\n" +
```

with:

```js
      "       node benchmarks/bench.mjs orchestrate --task <id> --orchestrator-model <id> [--verifier-model <id>] [--repeats N] [--rounds N] [--results-dir path]\n" +
```

- [ ] **Step 6: Write the failing integration test**

Create `test/orchestrate.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const BENCH = join(REPO, "benchmarks", "bench.mjs");
const FAKE_PI = join(REPO, "test", "fixtures", "fake-pi.js");

test("orchestrate: dry-run via fake-pi emits one schema-correct row (no ollama)", () => {
  const resultsDir = mkdtempSync(join(tmpdir(), "orch-it-"));
  try {
    const res = spawnSync(process.execPath, [
      BENCH, "orchestrate",
      "--task", "T4-additive-hard",
      "--orchestrator-model", "fake-cand",
      "--verifier-model", "fake-verifier",
      "--repeats", "1",
      "--results-dir", resultsDir,
    ], {
      encoding: "utf8",
      env: { ...process.env, ORN_PI_BIN: FAKE_PI, FAKE_PI_ACTION: "done", FAKE_PI_VERDICT: "pass" },
    });
    assert.equal(res.status, 0, res.stderr);

    const file = join(resultsDir, "T4-additive-hard__orch-fake-cand.jsonl");
    assert.ok(existsSync(file), "results file written");
    const rows = readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(rows.length, 1);
    const r = rows[0];
    assert.equal(r.task, "T4-additive-hard");
    assert.equal(r.repeat, 1);
    assert.equal(r.orchestratorModel, "fake-cand");
    assert.equal(r.orchestratorOutcome, "done");     // FAKE_PI_ACTION=done
    assert.equal(r.orchestratorRounds, 1);           // done on round 1
    assert.equal(r.verifierModel, "fake-verifier");
    assert.equal(typeof r.pass, "boolean");          // oracle ran (false: fake-pi doesn't solve)
  } finally {
    rmSync(resultsDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 7: Run the test to verify it fails, then passes**

Run: `node --test test/orchestrate.test.js`
Expected FIRST (before Steps 1–5 applied): FAIL. After all steps: PASS.

- [ ] **Step 8: Run the full suite**

Run: `npm test`
Expected: PASS — previous count (75) + Task 1's 6 + this 1 = 82 tests, 0 fail.

- [ ] **Step 9: Add a CHANGELOG entry**

In `CHANGELOG.md` under `## [Unreleased]` → `### Added`:

```markdown
- `bench.mjs orchestrate --task <id> --orchestrator-model <id>` — the agentic driver that puts
  a candidate LOCAL model in the orchestrator seat (docs/ORCHESTRATOR.md). M1: recon is fixed
  (round-1 grounding = frozen `grounding.md`); the candidate owns only the per-round decision
  (`done`/`retry`/`escalate`, `src/orchestrator.js` `parseRoundDecision`) and the corrective
  grounding fact on a retry. Layer-0 oracle scores post-hoc (never shown to the candidate); the
  Layer-1 verifier (default `qwen3.5:4b`) stays a separate model. New `orchestrator/rubric.md`.
  Rows feed the existing `orchestrate-report`. Dry-runnable via the `fake-pi` fixture.
```

- [ ] **Step 10: Commit**

```bash
git add orchestrator/rubric.md test/fixtures/fake-pi.js benchmarks/bench.mjs test/orchestrate.test.js CHANGELOG.md
git commit -m "feat(orchestrator): bench.mjs orchestrate driver (M1) + dry-run test"
```

---

## Self-Review

**Spec coverage:**
- Loop steps 1–8 → Task 2 Step 4 (`cmdOrchestrate`). ✅
- `parseRoundDecision` + golden rule → Task 1. ✅
- `orchestrator/rubric.md` with sentinel → Task 2 Step 1. ✅
- fake-pi third role (checked before verifier) → Task 2 Step 2. ✅
- Row schema + slug filename → Task 2 Step 4 (`row`, `slug`). ✅
- Metrics via existing `orchestrate-report` → unchanged (no task needed). ✅
- Testing: unit (`parseRoundDecision`) → Task 1; integration dry-run → Task 2 Steps 6–8. ✅
- Presidia (oracle post-hoc/hidden, verifier separate) → enforced in `cmdOrchestrate` (oracle after loop with `""` record; `verifierModel` distinct call). ✅
- Real-run candidate model choice → deferred by design (runtime `--orchestrator-model`); not a code task. ✅

**Placeholder scan:** none — every step has full code or an exact command.

**Type consistency:** `parseRoundDecision` returns `{action, grounding, reason}` (Task 1) and is consumed identically in `cmdOrchestrate` (Task 2, `decision.action` / `decision.grounding` / `decision.reason`). `runOrn`/`gatherEvidence`/`adjudicate`/`runOracle` signatures match their existing definitions in `benchmarks/bench.mjs`. Row fields match the Global Constraints schema.
