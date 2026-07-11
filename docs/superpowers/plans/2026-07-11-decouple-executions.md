# Decouple Executor Runs from Verifier Scoring — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a two-phase verifier-selection flow — `run --save-corpus` freezes each ornith run's raw evidence + gold label; `verify-corpus` replays any candidate over that same frozen corpus — so candidates are scored on identical runs and ornith runs only once.

**Architecture:** Additive to `benchmarks/bench.mjs`. A pure `corpusRecordFrom` builder (in `src/verifier.js`) serializes one run; `run` gains `--save-corpus <dir>` (+ `--results-dir <path>` for hermetic tests); a new `verify-corpus` command rebuilds each packet with the existing `buildEvidencePacket` and adjudicates read-only via `orn --no-tools`, writing rows tagged `source:"corpus"` that `verify-report` already reads. `aggregate` (report) skips those rows. The coupled `run --verifier-model` path is untouched.

**Tech Stack:** Node ≥ 24 (ESM), `node --test`, zero runtime deps. Ollama/pi/ornith only for real runs; `test/fixtures/fake-pi.js` stubs pi for tests (it emits a JSON verdict when the prompt contains the `# EVIDENCE PACKET` sentinel; `FAKE_PI_VERDICT` overrides it).

## Global Constraints

- **Zero runtime dependencies** — Node built-ins only (`package.json` asserts no `dependencies`).
- **ESM**, `.mjs`/`import` syntax, Node v24.
- **The verifier NEVER sees ornith's prose (`finalText`) nor the task answer-key** — same exclusions as the live path; corpus records must not contain `finalText`.
- **The verifier runs read-only** — every verifier `orn` call passes `--no-tools`.
- **Corpus is ephemeral** — `benchmarks/corpus/` is gitignored; conclusions live in the journal.
- Tests must be **hermetic** — write only to `mkdtemp` temp dirs, never the repo's `benchmarks/results` or `benchmarks/corpus`.
- Match existing style: helpers pure in `src/`, CLI orchestration in `benchmarks/bench.mjs`, `die(msg)` for CLI errors.

---

## File Structure

- **Create:** `test/corpus.test.js` — CLI integration tests (spawn `bench.mjs` with fake-pi + temp dirs).
- **Modify:** `src/verifier.js` — add pure `corpusRecordFrom`.
- **Modify:** `test/verifier.test.js` — unit tests for `corpusRecordFrom`.
- **Modify:** `src/bench.js` — `aggregate` skips `source:"corpus"` rows.
- **Modify:** `test/bench.test.js` — unit test for that filter.
- **Modify:** `benchmarks/bench.mjs` — `adjudicate` helper; `run --save-corpus`/`--results-dir`; `cmdVerifyCorpus`; dispatch + usage.
- **Modify:** `.gitignore` — add `benchmarks/corpus/`.
- **Modify:** `benchmarks/README.md`, `docs/VERIFIER.md`, `CHANGELOG.md` — document the flow.

---

### Task 1: Pure `corpusRecordFrom` builder

**Files:**
- Modify: `src/verifier.js` (append a new exported function)
- Test: `test/verifier.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `corpusRecordFrom({ task, arm, round, repeat, runId, goldPass, goal, grounding, evidence, record }) → object`, where `evidence = { testCmd, testOutput, testExitCode, changedFiles, diff }` and `record` is an `orn` run record. Returns `{ task, arm, round, repeat, runId, goldPass:boolean, goal, grounding, testCmd, testOutput, testExitCode, changedFiles, diff, record:<slim> }` where `<slim>` = `{ model, exit:{reason}, toolCallCount, toolSequence, workdirChange:{changed}|null, flags }` (NO `finalText`). Consumed by Task 3 (`run --save-corpus`) and Task 4 (`verify-corpus`).

- [ ] **Step 1: Write the failing tests**

Add to `test/verifier.test.js`. First update the import line:

```js
import { VERDICTS, buildEvidencePacket, parseVerdict, scoreVerifier, corpusRecordFrom } from "../src/verifier.js";
```

Then append:

```js
test("corpusRecordFrom: freezes ground-truth evidence + gold label, drops ornith prose", () => {
  const rec = corpusRecordFrom({
    task: "T3-inplace", arm: "A", round: 1, repeat: 2, runId: "rid-1",
    goldPass: false, goal: "spanish greet", grounding: "edit src/greet.mjs",
    evidence: { testCmd: ["node", "--test"], testOutput: "# fail 1", testExitCode: 1, changedFiles: ["src/greet.mjs"], diff: "- Hello\n+ Hola" },
    record: { model: "ornith-1.0-9b-64k", exit: { reason: "completed" }, toolCallCount: 4, toolSequence: [{ name: "Edit" }], workdirChange: { changed: true }, finalText: "All done ✅", flags: { claimedDone: true } },
  });
  assert.equal(rec.goldPass, false);
  assert.equal(rec.diff, "- Hello\n+ Hola");
  assert.deepEqual(rec.changedFiles, ["src/greet.mjs"]);
  assert.equal(rec.record.model, "ornith-1.0-9b-64k");
  assert.equal(rec.record.workdirChange.changed, true);
  assert.ok(!("finalText" in rec.record), "slim record must not carry ornith prose");
  assert.equal(JSON.stringify(rec).includes("All done"), false, "no finalText anywhere in the record");
});

