# Orchestrate Driver M2 (Delegated Recon) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a candidate local orchestrator assemble its own round-1 grounding from a deterministic fact-pool (instead of the frozen gold `grounding.md`), so the M2-vs-own-M1 pass@N delta isolates the cost of delegating recon.

**Architecture:** A new pure module `src/recon.js` runs deterministic extractors over a task's template workdir + goal, producing a fact-pool. In `--recon candidate` mode, `bench.mjs orchestrate` sends that fact-pool to the candidate (inline, `--no-tools`, via a new `orchestrator/recon-rubric.md`), takes its reply verbatim as round-1 grounding, then runs the **unchanged M1 loop**. Rows are tagged `reconMode` and written to a separate `-recon.jsonl`; `orchestrate-report` partitions by mode and adds a recon-delegation delta. The two presidia (Layer-0 oracle, separate Layer-1 verifier) are untouched.

**Tech Stack:** Node ≥ 24 (ESM), `node:test`, zero runtime deps. `git` (already required) for `ls-files`/`grep`. Existing modules: `src/orchestrator.js`, `benchmarks/bench.mjs`, `test/fixtures/fake-pi.js`.

## Global Constraints

- **Node ≥ 24**, ESM only, **zero runtime dependencies** (dev/test = `node --test`).
- **Two presidia immovable:** the Layer-0 oracle scores the final workdir and is never shown to the candidate; the Layer-1 verifier (`qwen3.5:4b`) stays a separate model — the candidate never verifies its own runs.
- **Answer-key exclusion:** extraction must never read or surface these basenames — `meta.json`, `oracle.mjs`, `grounding.md`, `scaffold-heavy.md`, `goal.md` (goal is passed separately as text).
- **Don't steal the nest:** the recon rubric demands grounding **facts**, never step-by-step plans. Candidate output is used **verbatim** (never sanitized) — obedience is part of what we measure.
- **Back-compat:** `--recon` defaults to `fixed` (today's M1 behavior); a row with no `reconMode` reads as `fixed`. Existing `results/<task>__orch-<slug>.jsonl` files stay untouched.
- **Extractor caps:** ≤ 40 total grep hits; per source file ≤ 400 lines and ≤ 16 KB (flag truncation).
- Commit message style: Conventional Commits (`feat:`, `test:`, `docs:`), ending with the repo's `Co-Authored-By` trailer.

---

### Task 1: `extractGoalTokens` — deterministic goal-token extraction

**Files:**
- Create: `src/recon.js`
- Test: `test/recon.test.js`

**Interfaces:**
- Produces: `extractGoalTokens(goalText: string) → string[]` — identifiers worth grepping for, pulled from backtick spans and camelCase words in the goal, stop-worded and deduped. Consumed by Task 2 (`extractRecon`).

- [ ] **Step 1: Write the failing test**

Create `test/recon.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractGoalTokens } from "../src/recon.js";

test("extractGoalTokens: pulls camelCase words and backtick spans, drops stopwords", () => {
  const goal =
    "Refactor `withTax` in `src/pricing.mjs` to take the rate as a second argument; " +
    "update its callers lineTotal and cartTotal. Leave roundCents exactly as it is. Run `node --test`.";
  const toks = extractGoalTokens(goal);
  for (const t of ["withTax", "roundCents", "lineTotal", "cartTotal", "src/pricing.mjs"]) {
    assert.ok(toks.includes(t), `expected token ${t} in ${JSON.stringify(toks)}`);
  }
  // stopwords / bare English prose words are not tokens
  assert.ok(!toks.includes("Refactor"));
  assert.ok(!toks.includes("the"));
  // deduped
  assert.equal(new Set(toks).size, toks.length);
});

test("extractGoalTokens: non-string input is safe", () => {
  assert.deepEqual(extractGoalTokens(null), []);
  assert.deepEqual(extractGoalTokens(undefined), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/recon.test.js`
Expected: FAIL — `Cannot find module '../src/recon.js'` (or `extractGoalTokens is not a function`).

- [ ] **Step 3: Write minimal implementation**

Create `src/recon.js`:

```js
// Deterministic recon extractors for orchestrator M2 (docs/ORCHESTRATOR.md §6.2,
// spec docs/superpowers/specs/2026-07-12-orchestrate-driver-m2-design.md).
//
// PURE-ish: no network, no model, no judgment. The only IO is reading files
// inside a provided workdir and spawning `git` in it. NEVER reads a task's
// answer-keys (meta.json / oracle.mjs / grounding.md / scaffold-heavy.md).

// English/domain words that appear in goals but are not code identifiers.
const STOPWORDS = new Set([
  "the", "and", "for", "its", "must", "this", "that", "with", "from", "into", "only",
  "both", "each", "call", "calls", "file", "files", "code", "take", "takes", "pass",
  "passes", "change", "changes", "update", "updates", "run", "leave", "expect",
  "expects", "argument", "second", "current", "refactor", "callers", "suite", "now",
  "test", "tests", "node", "rate", "everything", "exactly", "signature", "function",
  "functions", "parameter", "hardcodes",
]);

// Identifiers worth grepping for: backtick spans (split on whitespace/punct) plus
// camelCase words in prose. Deduped, stop-worded, must contain a letter.
export function extractGoalTokens(goalText) {
  const raw = typeof goalText === "string" ? goalText : "";
  const tokens = new Set();
  for (const m of raw.matchAll(/`([^`]+)`/g)) {
    for (const t of m[1].split(/[\s(),]+/)) {
      const tok = t.trim();
      if (tok.length >= 3 && /[a-zA-Z]/.test(tok)) tokens.add(tok);
    }
  }
  for (const m of raw.matchAll(/\b([a-z][a-zA-Z0-9_$]*[A-Z][a-zA-Z0-9_$]*)\b/g)) {
    tokens.add(m[1]);
  }
  return [...tokens].filter((t) => !STOPWORDS.has(t.toLowerCase()));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/recon.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/recon.js test/recon.test.js
git commit -m "feat(recon): deterministic goal-token extraction for M2

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `extractRecon` + `renderFactPool` — the deterministic fact-pool

**Files:**
- Modify: `src/recon.js`
- Test: `test/recon.test.js`

**Interfaces:**
- Consumes: `extractGoalTokens` (Task 1).
- Produces:
  - `extractRecon(workdir: string, goalText: string, opts: { testCmd?: string[] }) → factPool` where
    `factPool = { testCommand: string, fileTree: string[], packageJson: {name,scripts,engines}|null, goalTokens: string[], grepHits: {token,file,line,text}[], grepTruncated: boolean, sourceOfHitFiles: {file,content,truncated}[] }`.
  - `renderFactPool(factPool) → string` — a stable `# RECON FACT-POOL` markdown block.
  Both consumed by Tasks 5, 6.

- [ ] **Step 1: Write the failing test**

Append to `test/recon.test.js`:

```js
import { extractRecon, renderFactPool } from "../src/recon.js";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

function tempGitRepo(files) {
  const wd = mkdtempSync(join(tmpdir(), "recon-test-"));
  for (const [rel, content] of Object.entries(files)) {
    const p = join(wd, rel);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, content);
  }
  const git = (args) => spawnSync("git", ["-C", wd, "-c", "user.email=t@t", "-c", "user.name=t", ...args]);
  git(["init", "-q"]); git(["add", "-A"]); git(["commit", "-q", "-m", "base"]);
  return wd;
}

test("extractRecon: gathers tree/grep/source, excludes answer-keys", () => {
  const wd = tempGitRepo({
    "package.json": JSON.stringify({ name: "demo", scripts: { test: "node --test" }, engines: { node: ">=24" } }),
    "src/pricing.mjs": "export function withTax(amount){return amount*1.2;}\nexport function roundCents(x){return Math.round(x*100)/100;}\n",
    "test/checkout.test.mjs": "import {withTax} from '../src/pricing.mjs';\n",
    // decoy answer-keys that MUST be ignored even if present in the workdir
    "meta.json": JSON.stringify({ allowedChangedFiles: ["src/pricing.mjs"] }),
    "oracle.mjs": "process.exit(0)",
  });
  try {
    const fp = extractRecon(wd, "Refactor `withTax` in `src/pricing.mjs`; keep roundCents.", { testCmd: ["node", "--test"] });
    assert.equal(fp.testCommand, "node --test");
    assert.ok(fp.fileTree.includes("src/pricing.mjs"));
    assert.ok(!fp.fileTree.some((f) => f.endsWith("meta.json") || f.endsWith("oracle.mjs")), "answer-keys leaked into fileTree");
    assert.equal(fp.packageJson.name, "demo");
    assert.ok(fp.goalTokens.includes("withTax"));
    assert.ok(fp.grepHits.some((h) => h.file === "src/pricing.mjs" && h.token === "withTax"));
    assert.ok(fp.sourceOfHitFiles.some((s) => s.file === "src/pricing.mjs"));
    assert.ok(!fp.sourceOfHitFiles.some((s) => s.file === "oracle.mjs" || s.file === "meta.json"));

    const rendered = renderFactPool(fp);
    assert.match(rendered, /# RECON FACT-POOL/);
    assert.match(rendered, /withTax/);
    assert.doesNotMatch(rendered, /allowedChangedFiles/, "answer-key content leaked into rendered pool");
  } finally {
    rmSync(wd, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/recon.test.js`
Expected: FAIL — `extractRecon is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `src/recon.js`:

```js
import { readFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { spawnSync } from "node:child_process";

const ANSWER_KEY_FILES = new Set(["meta.json", "oracle.mjs", "grounding.md", "scaffold-heavy.md", "goal.md"]);
const MAX_GREP_HITS = 40;
const MAX_FILE_LINES = 400;
const MAX_FILE_BYTES = 16 * 1024;

function git(workdir, args) {
  const res = spawnSync("git", ["-C", workdir, ...args], { encoding: "utf8" });
  return res.status === 0 ? res.stdout || "" : ""; // git grep exits 1 on no-match -> ""
}

export function extractRecon(workdir, goalText, { testCmd } = {}) {
  const testCommand = Array.isArray(testCmd) ? testCmd.join(" ") : typeof testCmd === "string" ? testCmd : "";
  const tracked = git(workdir, ["ls-files"]).split("\n").map((s) => s.trim()).filter(Boolean);
  const fileTree = tracked.filter((f) => !ANSWER_KEY_FILES.has(basename(f)));

  let packageJson = null;
  const pkgPath = join(workdir, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      packageJson = { name: pkg.name ?? null, scripts: pkg.scripts ?? null, engines: pkg.engines ?? null };
    } catch {
      packageJson = null;
    }
  }

  const goalTokens = extractGoalTokens(goalText);
  const grepHits = [];
  let grepTruncated = false;
  const hitFiles = new Set();
  outer: for (const token of goalTokens) {
    for (const line of git(workdir, ["grep", "-n", "-F", token]).split("\n")) {
      const m = line.match(/^([^:]+):(\d+):(.*)$/);
      if (!m) continue;
      const file = m[1];
      if (ANSWER_KEY_FILES.has(basename(file))) continue;
      if (grepHits.length >= MAX_GREP_HITS) { grepTruncated = true; break outer; }
      grepHits.push({ token, file, line: Number(m[2]), text: m[3].trim() });
      hitFiles.add(file);
    }
  }

  const sourceOfHitFiles = [];
  for (const file of hitFiles) {
    const p = join(workdir, file);
    if (!existsSync(p)) continue;
    let content = readFileSync(p, "utf8");
    let truncated = false;
    const lines = content.split("\n");
    if (lines.length > MAX_FILE_LINES) { content = lines.slice(0, MAX_FILE_LINES).join("\n"); truncated = true; }
    if (Buffer.byteLength(content, "utf8") > MAX_FILE_BYTES) { content = content.slice(0, MAX_FILE_BYTES); truncated = true; }
    sourceOfHitFiles.push({ file, content, truncated });
  }
  sourceOfHitFiles.sort((a, b) => a.file.localeCompare(b.file));

  return { testCommand, fileTree, packageJson, goalTokens, grepHits, grepTruncated, sourceOfHitFiles };
}

export function renderFactPool(fp) {
  const out = ["# RECON FACT-POOL", ""];
  out.push("## Test command", fp.testCommand || "(none provided)", "");
  out.push("## Files (tracked)", ...(fp.fileTree.length ? fp.fileTree.map((f) => `- ${f}`) : ["(none)"]), "");
  if (fp.packageJson) out.push("## package.json", "```json", JSON.stringify(fp.packageJson, null, 2), "```", "");
  out.push("## Goal tokens", fp.goalTokens.length ? fp.goalTokens.join(", ") : "(none)", "");
  out.push(`## Grep hits${fp.grepTruncated ? " (truncated)" : ""}`);
  out.push(...(fp.grepHits.length ? fp.grepHits.map((h) => `- ${h.file}:${h.line}: ${h.text}`) : ["(none)"]), "");
  out.push("## Source of files with hits");
  for (const s of fp.sourceOfHitFiles) out.push(`### ${s.file}${s.truncated ? " (truncated)" : ""}`, "```", s.content, "```", "");
  return out.join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/recon.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/recon.js test/recon.test.js
git commit -m "feat(recon): extractRecon + renderFactPool (answer-keys excluded)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `parseGrounding` — parse the candidate's assembled grounding

**Files:**
- Modify: `src/orchestrator.js`
- Test: `test/orchestrator.test.js`

**Interfaces:**
- Consumes: the module-private `extractJsonObject` already in `src/orchestrator.js`.
- Produces: `parseGrounding(text: string) → { grounding: string, empty: boolean }`. Consumed by Task 6 (driver recon-assembly).

- [ ] **Step 1: Write the failing test**

Append to `test/orchestrator.test.js` (and add `parseGrounding` to the existing import on line 3):

```js
test("parseGrounding: JSON object with a grounding string", () => {
  const r = parseGrounding('{"grounding":"- withTax lives in src/pricing.mjs\\n- run node --test"}');
  assert.equal(r.empty, false);
  assert.match(r.grounding, /withTax lives in src\/pricing\.mjs/);
});

test("parseGrounding: JSON in prose/fences is recovered", () => {
  const r = parseGrounding('Sure:\n```json\n{"grounding":"- keep roundCents byte-exact"}\n```');
  assert.equal(r.empty, false);
  assert.match(r.grounding, /roundCents/);
});

test("parseGrounding: plain-text body (no JSON) is taken as grounding", () => {
  const r = parseGrounding("- withTax is in src/pricing.mjs\n- run `node --test`");
  assert.equal(r.empty, false);
  assert.match(r.grounding, /withTax/);
});

test("parseGrounding: empty / whitespace / non-string -> empty", () => {
  assert.deepEqual(parseGrounding(""), { grounding: "", empty: true });
  assert.deepEqual(parseGrounding("   \n"), { grounding: "", empty: true });
  assert.deepEqual(parseGrounding(null), { grounding: "", empty: true });
  assert.deepEqual(parseGrounding('{"grounding":"   "}'), { grounding: "", empty: true });
});
```

Update the import line at the top of `test/orchestrator.test.js` to include `parseGrounding`:

```js
import { OUTCOMES, parseOrchestratorOutcome, scoreOrchestrator, orchestratorDeltas, ROUND_ACTIONS, parseRoundDecision, parseGrounding } from "../src/orchestrator.js";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/orchestrator.test.js`
Expected: FAIL — `parseGrounding is not a function` / export missing.

- [ ] **Step 3: Write minimal implementation**

In `src/orchestrator.js`, add after `parseRoundDecision` (before the `extractJsonObject` definition — it is hoisted, so order is safe):

```js
// Parse the candidate's assembled round-1 grounding (M2 recon). Prefers a JSON
// object { "grounding": "<facts>" }; falls back to the stripped plain/fenced body
// so a model that just writes the facts still works. Blank -> { empty: true }.
// Content is NOT sanitized here — whether it is "facts, not steps" is measured,
// not enforced (docs/ORCHESTRATOR.md §5.1).
export function parseGrounding(text) {
  const raw = typeof text === "string" ? text : "";
  const obj = extractJsonObject(raw);
  if (obj && typeof obj.grounding === "string") {
    const g = obj.grounding.trim();
    return g ? { grounding: g, empty: false } : { grounding: "", empty: true };
  }
  const body = raw.replace(/```[a-zA-Z]*\n?/g, "").trim();
  return body ? { grounding: body, empty: false } : { grounding: "", empty: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/orchestrator.test.js`
Expected: PASS (existing tests + 4 new).

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator.js test/orchestrator.test.js
git commit -m "feat(orchestrator): parseGrounding for M2 recon assembly

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: `orchestrator/recon-rubric.md` — the assembler instructions

**Files:**
- Create: `orchestrator/recon-rubric.md`
- Test: `test/recon.test.js` (a content guard)

**Interfaces:**
- Produces: a rubric file consumed by the driver (Task 6) via `ORCH_RECON_RUBRIC_PATH`. Must carry the sentinel string `# RECON ASSEMBLY` semantics (the driver appends that header) and forbid step-by-step scaffold.

- [ ] **Step 1: Write the failing test**

Append to `test/recon.test.js`:

```js
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

test("recon-rubric.md exists and forbids step-by-step scaffold", () => {
  const p = fileURLToPath(new URL("../orchestrator/recon-rubric.md", import.meta.url));
  const txt = readFileSync(p, "utf8");
  assert.match(txt, /grounding/i);
  assert.match(txt, /\bfact/i);
  assert.match(txt, /never|forbid|not.*(steps|plan)/i, "rubric must forbid step-by-step scaffold");
  assert.match(txt, /"grounding"/, "rubric must request the { grounding } JSON shape");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/recon.test.js`
Expected: FAIL — `ENOENT ... orchestrator/recon-rubric.md`.

- [ ] **Step 3: Write the rubric**

Create `orchestrator/recon-rubric.md`:

```markdown
# Recon rubric — the grounding assembler

You are the **orchestrator** preparing to hand a coding task to a separate model (ornith).
Ornith builds its own plan and writes the code; **you do not**. Your ONLY job here is to
assemble the **grounding** ornith needs before it starts — the facts it cannot derive on its
own — from the mechanical fact-pool below.

## The one discipline — grounding, never scaffold

Supply **grounding**: real paths, the current shape of the code vs. the required shape,
constraints and invariants to preserve, the exact test command. Never supply **scaffold**: a
plan, a numbered sequence of steps, or the solution itself. Ornith is trained to build its own
plan; handing it steps defeats the experiment.

- Grounding (allowed): "`withTax` is defined in `src/pricing.mjs` and called in `src/checkout.mjs`."
- Grounding (allowed): "The tests run with `node --test`; no `npm install` is needed."
- Scaffold (FORBIDDEN): "First change the signature, then update both call sites, then run the tests."

Include only facts supported by the fact-pool. Do not invent files, symbols, or values. Prefer
omission to guessing — if the fact-pool does not show it, leave it out.

## What you are given

- **GOAL** — what the task must achieve.
- **RECON FACT-POOL** — deterministic, mechanical: the test command, the tracked file tree,
  `package.json` essentials, the identifiers pulled from the goal, where they occur (grep hits),
  and the source of the files they occur in. This is ground truth; it contains no answer-key.

## Your output

Reply with exactly one JSON object and nothing else:

```json
{ "grounding": "<the grounding as a short markdown bullet list of facts>" }
```

Keep it tight — the facts ornith needs, no steps, no prose preamble.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/recon.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add orchestrator/recon-rubric.md test/recon.test.js
git commit -m "feat(orchestrator): recon-rubric.md — facts-not-steps assembler

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: `bench.mjs recon` command — print the fact-pool

**Files:**
- Modify: `benchmarks/bench.mjs` (imports; new `cmdRecon`; dispatch + usage)
- Test: `test/recon.test.js`

**Interfaces:**
- Consumes: `extractRecon`, `renderFactPool` (Task 2); existing `loadTask`, `makeWorkdir`, `die`, `parseFlags`.
- Produces: CLI `node benchmarks/bench.mjs recon --task <id>` → prints the rendered fact-pool to stdout. Consumed by humans / the Claude-M2 ceiling.

- [ ] **Step 1: Write the failing test**

Append to `test/recon.test.js`:

```js
import { execFileSync } from "node:child_process";

test("bench.mjs recon prints a fact-pool for a real task, no answer-keys", () => {
  const bench = fileURLToPath(new URL("../benchmarks/bench.mjs", import.meta.url));
  const out = execFileSync(process.execPath, [bench, "recon", "--task", "T6-inplace-hard"], { encoding: "utf8" });
  assert.match(out, /# RECON FACT-POOL/);
  assert.match(out, /withTax/);
  assert.match(out, /Test command/);
  assert.doesNotMatch(out, /allowedChangedFiles/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/recon.test.js`
Expected: FAIL — the `recon` command falls through to usage (exit 2) / no `# RECON FACT-POOL` in output.

- [ ] **Step 3: Wire the command**

In `benchmarks/bench.mjs`, extend the `src/recon.js` import (add near the other `../src` imports, line ~27):

```js
import { extractRecon, renderFactPool } from "../src/recon.js";
```

Add `cmdRecon` just above the `const argv = process.argv.slice(2);` dispatch block (line ~460):

```js
// Print the deterministic recon fact-pool for a task (docs/ORCHESTRATOR.md §6.2).
// Read-only; used for transparency and to feed the semi-manual Claude-M2 ceiling.
function cmdRecon(o) {
  const task = o.task || die("--task required");
  const t = loadTask(task);
  const wd = makeWorkdir(t);
  try {
    process.stdout.write(renderFactPool(extractRecon(wd, t.parts.goal, { testCmd: t.meta.testCmd })) + "\n");
  } finally {
    rmSync(wd, { recursive: true, force: true });
  }
}
```

In the dispatch chain (line ~466) add, before the `else` usage branch:

```js
else if (cmd === "recon") cmdRecon(opts);
```

Add a usage line inside the `usage:` string (after the `orchestrate-report` line):

```js
"       node benchmarks/bench.mjs recon --task <id>\n" +
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/recon.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add benchmarks/bench.mjs test/recon.test.js
git commit -m "feat(bench): recon command prints the deterministic fact-pool

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: `orchestrate --recon candidate` — delegate round-1 grounding

**Files:**
- Modify: `benchmarks/bench.mjs` (import `parseGrounding`; `ORCH_RECON_RUBRIC_PATH`; `assembleRecon` helper; `cmdOrchestrate` recon branch + row fields + filename; usage)
- Modify: `test/fixtures/fake-pi.js` (add `# RECON ASSEMBLY` role)
- Test: `test/orchestrate.test.js`

**Interfaces:**
- Consumes: `extractRecon`/`renderFactPool` (Task 2), `parseGrounding` (Task 3), `orchestrator/recon-rubric.md` (Task 4); existing `runOrn`, `makeWorkdir`, `gatherEvidence`, `adjudicate`, `runOracle`, `keepAwake`, `loadTask`.
- Produces: rows `{ ...existing, reconMode: "fixed"|"candidate", reconGrounding?, reconEmpty? }`; candidate rows in `results/<task>__orch-<slug>-recon.jsonl`.

- [ ] **Step 1: Write the failing test**

Look at `test/orchestrate.test.js` for the existing M1 dry-run pattern, then append a candidate-mode test mirroring it (fixture `ORN_PI_BIN` = fake-pi, `--results-dir` a temp dir):

```js
test("orchestrate --recon candidate: dry-run emits one reconMode:candidate row", () => {
  const bench = fileURLToPath(new URL("../benchmarks/bench.mjs", import.meta.url));
  const fakePi = fileURLToPath(new URL("./fixtures/fake-pi.js", import.meta.url));
  const resultsDir = mkdtempSync(join(tmpdir(), "orch-m2-"));
  try {
    execFileSync(process.execPath,
      [bench, "orchestrate", "--task", "T4-additive-hard", "--repeats", "1",
       "--orchestrator-model", "fake", "--recon", "candidate", "--results-dir", resultsDir],
      { encoding: "utf8", env: { ...process.env, ORN_PI_BIN: fakePi, FAKE_PI_ACTION: "done" } });
    const file = join(resultsDir, "T4-additive-hard__orch-fake-recon.jsonl");
    const rows = readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].reconMode, "candidate");
    assert.equal(rows[0].orchestratorOutcome, "done");
    assert.equal(typeof rows[0].reconGrounding, "string");
  } finally {
    rmSync(resultsDir, { recursive: true, force: true });
  }
});
```

Ensure the test file imports `mkdtempSync, readFileSync, rmSync` from `node:fs`, `join` from `node:path`, `tmpdir` from `node:os`, `execFileSync` from `node:child_process`, and `fileURLToPath` from `node:url` (add any missing to its existing imports).

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/orchestrate.test.js`
Expected: FAIL — no `-recon.jsonl` file (recon flag ignored; row written to the fixed filename without `reconMode`).

- [ ] **Step 3a: Add the fake-pi recon role**

In `test/fixtures/fake-pi.js`, add after the `isOrchestratorCall` const (line ~14):

```js
const isReconCall = process.argv.some((a) => typeof a === "string" && a.includes("# RECON ASSEMBLY"));
```

Add a branch before the `else if (isOrchestratorCall)` branch:

```js
} else if (isReconCall) {
  const text = process.env.FAKE_PI_RECON_EMPTY === "1"
    ? ""
    : JSON.stringify({ grounding: process.env.FAKE_PI_GROUNDING || "- Change only files the tests reference; run `node --test`." });
  const msg = { role: "assistant", stopReason: "stop", content: [{ type: "text", text }] };
  const lines = [
    { type: "session", version: 3, id: "44444444-4444-4444-4444-444444444444", timestamp: "2026-07-07T16:50:00.000Z", cwd: "/tmp/recon" },
    { type: "agent_start" },
    { type: "agent_end", messages: [msg] },
  ];
  process.stdout.write(lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  process.exit(0);
```

- [ ] **Step 3b: Wire recon into the driver**

In `benchmarks/bench.mjs`, extend the orchestrator import (line ~26) to add `parseGrounding`:

```js
import { scoreOrchestrator, orchestratorDeltas, parseRoundDecision, parseGrounding } from "../src/orchestrator.js";
```

Add the rubric path constant next to `ORCH_RUBRIC_PATH` (line ~35):

```js
const ORCH_RECON_RUBRIC_PATH = resolve(HERE, "..", "orchestrator", "recon-rubric.md");
```

Add the `assembleRecon` helper just above `cmdOrchestrate` (line ~339):

```js
// M2: the candidate assembles round-1 grounding from the deterministic fact-pool.
// Read-only, inline (--no-tools). Returns { grounding, empty } (parseGrounding).
function assembleRecon({ task, goal, factPoolText, model }) {
  const rubric = readFileSync(ORCH_RECON_RUBRIC_PATH, "utf8");
  const prompt = `${rubric}\n\n---\n\n# RECON ASSEMBLY\n\n## GOAL\n${(goal || "").trim()}\n\n${factPoolText}`;
  const runsDir = mkdtempSync(join(tmpdir(), "bench-orch-recon-"));
  try {
    const dec = runOrn({ prompt, model, label: `${task}-orch-recon`, runsDir, noTools: true });
    return parseGrounding(dec.record?.finalText || "");
  } finally {
    rmSync(runsDir, { recursive: true, force: true });
  }
}
```

In `cmdOrchestrate`, **replace** the two existing lines

```js
const slug = orchestratorModel.replace(/[^a-zA-Z0-9]+/g, "-");
const resultsFile = join(resultsDir, `${task}__orch-${slug}.jsonl`);
```

with (do not duplicate `const slug`):

```js
const reconMode = o.recon === "candidate" ? "candidate" : "fixed";
const slug = orchestratorModel.replace(/[^a-zA-Z0-9]+/g, "-");
const resultsFile = join(resultsDir, `${task}__orch-${slug}${reconMode === "candidate" ? "-recon" : ""}.jsonl`);
```

Inside the `for (const repeat of repeats)` loop, replace the fixed-recon initialization
(`let grounding = (t.parts.grounding || "").trim(); // recon FIXED in M1`) with:

```js
let reconGrounding = null;
let reconEmpty = false;
let grounding;
if (reconMode === "candidate") {
  const reconWd = makeWorkdir(t);
  let factPoolText;
  try { factPoolText = renderFactPool(extractRecon(reconWd, t.parts.goal, { testCmd: t.meta.testCmd })); }
  finally { rmSync(reconWd, { recursive: true, force: true }); }
  const r = assembleRecon({ task, goal: t.parts.goal, factPoolText, model: orchestratorModel });
  reconGrounding = r.grounding;
  reconEmpty = r.empty;
  grounding = r.grounding || "";
} else {
  grounding = (t.parts.grounding || "").trim(); // recon FIXED in M1
}
```

In the row object (line ~410) add the mode fields:

```js
const row = {
  task, repeat, orchestratorModel, orchestratorOutcome: outcome,
  pass: oracle.pass, orchestratorRounds: roundsUsed, orchestratorReason: reason, verifierModel,
  reconMode,
  ...(reconMode === "candidate" ? { reconGrounding, reconEmpty } : {}),
};
```

Update the `orchestrate` usage line (line ~475) to include `[--recon fixed|candidate]`:

```js
"       node benchmarks/bench.mjs orchestrate --task <id> --orchestrator-model <id> [--recon fixed|candidate] [--verifier-model <id>] [--repeats N] [--rounds N] [--results-dir path]\n" +
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/orchestrate.test.js test/orchestrator.test.js test/recon.test.js`
Expected: PASS (existing M1 dry-run + the new candidate-mode test + all Task 1–5 tests).

- [ ] **Step 5: Commit**

```bash
git add benchmarks/bench.mjs test/fixtures/fake-pi.js test/orchestrate.test.js
git commit -m "feat(bench): orchestrate --recon candidate delegates round-1 grounding

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: `orchestrate-report` — partition by reconMode + recon-delegation delta

**Files:**
- Modify: `src/orchestrator.js` (new `orchestratorReconDeltas`)
- Modify: `benchmarks/bench.mjs` (`cmdOrchestrateReport` partitions + prints the new delta)
- Test: `test/orchestrator.test.js`

**Interfaces:**
- Consumes: rows carrying `reconMode` (Task 6), existing `scoreOrchestrator`/`orchestratorDeltas`.
- Produces: `orchestratorReconDeltas(rows) → { task, model, candidatePassN, fixedPassN, delta }[]` (delta = candidate − same-model fixed; only where candidate rows exist). Consumed by `cmdOrchestrateReport`.

- [ ] **Step 1: Write the failing test**

Append to `test/orchestrator.test.js` (add `orchestratorReconDeltas` to the import line):

```js
test("orchestratorReconDeltas: candidate-M2 pass@N minus same model's fixed-M1", () => {
  const rows = [
    // model X, T4: fixed 2/2 done+pass; candidate 1/2 done+pass
    { task: "T4", repeat: 1, orchestratorModel: "X", orchestratorOutcome: "done", pass: true, reconMode: "fixed" },
    { task: "T4", repeat: 2, orchestratorModel: "X", orchestratorOutcome: "done", pass: true, reconMode: "fixed" },
    { task: "T4", repeat: 1, orchestratorModel: "X", orchestratorOutcome: "done", pass: true, reconMode: "candidate" },
    { task: "T4", repeat: 2, orchestratorModel: "X", orchestratorOutcome: "escalate", pass: true, reconMode: "candidate" },
    // rows with no candidate data are not reported
    { task: "T4", repeat: 1, orchestratorModel: "claude", orchestratorOutcome: "done", pass: true, reconMode: "fixed" },
  ];
  const d = orchestratorReconDeltas(rows);
  const x = d.find((r) => r.model === "X" && r.task === "T4");
  assert.equal(x.candidatePassN, 0.5);
  assert.equal(x.fixedPassN, 1);
  assert.equal(x.delta, -0.5);
  assert.ok(!d.some((r) => r.model === "claude"), "no candidate rows for claude -> not reported");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/orchestrator.test.js`
Expected: FAIL — `orchestratorReconDeltas is not a function`.

- [ ] **Step 3a: Add the pure helper**

Append to `src/orchestrator.js`:

```js
// Recon-delegation delta (docs/ORCHESTRATOR.md M2): for each (task, model), the
// candidate-assembled-recon pass@N minus the SAME model's fixed-recon (M1) pass@N.
// pass@N = trueSuccess / repeats, as in orchestratorDeltas. Only (task, model)
// pairs that have candidate rows are returned; fixedPassN is null if that model
// has no fixed rows for the task (delta then null).
export function orchestratorReconDeltas(rows) {
  const cells = new Map(); // `${task} ${model}` -> { task, model, fixed, candidate }
  const fresh = () => ({ repeats: new Set(), trueSuccess: 0 });
  for (const r of rows) {
    if (!r || r.orchestratorOutcome == null || r.task == null) continue;
    const mode = r.reconMode === "candidate" ? "candidate" : "fixed";
    const model = r.orchestratorModel || "(unknown)";
    const k = `${r.task} ${model}`;
    if (!cells.has(k)) cells.set(k, { task: r.task, model, fixed: fresh(), candidate: fresh() });
    const cell = cells.get(k)[mode];
    cell.repeats.add(r.repeat);
    if (r.orchestratorOutcome === "done" && Boolean(r.pass)) cell.trueSuccess++;
  }
  const passN = (c) => (c.repeats.size ? c.trueSuccess / c.repeats.size : null);
  const out = [];
  for (const { task, model, fixed, candidate } of cells.values()) {
    const cand = passN(candidate);
    if (cand == null) continue; // only report where M2 data exists
    const base = passN(fixed);
    out.push({ task, model, candidatePassN: cand, fixedPassN: base, delta: base != null ? cand - base : null });
  }
  out.sort((a, b) => (a.task === b.task ? a.model.localeCompare(b.model) : a.task.localeCompare(b.task)));
  return out;
}
```

- [ ] **Step 3b: Partition the report**

In `benchmarks/bench.mjs`, extend the orchestrator import to add `orchestratorReconDeltas`:

```js
import { scoreOrchestrator, orchestratorDeltas, parseRoundDecision, parseGrounding, orchestratorReconDeltas } from "../src/orchestrator.js";
```

Replace the body of `cmdOrchestrateReport` (lines ~302–331) with a mode-partitioned version:

```js
function cmdOrchestrateReport(o) {
  const rows = loadRows().filter((r) => r.orchestratorOutcome);
  if (!rows.length) return process.stdout.write("no orchestrator results yet (see `orchestrate` and docs/ORCHESTRATOR.md)\n");
  const baselineModel = typeof o.baseline === "string" ? o.baseline : "claude";
  const modeOf = (r) => (r.reconMode === "candidate" ? "candidate" : "fixed");

  for (const mode of ["fixed", "candidate"]) {
    const sub = rows.filter((r) => modeOf(r) === mode);
    if (!sub.length) continue;
    process.stdout.write(`\n== recon: ${mode} ${mode === "fixed" ? "(M1 — gold grounding)" : "(M2 — candidate-assembled)"} ==\n`);
    process.stdout.write("model                          n  autoPass  falseSucc  effFS  escalate\n");
    for (const s of scoreOrchestrator(sub)) {
      process.stdout.write(
        `${String(s.model).padEnd(28)} ${String(s.n).padStart(3)}  ${pct(s.autonomousPassRate)}    ${pct(s.falseSuccessRate)}   ${pct(s.effectiveFalseSuccess)}   ${pct(s.escalationRate)}\n`
      );
    }
    const dl = orchestratorDeltas(sub, { baselineModel });
    if (dl.length) {
      process.stdout.write(`\nPer-task pass@N delta vs baseline '${baselineModel}' (positive = candidate matches/beats Claude)\n`);
      process.stdout.write("task            model                    passN  baseN   delta\n");
      for (const d of dl) {
        process.stdout.write(`${d.task.padEnd(15)} ${String(d.model).padEnd(24)} ${pct(d.autonomousPassN)}  ${pct(d.baselinePassN)}  ${signed(d.delta)}\n`);
      }
    }
  }

  const rd = orchestratorReconDeltas(rows);
  if (rd.length) {
    process.stdout.write("\nRecon-delegation delta — candidate-M2 pass@N vs the SAME model's fixed-M1 (negative = cost of self-assembled recon)\n");
    process.stdout.write("task            model                    M2     M1     delta\n");
    for (const d of rd) {
      process.stdout.write(`${d.task.padEnd(15)} ${String(d.model).padEnd(24)} ${pct(d.candidatePassN)}  ${pct(d.fixedPassN)}  ${signed(d.delta)}\n`);
    }
  }

  process.stdout.write(
    "\neffFS = false-success among 'done' calls (the safety metric; want ≈0)\n" +
      "autoPass = loops the orchestrator finished itself and the oracle confirmed\n" +
      "escalate = share routed to the Claude audit tier\n"
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/orchestrator.test.js`
Expected: PASS (all existing + the new `orchestratorReconDeltas` test).

Also spot-check the report renders (uses existing M1 rows if present, else prints the no-results line):
Run: `node benchmarks/bench.mjs orchestrate-report`
Expected: a `== recon: fixed (M1 — gold grounding) ==` section (candidate section only once M2 rows exist).

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator.js benchmarks/bench.mjs test/orchestrator.test.js
git commit -m "feat(orchestrator): report partitions by reconMode + recon-delegation delta

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Full suite green + docs (ORCHESTRATOR.md, CHANGELOG)

**Files:**
- Modify: `docs/ORCHESTRATOR.md` (§9 note that M2 is built; the M2 spec/plan pointers)
- Modify: `CHANGELOG.md` (`[Unreleased] → Added`)
- Test: whole suite

**Interfaces:** none (docs + verification only).

- [ ] **Step 1: Run the whole suite**

Run: `npm test`
Expected: PASS, 0 failures (the prior 102 tests + the new recon/parseGrounding/report/orchestrate tests).

- [ ] **Step 2: Update `docs/ORCHESTRATOR.md`**

In §9, under the "Not yet built — M2" paragraph (added when M1 landed), replace it to reflect that M2 is now implemented:

```markdown
**Built (M2, 2026-07-13):** `bench.mjs orchestrate --recon candidate` delegates the round-1
recon — deterministic extractors (`src/recon.js`) build a fact-pool (test command, file tree,
`package.json`, goal-token grep hits + the source of hit-files; answer-keys excluded), the
candidate assembles round-1 grounding from it inline (`orchestrator/recon-rubric.md`,
`parseGrounding`), and the M1 loop runs unchanged. `bench.mjs recon --task <id>` prints the
fact-pool; `orchestrate-report` partitions by `reconMode` and shows the candidate-M2-vs-own-M1
delta. Spec: `docs/superpowers/specs/2026-07-12-orchestrate-driver-m2-design.md`; results land
in §11 once the run session completes.
```

- [ ] **Step 3: Update `CHANGELOG.md`**

Under `## [Unreleased]` → `### Added`, add:

```markdown
- **Orchestrator M2 — delegated recon** (`bench.mjs orchestrate --recon candidate`): the
  candidate assembles its own round-1 grounding from a deterministic fact-pool built by
  `src/recon.js` (test command, file tree, `package.json`, goal-token grep hits + hit-file
  source; task answer-keys excluded) via `orchestrator/recon-rubric.md` (facts, never steps),
  then runs the unchanged M1 loop. New `bench.mjs recon --task <id>` prints the fact-pool.
  Rows tag `reconMode: fixed|candidate` (default `fixed`, back-compat); `orchestrate-report`
  partitions by mode and adds the candidate-M2-vs-own-M1 recon-delegation delta. Dry-runnable
  via the `fake-pi` `# RECON ASSEMBLY` role.
```

- [ ] **Step 4: Re-run the suite (docs don't break tests, confirm anyway)**

Run: `npm test`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add docs/ORCHESTRATOR.md CHANGELOG.md
git commit -m "docs(orchestrator): M2 delegated-recon driver built; CHANGELOG

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Notes for the run session (not part of this plan)

After this plan lands (all dry-run/unit tests green, no ollama needed), a separate **run
session** with ollama executes the actual campaign, exactly as M1 was run:

- `for m in llama3.1:8b qwen3:14b gemma4:12b; do for t in T6-inplace-hard T4-additive-hard; do node benchmarks/bench.mjs orchestrate --task "$t" --orchestrator-model "$m" --recon candidate --repeats 5; done; done`
- Produce the semi-manual **Claude-M2 ceiling**: `node benchmarks/bench.mjs recon --task <t>` → Claude assembles grounding → drive the loop by hand (as the M1 Claude baseline was), record rows `orchestratorModel:"claude", reconMode:"candidate"`.
- Run the sweep **daemonized** (`setsid`/double-fork + `caffeinate`, own process group) so it survives — the durability lesson from the M1 sweep (`journal/2026-07-12-orchestrator-selection-2.md`).
- Then `orchestrate-report`, and write `docs/ORCHESTRATOR.md §11` + the journal with the M2−own-M1 deltas.
```