test("corpusRecordFrom round-trips through buildEvidencePacket (same ground truth, no prose)", () => {
  const rec = corpusRecordFrom({
    task: "T3-inplace", arm: "A", repeat: 1, goldPass: true, goal: "spanish greet", grounding: "edit src/greet.mjs",
    evidence: { testCmd: ["node", "--test"], testOutput: "# pass 2", testExitCode: 0, changedFiles: ["src/greet.mjs"], diff: "+ Hola" },
    record: { model: "ornith", exit: { reason: "completed" }, toolCallCount: 3, toolSequence: [{ name: "Edit" }], workdirChange: { changed: true }, finalText: "SHIP IT", flags: {} },
  });
  const packet = buildEvidencePacket({
    goal: rec.goal, grounding: rec.grounding, testCmd: rec.testCmd, testOutput: rec.testOutput,
    testExitCode: rec.testExitCode, changedFiles: rec.changedFiles, diff: rec.diff, record: rec.record,
  });
  assert.match(packet, /spanish greet/);
  assert.match(packet, /exit code: 0/);
  assert.doesNotMatch(packet, /SHIP IT/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/verifier.test.js`
Expected: FAIL — `corpusRecordFrom is not a function` (or import undefined).

- [ ] **Step 3: Implement `corpusRecordFrom`**

Append to `src/verifier.js`:

```js
// Freeze one executor run into a corpus record for decoupled verification
// (docs/superpowers/specs/2026-07-11-decouple-executions-design.md). Stores raw
// ground-truth evidence + the gold label so any candidate verifier can be
// replayed later over the SAME run via buildEvidencePacket. Slims the run record
// to the signals formatRunSignals uses and DROPS finalText — the executor's prose
// must never reach the verifier, exactly as in the live path.
export function corpusRecordFrom({
  task, arm, round = 1, repeat, runId = null, goldPass,
  goal = "", grounding = "", evidence = {}, record = null,
} = {}) {
  const r = record || {};
  const slimRecord = {
    model: r.model ?? null,
    exit: { reason: r.exit?.reason ?? null },
    toolCallCount: typeof r.toolCallCount === "number" ? r.toolCallCount : null,
    toolSequence: Array.isArray(r.toolSequence) ? r.toolSequence : [],
    workdirChange: r.workdirChange ? { changed: r.workdirChange.changed } : null,
    flags: r.flags || {},
  };
  return {
    task, arm, round, repeat, runId,
    goldPass: Boolean(goldPass),
    goal, grounding,
    testCmd: evidence.testCmd ?? null,
    testOutput: evidence.testOutput ?? "",
    testExitCode: evidence.testExitCode ?? null,
    changedFiles: Array.isArray(evidence.changedFiles) ? evidence.changedFiles : [],
    diff: evidence.diff ?? "",
    record: slimRecord,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/verifier.test.js`
Expected: PASS (all verifier tests green).

- [ ] **Step 5: Commit**

```bash
git add src/verifier.js test/verifier.test.js
git commit -m "feat(verifier): corpusRecordFrom — freeze a run's ground-truth evidence"
```

---

### Task 2: `aggregate` ignores `source:"corpus"` rows

**Files:**
- Modify: `src/bench.js` (function `aggregate`, near line 42)
- Test: `test/bench.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `aggregate(rows)` unchanged signature, now skipping any row with `source === "corpus"` (verifier-replay rows are not executor attempts). `report` relies on this; `verify-report`/`scoreVerifier` are unaffected (they select on `verifierVerdict`).

- [ ] **Step 1: Write the failing test**

Append to `test/bench.test.js`:

```js
test("aggregate: ignores verifier-replay rows tagged source:corpus", () => {
  const rows = [
    { task: "T", arm: "A", repeat: 1, round: 1, pass: true, flags: {} },              // executor attempt
    { task: "T", arm: "A", repeat: 1, round: 1, pass: false, source: "corpus",         // replay row — must be ignored
      verifierModel: "m", verifierVerdict: "pass" },
  ];
  const rep = aggregate(rows);
  assert.equal(rep.length, 1);
  assert.equal(rep[0].repeats, 1);      // only the one executor repeat
  assert.equal(rep[0].pass1Rate, 1);    // corpus row (pass:false) did not drag it down
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/bench.test.js`
Expected: FAIL — `rep[0].repeats` is 1 but `pass1Rate` is 0.5 (the corpus row was counted).

- [ ] **Step 3: Implement the filter**

In `src/bench.js`, in `aggregate`, change the row loop guard:

```js
  const byKey = new Map();
  for (const r of rows) {
    if (r && r.source === "corpus") continue; // verifier-replay rows are not executor attempts
    const key = `${r.task} ${r.arm}`;
    if (!byKey.has(key)) byKey.set(key, { task: r.task, arm: r.arm, attempts: [] });
    byKey.get(key).attempts.push(r);
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/bench.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/bench.js test/bench.test.js
git commit -m "feat(bench): aggregate skips source:corpus verifier-replay rows"
```

---

### Task 3: `run --save-corpus` producer + `adjudicate` refactor + `--results-dir`

**Files:**
- Modify: `benchmarks/bench.mjs` (imports; new `adjudicate`; remove `runVerifier`; edit `cmdRun`)
- Test: `test/corpus.test.js` (create)

**Interfaces:**
- Consumes: `corpusRecordFrom` (Task 1), existing `buildEvidencePacket`, `parseVerdict`, `runOrn`, `gatherEvidence`, `loadRubric`.
- Produces: `adjudicate({ goal, grounding, evidence, record, model, label }) → { verdict, evidence, reason }` (builds packet, runs `orn --no-tools`, parses). `run --save-corpus <dir>` writes `<dir>/<task>__<arm>__r<round>__k<repeat>.json` per repeat; `run --results-dir <path>` relocates the results root (default `benchmarks/results`). Consumed by Task 4.

- [ ] **Step 1: Write the failing integration test**

Create `test/corpus.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const pexec = promisify(execFile);
const bench = fileURLToPath(new URL("../benchmarks/bench.mjs", import.meta.url));
const fakePi = fileURLToPath(new URL("./fixtures/fake-pi.js", import.meta.url));

test("run --save-corpus writes a slim ground-truth record (no finalText)", async () => {
  const corpus = await mkdtemp(join(tmpdir(), "corpus-"));
  const results = await mkdtemp(join(tmpdir(), "results-"));
  try {
    await pexec(process.execPath, [
      bench, "run", "--task", "T1-scratch", "--arm", "B1", "--repeats", "1",
      "--save-corpus", corpus, "--results-dir", results,
    ], { env: { ...process.env, ORN_PI_BIN: fakePi, FAKE_PI_MODE: "success" } });

    const files = (await readdir(corpus)).filter((f) => f.endsWith(".json"));
    assert.equal(files.length, 1, "one corpus record for one repeat");
    const rec = JSON.parse(await readFile(join(corpus, files[0]), "utf8"));
    assert.equal(rec.task, "T1-scratch");
    assert.equal(rec.arm, "B1");
    assert.equal(typeof rec.goldPass, "boolean");
    assert.ok("diff" in rec && "changedFiles" in rec && "testOutput" in rec);
    assert.ok(!("finalText" in rec.record), "record must not carry ornith prose");
  } finally {
    await rm(corpus, { recursive: true, force: true });
    await rm(results, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/corpus.test.js`
Expected: FAIL — `--save-corpus` is an unknown flag / no corpus file written (0 files).

- [ ] **Step 3: Add `writeFileSync` to the imports**

In `benchmarks/bench.mjs`, edit the `node:fs` import to add `writeFileSync`:

```js
import { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, cpSync, appendFileSync, readdirSync } from "node:fs";
```

Add `corpusRecordFrom` to the verifier import:

```js
import { buildEvidencePacket, parseVerdict, scoreVerifier, corpusRecordFrom } from "../src/verifier.js";
```

- [ ] **Step 4: Replace `runVerifier` with the shared `adjudicate` helper**

Delete the entire `runVerifier` function (currently lines ~144–172, the block starting `// Invoke the Layer-1 verifier model` through its closing `}`) and replace it with:

```js
// Adjudicate a pre-gathered evidence bundle with a verifier model, read-only.
// Shared by the coupled `run --verifier-model` path and `verify-corpus`. The
// verifier reads the packet from the prompt (no --workdir) and MUST reply inline
// (--no-tools): otherwise pi runs in the repo cwd with write tools live and a
// tool-eager model writes its verdict to a file (journal 2026-07-10).
function adjudicate({ goal, grounding, evidence, record, model, label }) {
  const packet = buildEvidencePacket({
    goal, grounding,
    testCmd: evidence.testCmd, testOutput: evidence.testOutput, testExitCode: evidence.testExitCode,
    changedFiles: evidence.changedFiles, diff: evidence.diff, record,
  });
  const prompt = `${loadRubric()}\n\n---\n\n# EVIDENCE PACKET\n\n${packet}`;
  const runsDir = mkdtempSync(join(tmpdir(), "bench-verify-"));
  try {
    const orn = runOrn({ prompt, model, label, runsDir, noTools: true });
    return parseVerdict(orn.record?.finalText || "");
  } finally {
    rmSync(runsDir, { recursive: true, force: true });
  }
}
```

- [ ] **Step 5: Rewrite `cmdRun` to gather evidence once, save the corpus, and adjudicate**

Replace the whole `cmdRun` function with:

```js
function cmdRun(o) {
  const task = o.task || die("--task required");
  const arm = o.arm || die("--arm required");
  if (!ARM_IDS.includes(arm)) die(`unknown arm '${arm}': one of ${ARM_IDS.join(", ")}`);
  const round = Number(o.round || 1);
  const repeats = o.repeat ? [Number(o.repeat)] : Array.from({ length: Number(o.repeats || 1) }, (_, i) => i + 1);
  const model = typeof o.model === "string" ? o.model : undefined;
  const verifierModel = typeof o["verifier-model"] === "string" ? o["verifier-model"] : undefined;
  const saveCorpus = typeof o["save-corpus"] === "string" ? o["save-corpus"] : undefined;
  const resultsDir = typeof o["results-dir"] === "string" ? o["results-dir"] : RESULTS_DIR;
  const extra = typeof o.extra === "string" ? readFileSync(o.extra, "utf8") : "";
  if (round > 1 && !ARMS[arm].loop) die(`arm ${arm} is single-shot; --round ${round} is invalid`);

  const t = loadTask(task);
  keepAwake(); // long run: don't let the Mac idle-sleep and truncate orn calls
  const prompt = assemblePrompt(arm, t.parts, { round, extra });
  mkdirSync(resultsDir, { recursive: true });
  if (saveCorpus) mkdirSync(saveCorpus, { recursive: true });
  const resultsFile = join(resultsDir, `${task}__${arm}.jsonl`);

  for (const repeat of repeats) {
    const wd = makeWorkdir(t);
    const runsDir = mkdtempSync(join(tmpdir(), `bench-runs-${t.meta.id}-`));
    const label = `${task}-${arm}-r${round}-k${repeat}`;
    let row;
    try {
      const orn = runOrn({ prompt, workdir: wd, model, label, runsDir });
      const recPath = orn.recordPath;
      const oracle = runOracle(t, wd, recPath);
      row = {
        task, arm, repeat, round,
        pass: oracle.pass,
        flags: orn.record?.flags || {},
        exit: orn.record?.exit?.reason || null,
        toolSequence: orn.record?.toolSequence || [],
        changed: orn.record?.workdirChange?.changed ?? null,
        oracle: oracle.output.trim().slice(0, 500),
        runId: orn.record?.runId || null,
        model: orn.record?.model || model || null,
      };
      // Gather the mechanical evidence once if either consumer needs it.
      const ev = verifierModel || saveCorpus ? gatherEvidence(t, wd) : null;
      if (saveCorpus && ev) {
        const rec = corpusRecordFrom({
          task, arm, round, repeat, runId: orn.record?.runId || null,
          goldPass: oracle.pass, goal: t.parts.goal, grounding: t.parts.grounding,
          evidence: ev, record: orn.record,
        });
        writeFileSync(join(saveCorpus, `${task}__${arm}__r${round}__k${repeat}.json`), JSON.stringify(rec, null, 2));
      }
      if (verifierModel && ev) {
        const v = adjudicate({
          goal: t.parts.goal, grounding: t.parts.grounding, evidence: ev,
          record: orn.record, model: verifierModel, label: `verify-${t.meta.id}`,
        });
        row.verifierModel = verifierModel;
        row.verifierVerdict = v.verdict;
        row.verifierReason = v.reason;
      }
    } finally {
      rmSync(wd, { recursive: true, force: true });
      rmSync(runsDir, { recursive: true, force: true });
    }
    appendFileSync(resultsFile, JSON.stringify(row) + "\n");
    const vtag = row.verifierVerdict ? `, verifier ${row.verifierVerdict}` : "";
    const ctag = saveCorpus ? ", corpus✓" : "";
    process.stdout.write(`${label}: ${row.pass ? "PASS" : "fail"} (exit ${row.exit}, tools ${row.toolSequence.length}, changed ${row.changed}${vtag}${ctag})\n`);
  }
}
```

- [ ] **Step 6: Run the corpus test to verify it passes**

Run: `node --test test/corpus.test.js`
Expected: PASS (one corpus record written, no `finalText`).

- [ ] **Step 7: Run the full suite to verify no regression**

Run: `npm test`
Expected: PASS (all prior tests + the new ones; the coupled `run --verifier-model` path is behaviourally unchanged).

- [ ] **Step 8: Manual plumbing dry-run (no ollama)**

Run:
```bash
node benchmarks/bench.mjs run --task T1-scratch --arm B1 --repeats 1 \
  --save-corpus /tmp/orn-corpus-demo --results-dir /tmp/orn-results-demo \
  2>/dev/null; ls /tmp/orn-corpus-demo
```
Expected: prints a `T1-scratch-B1-...: ... corpus✓` line and lists one `T1-scratch__B1__r1__k1.json`. Note: this needs a real `pi`/`ollama`; to run it fully offline prefix with `ORN_PI_BIN="$PWD/test/fixtures/fake-pi.js" FAKE_PI_MODE=success`. Clean up: `rm -rf /tmp/orn-corpus-demo /tmp/orn-results-demo`.

- [ ] **Step 9: Commit**

```bash
git add benchmarks/bench.mjs test/corpus.test.js
git commit -m "feat(bench): run --save-corpus freezes runs; shared adjudicate helper"
```

---

### Task 4: `verify-corpus` consumer command

**Files:**
- Modify: `benchmarks/bench.mjs` (new `cmdVerifyCorpus`; dispatch; usage string)
- Test: `test/corpus.test.js` (append)

**Interfaces:**
- Consumes: `adjudicate` (Task 3), `corpusRecordFrom` output shape (Task 1).
- Produces: command `verify-corpus --corpus <dir> --verifier-model <id> [--results-dir <path>]` that appends, per corpus record, a row `{ task, arm, repeat, round, pass:goldPass, verifierModel, verifierVerdict, verifierReason, source:"corpus" }` to `<results>/<task>__<arm>.jsonl`. `verify-report` reads these unchanged.

- [ ] **Step 1: Write the failing integration test**

Append to `test/corpus.test.js`:

```js
import { writeFile, mkdir } from "node:fs/promises";

test("verify-corpus replays a candidate over a corpus into source:corpus rows", async () => {
  const corpus = await mkdtemp(join(tmpdir(), "corpus-"));
  const results = await mkdtemp(join(tmpdir(), "results-"));
  try {
    // Hand-crafted corpus record (oracle said fail; a diff exists).
    const rec = {
      task: "T3-inplace", arm: "A", round: 1, repeat: 1, runId: "rid",
      goldPass: false, goal: "spanish greet", grounding: "edit src/greet.mjs",
      testCmd: ["node", "--test"], testOutput: "# fail 1", testExitCode: 1,
      changedFiles: ["src/greet.mjs"], diff: "- Hello\n+ Hola",
      record: { model: "ornith", exit: { reason: "completed" }, toolCallCount: 3, toolSequence: [], workdirChange: { changed: true }, flags: {} },
    };
    await writeFile(join(corpus, "T3-inplace__A__r1__k1.json"), JSON.stringify(rec));

    await pexec(process.execPath, [
      bench, "verify-corpus", "--corpus", corpus, "--verifier-model", "fake", "--results-dir", results,
    ], { env: { ...process.env, ORN_PI_BIN: fakePi, FAKE_PI_VERDICT: "pass" } });

    const out = await readFile(join(results, "T3-inplace__A.jsonl"), "utf8");
    const rows = out.trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].source, "corpus");
    assert.equal(rows[0].verifierModel, "fake");
    assert.equal(rows[0].verifierVerdict, "pass");
    assert.equal(rows[0].pass, false);   // gold label carried through from the corpus
  } finally {
    await rm(corpus, { recursive: true, force: true });
    await rm(results, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/corpus.test.js`
Expected: FAIL — `verify-corpus` is an unknown command (usage printed, exit 2) / results file absent.

- [ ] **Step 3: Implement `cmdVerifyCorpus`**

In `benchmarks/bench.mjs`, add this function immediately after `cmdVerifyReport`:

```js
// Replay one candidate verifier over a frozen corpus (docs/VERIFIER.md §5). Runs
// ornith ZERO times: each record's ground-truth evidence is rebuilt into a packet
// and adjudicated read-only. Rows are tagged source:"corpus" so verify-report
// includes them but `report` (executor aggregate) skips them.
function cmdVerifyCorpus(o) {
  const corpus = typeof o.corpus === "string" ? o.corpus : die("--corpus <dir> required");
  const model = typeof o["verifier-model"] === "string" ? o["verifier-model"] : die("--verifier-model <id> required");
  const resultsDir = typeof o["results-dir"] === "string" ? o["results-dir"] : RESULTS_DIR;
  if (!existsSync(corpus)) die(`corpus dir not found: ${corpus}`);
  const files = readdirSync(corpus).filter((f) => f.endsWith(".json")).sort();
  if (!files.length) die(`no corpus records (*.json) in ${corpus}`);
  keepAwake();
  mkdirSync(resultsDir, { recursive: true });

  for (const f of files) {
    let rec;
    try {
      rec = JSON.parse(readFileSync(join(corpus, f), "utf8"));
    } catch {
      process.stderr.write(`bench: skipping malformed corpus record ${f}\n`);
      continue;
    }
    const v = adjudicate({
      goal: rec.goal, grounding: rec.grounding,
      evidence: { testCmd: rec.testCmd, testOutput: rec.testOutput, testExitCode: rec.testExitCode, changedFiles: rec.changedFiles, diff: rec.diff },
      record: rec.record, model, label: `verify-${rec.task}`,
    });
    const row = {
      task: rec.task, arm: rec.arm, repeat: rec.repeat, round: rec.round,
      pass: rec.goldPass, verifierModel: model, verifierVerdict: v.verdict, verifierReason: v.reason,
      source: "corpus",
    };
    appendFileSync(join(resultsDir, `${rec.task}__${rec.arm}.jsonl`), JSON.stringify(row) + "\n");
    process.stdout.write(`${rec.task}-${rec.arm}-r${rec.round}-k${rec.repeat}: gold ${rec.goldPass ? "PASS" : "fail"}, verifier ${v.verdict}\n`);
  }
}
```

- [ ] **Step 4: Wire the command into dispatch and usage**

At the bottom of `benchmarks/bench.mjs`, change the dispatch chain and usage text:

```js
if (cmd === "run") cmdRun(opts);
else if (cmd === "report") cmdReport();
else if (cmd === "verify-report") cmdVerifyReport();
else if (cmd === "verify-corpus") cmdVerifyCorpus(opts);
else {
  process.stdout.write(
    "usage: node benchmarks/bench.mjs run --task <id> --arm <A|B1|B2|B3> [--repeats N] [--model id] [--verifier-model id] [--save-corpus dir] [--results-dir path] [--round N --extra file --repeat K]\n" +
      "       node benchmarks/bench.mjs verify-corpus --corpus <dir> --verifier-model <id> [--results-dir path]\n" +
      "       node benchmarks/bench.mjs report\n" +
      "       node benchmarks/bench.mjs verify-report\n"
  );
  process.exit(cmd ? 2 : 0);
}
```

- [ ] **Step 5: Run the corpus test to verify it passes**

Run: `node --test test/corpus.test.js`
Expected: PASS (both corpus tests green).

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS (all tests).

- [ ] **Step 7: Commit**

```bash
git add benchmarks/bench.mjs test/corpus.test.js
git commit -m "feat(bench): verify-corpus replays a candidate over a frozen corpus"
```

---

### Task 5: gitignore + documentation

**Files:**
- Modify: `.gitignore`, `benchmarks/README.md`, `docs/VERIFIER.md`, `CHANGELOG.md`

**Interfaces:** none (docs only).

- [ ] **Step 1: Ignore the corpus dir**

In `.gitignore`, add under `benchmarks/results/`:

```
benchmarks/results/
benchmarks/corpus/
```

- [ ] **Step 2: Document the two-phase flow in the runbook**

In `benchmarks/README.md`, under the "Selecting a local verifier (Layer 1)" section, add:

````markdown
### Fair cross-candidate comparison (decoupled corpus)

To score several candidates on the *same* ornith runs (and run ornith only once), freeze a
corpus in phase 1, then replay each candidate in phase 2:

```bash
rm -rf benchmarks/results benchmarks/corpus
# Phase 1 — build the corpus once (auto-caffeinated on macOS)
node benchmarks/bench.mjs run --task T6-inplace-hard --arm A --repeats 20 --save-corpus benchmarks/corpus/main
node benchmarks/bench.mjs run --task T3-inplace      --arm A --repeats 20 --save-corpus benchmarks/corpus/main
# Phase 2 — replay each candidate over the SAME corpus (no ornith re-run)
for m in qwen3.5:4b qwen3-coder:30b gemma3:4b phi4 llama3.1:8b; do
  node benchmarks/bench.mjs verify-corpus --corpus benchmarks/corpus/main --verifier-model "$m"
done
node benchmarks/bench.mjs verify-report
```

`--save-corpus` and the coupled `--verifier-model` are independent; the corpus is
gitignored/ephemeral (conclusions go in the journal). `verify-corpus` rows are tagged
`source:"corpus"`: `verify-report` includes them, `report` ignores them.
````

- [ ] **Step 3: Point VERIFIER.md §5 at the implemented flow**

In `docs/VERIFIER.md`, in the "Model swapping" paragraph (§5), append:

```markdown
   This decoupled flow is implemented: `run --save-corpus <dir>` freezes each run's evidence +
   gold label, and `verify-corpus --corpus <dir> --verifier-model <id>` replays any candidate
   over that identical corpus (ornith runs once). See `benchmarks/README.md`.
```

- [ ] **Step 4: Changelog**

In `CHANGELOG.md`, under `## [Unreleased]` → `### Added`, add:

```markdown
- Decoupled verifier scoring: `bench.mjs run --save-corpus <dir>` freezes each ornith run's
  ground-truth evidence + gold label, and `bench.mjs verify-corpus --corpus <dir>
  --verifier-model <id>` replays any candidate over that same frozen corpus — fair
  cross-candidate comparison with ornith executed once. Rows tag `source:"corpus"`
  (`verify-report` includes them, `report` skips them). Corpus is gitignored/ephemeral.
  `run`/`verify-corpus` also accept `--results-dir <path>`.
```

- [ ] **Step 5: Run the full suite one last time**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add .gitignore benchmarks/README.md docs/VERIFIER.md CHANGELOG.md
git commit -m "docs(bench): document decoupled corpus verification flow"
```

---

## Notes for the implementer

- `test/fixtures/fake-pi.js` returns a JSON verdict **only** when the prompt contains
  `# EVIDENCE PACKET`; `adjudicate` builds exactly that prompt, so `verify-corpus` works
  offline under `ORN_PI_BIN`. `FAKE_PI_VERDICT` sets the verdict (`pass`/`fail`/`uncertain`).
- The coupled path (`run --verifier-model`) must keep producing identical rows — the only
  change is that `gatherEvidence` now runs once in `cmdRun` and `adjudicate` replaces the old
  `runVerifier` body. Do not alter the packet contents or the `--no-tools` behaviour.
- Keep `mkdtemp` for every test's temp dirs; never write to `benchmarks/results` or
  `benchmarks/corpus` from tests.
