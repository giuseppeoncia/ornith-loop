# ornith-loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `orn` Node CLI (a thin, observable wrapper around `pi` for driving self-scaffolding local models) and the `ornith-loop` Claude Code skill that encodes the grounding → run → verify → journal method.

**Architecture:** `orn` is a zero-runtime-dependency Node ESM CLI split into pure, unit-testable modules (arg parsing, pi invocation with a kill-timer, JSONL event parsing, heuristic flags, git workdir snapshots, run-record + human summary) wired together by a thin `bin/orn.js`. The `ornith-loop` skill is a Markdown `SKILL.md` living in the repo and installed to `~/.claude/skills/` via a symlink script so it is usable from any project. The journal is per-run Markdown files that embed the observability summary (self-contained, committed) backed by ephemeral raw event logs under `runs/`.

**Tech Stack:** Node v24 (ESM, `node:test` + `node:assert/strict`, `node:child_process`, `node:fs`), no runtime or dev dependencies. `pi` (`@earendil-works/pi-coding-agent` v0.80.3) invoked as a subprocess against a local Ollama provider.

**Spec:** [`../specs/2026-07-07-ornith-loop-implementation.md`](../specs/2026-07-07-ornith-loop-implementation.md) (scope + acceptance criteria; defers to `docs/DESIGN.md` for full design).

## Context

Why this exists (from `docs/DESIGN.md`, the source of truth): Ornith is RL-trained to build its own scaffold (plan, tool-call sequence, error recovery); `pi` is the minimalist harness that leaves room for exactly that. The tool must **not steal ornith's nest** — it supplies *grounding* (facts the model can't derive) and *verification/observability*, never *reasoning scaffold*. `orn` mechanizes the hand-discovered pi best-practices and turns pi's raw event stream into a run summary; the skill encodes the method; the journal accumulates comparable observations across runs/models — the primary "learning" deliverable.

The three DESIGN "Open items" are resolved by this plan:
1. **Journal layout** → per-run Markdown files under `journal/` that *embed* the summary (self-contained, committed), documented by `journal/README.md`. Not an append log (per-run files diff and compare better across models).
2. **Run-record schema** → versioned JSON (`schemaVersion: 1`) written under `runs/` (gitignored, ephemeral) alongside the raw `.jsonl` event log; fields defined in Task 7.
3. **git snapshot heuristic** → `orn` optionally takes `--workdir`; when it is a git repo, `orn` snapshots `git rev-parse HEAD` + `git status --porcelain` before and after the run to power the `claimed-done-no-change` flag.

**Skill location decision:** source of truth is `skill/ornith-loop/SKILL.md` in this repo; `scripts/install-skill.sh` symlinks `~/.claude/skills/ornith-loop → <repo>/skill/ornith-loop` (copy fallback) so edits are live and the skill works on other projects.

## Global Constraints

Copied verbatim / derived from `docs/DESIGN.md` and `CLAUDE.md`:

- **Language:** Node only (single language for invocation + jsonl parsing). ESM (`"type": "module"`). Node **v24+**.
- **Zero dependencies:** no runtime deps, no dev deps. Tests use built-in `node:test` and `node:assert/strict`.
- **`--thinking off` is the default** and empirically required (thinking-on leaks tool calls into the reasoning channel as `<tool_call>` *text* that the openai-completions provider cannot parse).
- **Default model:** `ornith-1.0-9b-64k`. **Default provider:** `ollama`. **Default timeout:** `900` seconds.
- **pi invocation reality (verified against v0.80.3):** the npm package is `@earendil-works/pi-coding-agent`. **There is NO `--prompt` flag** — the prompt is a positional argument; `-p`/`--print` is the non-interactive switch. Valid `--thinking` values: `off, minimal, low, medium, high, xhigh` (no `on`). Valid `--mode` values: `text, json, rpc`. `--name`/`-n` sets the label. Spawn with an **argv array (no shell)** so multiline/special-char prompts are safe.
- **pi stdout in `--mode json` is JSONL:** one JSON object per line, first line is `{"type":"session",...}`, then lifecycle events. Tool names are **lowercase** (`read bash edit write grep find ls`).
- **`orn` does NOT** author prompts, choose grounding, or judge correctness. Those belong to the skill / Claude.
- **macOS has no `timeout`** — use a Node child-process kill timer.
- **Pass environment through** to the pi subprocess (Node spawn inherits `process.env` by default; keep it).
- **Never trust ornith's self-report.** `orn` reports observations and heuristic flags only; correctness verdicts come from external verification in the skill.
- **Changelog:** [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); SemVer. Update `docs/DESIGN.md` if design decisions change.
- **`runs/` is gitignored** (already in `.gitignore`); `journal/` is committed.

---

## File Structure

```
package.json                     ESM, bin: { orn: bin/orn.js }, scripts: test
bin/orn.js                       thin entrypoint: orchestrates the modules
src/args.js                      argv -> validated options (pure)
src/invoke.js                    spawn pi with kill-timer + env passthrough
src/parse.js                     JSONL string -> events -> observability summary (pure)
src/flags.js                     summary + workdir diff -> heuristic flags (pure)
src/git.js                       workdir snapshot + change detection
src/record.js                    build run-record JSON + write record & raw log
src/summary.js                   run-record -> human-readable summary string (pure)
test/args.test.js
test/parse.test.js
test/flags.test.js
test/git.test.js
test/invoke.test.js
test/record.test.js
test/summary.test.js
test/cli.test.js                 integration: bin/orn.js against a fake pi
test/fixtures/ornith-success.jsonl        canned pi event stream (clean run)
test/fixtures/ornith-toolcall-as-text.jsonl  canned stream: <tool_call> leaked as text
test/fixtures/fake-pi.js         stub that emits a fixture and can sleep (timeout test)
journal/README.md                journal format + template
skill/ornith-loop/SKILL.md       the Claude Code skill
scripts/install-skill.sh         symlink skill into ~/.claude/skills/
```

Each `src/*.js` file has one responsibility and is pure where possible (`parse`, `flags`, `summary`, `args`) so it is testable without spawning pi. `invoke` and `git` touch the process/filesystem and are tested with stubs. `bin/orn.js` holds only orchestration.

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`
- Create: `test/smoke.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `npm test` runs `node --test`; ESM + bin wiring that all later tasks rely on.

- [ ] **Step 1: Write the failing smoke test**

Create `test/smoke.test.js`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("package.json is ESM with an orn bin and a test script", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.type, "module");
  assert.equal(pkg.bin.orn, "bin/orn.js");
  assert.ok(pkg.scripts.test.includes("node --test"));
  assert.equal(pkg.dependencies ?? undefined, undefined, "no runtime deps");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/smoke.test.js`
Expected: FAIL — `package.json` does not exist (ENOENT) / cannot import.

- [ ] **Step 3: Create `package.json`**

```json
{
  "name": "ornith-loop",
  "version": "0.1.0",
  "description": "Observable pi-invocation harness for self-scaffolding local models (ornith), with Claude as external reviewer.",
  "type": "module",
  "bin": { "orn": "bin/orn.js" },
  "engines": { "node": ">=24" },
  "scripts": {
    "test": "node --test"
  },
  "license": "MIT"
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/smoke.test.js`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add package.json test/smoke.test.js
git commit -m "chore: scaffold orn Node CLI package (ESM, node:test, zero deps)"
```

---

### Task 2: Event-stream parser (`src/parse.js`)

Parses pi's JSONL into events and extracts the observability facts. This is the analytical core.

**Files:**
- Create: `src/parse.js`
- Create: `test/parse.test.js`
- Create: `test/fixtures/ornith-success.jsonl`

**Interfaces:**
- Consumes: nothing (pure string in).
- Produces:
  - `parseEventStream(jsonl: string) => { header: object|null, events: object[], malformedLines: number }`
  - `summarizeEvents(events: object[]) => Summary` where
    `Summary = { toolSequence: {name: string, args: any, isError: boolean|null}[], toolCallCount: number, thinkingBlockCount: number, thinkingTexts: string[], assistantTexts: string[], finalText: string, stopReason: string|null, errorMessage: string|null }`

Notes on extraction (from verified schema):
- Tool calls that *actually executed* come from `tool_execution_start` events (fields `toolName`, `args`); mark `isError` by matching the later `tool_execution_end` with the same `toolCallId`.
- Thinking blocks: count `{type:"thinking"}` content blocks and collect their `thinking` strings from the final assistant messages (prefer `agent_end.messages`; fall back to `message_end` messages).
- Assistant text: collect `{type:"text"}` block `text` from assistant messages; `finalText` is the concatenation of the last assistant message's text blocks.
- `stopReason` / `errorMessage`: from the last assistant message (`stopReason` ∈ `stop|length|toolUse|error|aborted`).

- [ ] **Step 1: Write the fixture (a clean ornith run)**

Create `test/fixtures/ornith-success.jsonl` (one object per line; a write-from-scratch task that reads then writes a file, then stops):
```
{"type":"session","version":3,"id":"11111111-1111-1111-1111-111111111111","timestamp":"2026-07-07T16:50:00.000Z","cwd":"/tmp/target"}
{"type":"agent_start"}
{"type":"turn_start"}
{"type":"tool_execution_start","toolCallId":"c1","toolName":"read","args":{"path":"package.json"}}
{"type":"tool_execution_end","toolCallId":"c1","toolName":"read","result":"{...}","isError":false}
{"type":"tool_execution_start","toolCallId":"c2","toolName":"write","args":{"path":"hello.txt","content":"hi"}}
{"type":"tool_execution_end","toolCallId":"c2","toolName":"write","result":"ok","isError":false}
{"type":"message_end","message":{"role":"assistant","stopReason":"stop","content":[{"type":"thinking","thinking":"I will create the file."},{"type":"text","text":"Done. I created hello.txt."}]}}
{"type":"turn_end","message":{"role":"assistant","stopReason":"stop","content":[{"type":"text","text":"Done. I created hello.txt."}]},"toolResults":[]}
{"type":"agent_end","messages":[{"role":"assistant","stopReason":"stop","content":[{"type":"thinking","thinking":"I will create the file."},{"type":"text","text":"Done. I created hello.txt."}]}]}
```

- [ ] **Step 2: Write the failing test**

Create `test/parse.test.js`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseEventStream, summarizeEvents } from "../src/parse.js";

const fixture = () => readFile(new URL("./fixtures/ornith-success.jsonl", import.meta.url), "utf8");

test("parseEventStream splits JSONL, captures header, counts malformed lines", async () => {
  const { header, events, malformedLines } = parseEventStream(await fixture());
  assert.equal(header.type, "session");
  assert.equal(malformedLines, 0);
  assert.ok(events.some((e) => e.type === "agent_end"));
});

test("parseEventStream tolerates blank and malformed lines", () => {
  const { events, malformedLines } = parseEventStream('\n{"type":"agent_start"}\nnot json\n');
  assert.equal(events.length, 1);
  assert.equal(malformedLines, 1);
});

test("summarizeEvents extracts tool sequence, thinking, final text, stopReason", async () => {
  const { events } = parseEventStream(await fixture());
  const s = summarizeEvents(events);
  assert.deepEqual(s.toolSequence.map((t) => t.name), ["read", "write"]);
  assert.equal(s.toolCallCount, 2);
  assert.equal(s.toolSequence[0].isError, false);
  assert.equal(s.thinkingBlockCount, 1);
  assert.equal(s.finalText, "Done. I created hello.txt.");
  assert.equal(s.stopReason, "stop");
  assert.equal(s.errorMessage, null);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test test/parse.test.js`
Expected: FAIL — cannot find module `../src/parse.js`.

- [ ] **Step 4: Implement `src/parse.js`**

```js
// Parse pi's `--mode json` output (JSONL) into events and an observability summary.
// Schema verified against @earendil-works/pi-coding-agent v0.80.3 docs/json.md.

export function parseEventStream(jsonl) {
  let header = null;
  const events = [];
  let malformedLines = 0;
  for (const line of jsonl.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      malformedLines++;
      continue;
    }
    if (obj.type === "session" && header === null) header = obj;
    else events.push(obj);
  }
  return { header, events, malformedLines };
}

function assistantContent(message) {
  if (!message || message.role !== "assistant" || !Array.isArray(message.content)) return [];
  return message.content;
}

// The most complete list of final assistant messages: prefer agent_end.messages,
// else all message_end assistant messages in order.
function finalAssistantMessages(events) {
  const end = events.find((e) => e.type === "agent_end");
  if (end && Array.isArray(end.messages)) return end.messages.filter((m) => m.role === "assistant");
  return events.filter((e) => e.type === "message_end").map((e) => e.message).filter((m) => m && m.role === "assistant");
}

export function summarizeEvents(events) {
  // Tool sequence from actually-executed calls.
  const errorById = new Map();
  for (const e of events) {
    if (e.type === "tool_execution_end") errorById.set(e.toolCallId, Boolean(e.isError));
  }
  const toolSequence = events
    .filter((e) => e.type === "tool_execution_start")
    .map((e) => ({
      name: e.toolName,
      args: e.args ?? null,
      isError: errorById.has(e.toolCallId) ? errorById.get(e.toolCallId) : null,
    }));

  const messages = finalAssistantMessages(events);
  const thinkingTexts = [];
  const assistantTexts = [];
  let lastTextBlocks = [];
  let stopReason = null;
  let errorMessage = null;
  for (const m of messages) {
    const blocks = assistantContent(m);
    const textBlocks = [];
    for (const b of blocks) {
      if (b.type === "thinking" && typeof b.thinking === "string") thinkingTexts.push(b.thinking);
      if (b.type === "text" && typeof b.text === "string") {
        assistantTexts.push(b.text);
        textBlocks.push(b.text);
      }
    }
    if (textBlocks.length) lastTextBlocks = textBlocks;
    if (typeof m.stopReason === "string") stopReason = m.stopReason;
    if (typeof m.errorMessage === "string") errorMessage = m.errorMessage;
  }

  return {
    toolSequence,
    toolCallCount: toolSequence.length,
    thinkingBlockCount: thinkingTexts.length,
    thinkingTexts,
    assistantTexts,
    finalText: lastTextBlocks.join("").trim(),
    stopReason,
    errorMessage,
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test test/parse.test.js`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/parse.js test/parse.test.js test/fixtures/ornith-success.jsonl
git commit -m "feat(orn): parse pi JSONL event stream into observability summary"
```

---

### Task 3: Heuristic flags (`src/flags.js`)

The failure-mode detectors from DESIGN, kept separate so their (noisy, heuristic) logic is isolated and independently testable.

**Files:**
- Create: `src/flags.js`
- Create: `test/flags.test.js`
- Create: `test/fixtures/ornith-toolcall-as-text.jsonl`

**Interfaces:**
- Consumes: `Summary` from `src/parse.js`; optional `workdirChange` from `src/git.js` (`{ changed: boolean } | null`).
- Produces: `detectFlags({ summary, workdirChange }) => { toolCallAsText: boolean, stoppedBeforeToolCall: boolean, claimedDone: boolean, claimedDoneNoChange: boolean }`

Heuristic definitions (documented as heuristics, not ground truth):
- `toolCallAsText`: any thinking OR assistant text string matches a leaked-tool-call pattern — `/<\/?tool_call>/i`, `/<\|channel\|>\s*commentary/i`, or `/<function[_\s]?call/i`.
- `stoppedBeforeToolCall`: `summary.toolCallCount === 0`.
- `claimedDone`: `finalText` matches `/\b(done|completed?|finished|all set|task complete)\b/i` or contains `✅`/`✓`.
- `claimedDoneNoChange`: `claimedDone && workdirChange && workdirChange.changed === false`.

- [ ] **Step 1: Write the leaked-tool-call fixture**

Create `test/fixtures/ornith-toolcall-as-text.jsonl` (thinking-on failure mode: the call is text, no tool ever executes, model stops):
```
{"type":"session","version":3,"id":"22222222-2222-2222-2222-222222222222","timestamp":"2026-07-07T16:55:00.000Z","cwd":"/tmp/target"}
{"type":"agent_start"}
{"type":"turn_start"}
{"type":"message_end","message":{"role":"assistant","stopReason":"stop","content":[{"type":"thinking","thinking":"Let me call the tool.\n<tool_call>{\"name\":\"write\",\"arguments\":{\"path\":\"x\"}}</tool_call>"},{"type":"text","text":"Now I'll create the file."}]}}
{"type":"agent_end","messages":[{"role":"assistant","stopReason":"stop","content":[{"type":"thinking","thinking":"Let me call the tool.\n<tool_call>{\"name\":\"write\",\"arguments\":{\"path\":\"x\"}}</tool_call>"},{"type":"text","text":"Now I'll create the file."}]}]}
```

- [ ] **Step 2: Write the failing test**

Create `test/flags.test.js`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseEventStream, summarizeEvents } from "../src/parse.js";
import { detectFlags } from "../src/flags.js";

const summaryOf = async (name) => {
  const jsonl = await readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
  return summarizeEvents(parseEventStream(jsonl).events);
};

test("clean run: no failure flags, claimedDone true", async () => {
  const summary = await summaryOf("ornith-success.jsonl");
  const f = detectFlags({ summary, workdirChange: { changed: true } });
  assert.equal(f.toolCallAsText, false);
  assert.equal(f.stoppedBeforeToolCall, false);
  assert.equal(f.claimedDone, true);
  assert.equal(f.claimedDoneNoChange, false);
});

test("leaked tool call: toolCallAsText and stoppedBeforeToolCall true", async () => {
  const summary = await summaryOf("ornith-toolcall-as-text.jsonl");
  const f = detectFlags({ summary, workdirChange: null });
  assert.equal(f.toolCallAsText, true);
  assert.equal(f.stoppedBeforeToolCall, true);
});

test("claimedDoneNoChange fires only when done claimed but workdir unchanged", async () => {
  const summary = await summaryOf("ornith-success.jsonl");
  assert.equal(detectFlags({ summary, workdirChange: { changed: false } }).claimedDoneNoChange, true);
  assert.equal(detectFlags({ summary, workdirChange: { changed: true } }).claimedDoneNoChange, false);
  assert.equal(detectFlags({ summary, workdirChange: null }).claimedDoneNoChange, false);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test test/flags.test.js`
Expected: FAIL — cannot find module `../src/flags.js`.

- [ ] **Step 4: Implement `src/flags.js`**

```js
// Heuristic failure-mode detectors. These are signals for a human/Claude reviewer,
// NOT ground truth. Kept deliberately simple and documented as heuristics.

const LEAKED_TOOL_CALL = [/<\/?tool_call>/i, /<\|channel\|>\s*commentary/i, /<function[_\s]?call/i];
const DONE_MARKER = /\b(done|completed?|finished|all set|task complete)\b/i;

export function detectFlags({ summary, workdirChange }) {
  const haystack = [...summary.thinkingTexts, ...summary.assistantTexts];
  const toolCallAsText = haystack.some((s) => LEAKED_TOOL_CALL.some((re) => re.test(s)));
  const stoppedBeforeToolCall = summary.toolCallCount === 0;
  const claimedDone =
    DONE_MARKER.test(summary.finalText) || summary.finalText.includes("✅") || summary.finalText.includes("✓");
  const claimedDoneNoChange = Boolean(claimedDone && workdirChange && workdirChange.changed === false);
  return { toolCallAsText, stoppedBeforeToolCall, claimedDone, claimedDoneNoChange };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test test/flags.test.js`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/flags.js test/flags.test.js test/fixtures/ornith-toolcall-as-text.jsonl
git commit -m "feat(orn): heuristic failure-mode flags (tool-call-as-text, stalled, claimed-done)"
```

---

### Task 4: Git workdir snapshot (`src/git.js`)

Powers the `claimed-done-no-change` heuristic when `--workdir` is given.

**Files:**
- Create: `src/git.js`
- Create: `test/git.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `snapshot(workdir: string) => { isRepo: boolean, head: string|null, dirtyFiles: string[] }` — runs `git rev-parse HEAD` and `git status --porcelain` in `workdir`; `isRepo:false` (with `head:null`, `dirtyFiles:[]`) if the dir is not a git repo.
  - `diffSnapshots(before, after) => { changed: boolean }` — `changed` is true if `head` differs OR the set of `dirtyFiles` differs (a commit or any working-tree change counts as change).

- [ ] **Step 1: Write the failing test**

Create `test/git.test.js`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { snapshot, diffSnapshots } from "../src/git.js";

test("snapshot reports non-repo cleanly", async () => {
  const dir = await mkdtemp(join(tmpdir(), "orn-nonrepo-"));
  try {
    const s = snapshot(dir);
    assert.equal(s.isRepo, false);
    assert.equal(s.head, null);
    assert.deepEqual(s.dirtyFiles, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("diffSnapshots detects a new dirty file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "orn-repo-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: dir });
    execFileSync("git", ["config", "user.email", "t@t"], { cwd: dir });
    execFileSync("git", ["config", "user.name", "t"], { cwd: dir });
    await writeFile(join(dir, "seed.txt"), "seed");
    execFileSync("git", ["add", "."], { cwd: dir });
    execFileSync("git", ["commit", "-qm", "seed"], { cwd: dir });
    const before = snapshot(dir);
    assert.equal(before.isRepo, true);
    await writeFile(join(dir, "new.txt"), "hi");
    const after = snapshot(dir);
    assert.equal(diffSnapshots(before, after).changed, true);
    assert.equal(diffSnapshots(before, before).changed, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/git.test.js`
Expected: FAIL — cannot find module `../src/git.js`.

- [ ] **Step 3: Implement `src/git.js`**

```js
import { execFileSync } from "node:child_process";

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}

export function snapshot(workdir) {
  try {
    const inside = git(["rev-parse", "--is-inside-work-tree"], workdir).trim();
    if (inside !== "true") return { isRepo: false, head: null, dirtyFiles: [] };
  } catch {
    return { isRepo: false, head: null, dirtyFiles: [] };
  }
  let head = null;
  try {
    head = git(["rev-parse", "HEAD"], workdir).trim();
  } catch {
    head = null; // repo with no commits yet
  }
  const porcelain = git(["status", "--porcelain"], workdir);
  const dirtyFiles = porcelain.split("\n").map((l) => l.trim()).filter(Boolean).sort();
  return { isRepo: true, head, dirtyFiles };
}

export function diffSnapshots(before, after) {
  const headChanged = before.head !== after.head;
  const dirtyChanged = JSON.stringify(before.dirtyFiles) !== JSON.stringify(after.dirtyFiles);
  return { changed: headChanged || dirtyChanged };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/git.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/git.js test/git.test.js
git commit -m "feat(orn): git workdir snapshot + change detection for claimed-done heuristic"
```

---

### Task 5: Argument parsing (`src/args.js`)

**Files:**
- Create: `src/args.js`
- Create: `test/args.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `parseArgs(argv: string[]) => { options?: Options, error?: string, help?: boolean }` where
  `Options = { command: "run", prompt: string, promptFile: string|null, model: string, provider: string, thinking: string, timeoutSec: number, label: string, workdir: string|null, runsDir: string, piBin: string }`

Rules:
- Subcommand `run` required. Prompt from a positional arg OR `--prompt-file <path>` (exactly one required; error if both/neither).
- Flags: `--model` (default `ornith-1.0-9b-64k`), `--provider` (default `ollama`), `--thinking` (default `off`; must be one of `off,minimal,low,medium,high,xhigh`), `--timeout` seconds (default `900`; positive integer), `--label`/`-n` (default derived from a slug of the prompt's first ~5 words, else `run`), `--workdir` (default `null`), `--runs-dir` (default `runs`).
- `piBin` from env `ORN_PI_BIN` else `"pi"` (so tests can inject a stub; not a user flag).
- `-h`/`--help` → `{ help: true }`.
- Note: `parseArgs` does NOT read the prompt file (keeps it pure/sync-testable); `bin/orn.js` reads it. It only records `promptFile` and leaves `prompt` empty in that case.

- [ ] **Step 1: Write the failing test**

Create `test/args.test.js`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "../src/args.js";

test("defaults are applied for a bare run with inline prompt", () => {
  const { options, error } = parseArgs(["run", "make a file"]);
  assert.equal(error, undefined);
  assert.equal(options.command, "run");
  assert.equal(options.prompt, "make a file");
  assert.equal(options.model, "ornith-1.0-9b-64k");
  assert.equal(options.provider, "ollama");
  assert.equal(options.thinking, "off");
  assert.equal(options.timeoutSec, 900);
  assert.equal(options.runsDir, "runs");
  assert.ok(options.label.length > 0);
});

test("flags override defaults", () => {
  const { options } = parseArgs([
    "run", "hi", "--model", "qwen3.6-35b-a3b-64k", "--thinking", "off",
    "--timeout", "120", "--label", "exp1", "--workdir", "/tmp/t",
  ]);
  assert.equal(options.model, "qwen3.6-35b-a3b-64k");
  assert.equal(options.timeoutSec, 120);
  assert.equal(options.label, "exp1");
  assert.equal(options.workdir, "/tmp/t");
});

test("--prompt-file sets promptFile and leaves prompt empty", () => {
  const { options } = parseArgs(["run", "--prompt-file", "p.md"]);
  assert.equal(options.promptFile, "p.md");
  assert.equal(options.prompt, "");
});

test("errors: no prompt, both prompt sources, bad thinking, bad timeout, missing command", () => {
  assert.match(parseArgs(["run"]).error, /prompt/i);
  assert.match(parseArgs(["run", "hi", "--prompt-file", "p.md"]).error, /both/i);
  assert.match(parseArgs(["run", "hi", "--thinking", "on"]).error, /thinking/i);
  assert.match(parseArgs(["run", "hi", "--timeout", "-3"]).error, /timeout/i);
  assert.match(parseArgs(["bogus"]).error, /command/i);
});

test("--help returns help", () => {
  assert.equal(parseArgs(["--help"]).help, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/args.test.js`
Expected: FAIL — cannot find module `../src/args.js`.

- [ ] **Step 3: Implement `src/args.js`**

```js
const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh"]);

function slugLabel(prompt) {
  const slug = prompt.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").split("-").slice(0, 5).join("-");
  return slug || "run";
}

export function parseArgs(argv) {
  if (argv.includes("-h") || argv.includes("--help")) return { help: true };

  const command = argv[0];
  if (command !== "run") return { error: `unknown command '${command ?? ""}': expected 'run'` };

  const opts = {
    command: "run",
    prompt: "",
    promptFile: null,
    model: "ornith-1.0-9b-64k",
    provider: "ollama",
    thinking: "off",
    timeoutSec: 900,
    label: null,
    workdir: null,
    runsDir: "runs",
    piBin: process.env.ORN_PI_BIN || "pi",
  };
  const positionals = [];

  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--prompt-file": opts.promptFile = next(); break;
      case "--model": opts.model = next(); break;
      case "--provider": opts.provider = next(); break;
      case "--thinking": opts.thinking = next(); break;
      case "--timeout": opts.timeoutSec = Number(next()); break;
      case "--label": case "-n": opts.label = next(); break;
      case "--workdir": opts.workdir = next(); break;
      case "--runs-dir": opts.runsDir = next(); break;
      default:
        if (a.startsWith("-")) return { error: `unknown flag '${a}'` };
        positionals.push(a);
    }
  }

  opts.prompt = positionals.join(" ");
  const hasInline = opts.prompt.length > 0;
  const hasFile = Boolean(opts.promptFile);
  if (hasInline && hasFile) return { error: "provide a prompt via positional OR --prompt-file, not both" };
  if (!hasInline && !hasFile) return { error: "no prompt: pass an inline prompt or --prompt-file <path>" };
  if (!THINKING_LEVELS.has(opts.thinking))
    return { error: `invalid --thinking '${opts.thinking}': one of ${[...THINKING_LEVELS].join(", ")}` };
  if (!Number.isInteger(opts.timeoutSec) || opts.timeoutSec <= 0)
    return { error: `invalid --timeout: must be a positive integer number of seconds` };

  if (!opts.label) opts.label = hasFile ? "run" : slugLabel(opts.prompt);
  return { options: opts };
}

export const HELP = `orn run <prompt> [options]
  --prompt-file <path>   read the prompt from a file (instead of a positional)
  --model <id>           default: ornith-1.0-9b-64k
  --provider <name>      default: ollama
  --thinking <level>     off|minimal|low|medium|high|xhigh (default: off)
  --timeout <seconds>    kill pi after N seconds (default: 900)
  --label, -n <name>     session/run label (default: slug of prompt)
  --workdir <path>       git repo to snapshot before/after (claimed-done-no-change flag)
  --runs-dir <path>      where to write run records (default: runs)
  -h, --help             show this help
env: ORN_PI_BIN overrides the pi binary path (default: pi)`;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/args.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/args.js test/args.test.js
git commit -m "feat(orn): CLI argument parsing with validated defaults"
```

---

### Task 6: pi invocation with kill-timer (`src/invoke.js`)

**Files:**
- Create: `src/invoke.js`
- Create: `test/invoke.test.js`
- Create: `test/fixtures/fake-pi.js`

**Interfaces:**
- Consumes: `Options` fields (`prompt, model, provider, thinking, label, timeoutSec, piBin, workdir`).
- Produces: `invokePi(opts) => Promise<{ stdout: string, stderr: string, exitCode: number|null, signal: string|null, timedOut: boolean, durationMs: number, argv: string[] }>`

Behavior:
- Builds argv: `["--print", "--provider", provider, "--model", model, "--thinking", thinking, "--mode", "json", "--name", label, prompt]` (prompt is the trailing positional). No shell.
- `cwd` = `opts.workdir` if set, else `process.cwd()` (so ornith operates in the target repo).
- Inherits `process.env` (env passthrough) merged with `opts.env` if provided.
- Kill-timer: after `timeoutSec * 1000` ms, send `SIGTERM`, set `timedOut = true`; escalate to `SIGKILL` 2s later if still alive.
- `durationMs` computed from an injectable `now` (default `Date.now`) so the value is deterministic under test. Resolves (never rejects) on process close; a spawn error (e.g. bin not found) resolves with `exitCode: null` and the error text in `stderr`.

- [ ] **Step 1: Write the fake pi stub**

Create `test/fixtures/fake-pi.js`:
```js
#!/usr/bin/env node
// Stub pi for tests. Echoes a fixture stream, or sleeps forever to force a timeout.
// Controlled by env: FAKE_PI_MODE = "success" | "hang" | "crash".
import { readFile } from "node:fs/promises";

const mode = process.env.FAKE_PI_MODE || "success";
if (mode === "crash") {
  process.stderr.write("boom\n");
  process.exit(2);
} else if (mode === "hang") {
  setInterval(() => {}, 1000); // never exits
} else {
  const url = new URL("./ornith-success.jsonl", import.meta.url);
  process.stdout.write(await readFile(url, "utf8"));
  process.exit(0);
}
```

- [ ] **Step 2: Write the failing test**

Create `test/invoke.test.js`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { invokePi } from "../src/invoke.js";

const fakePi = fileURLToPath(new URL("./fixtures/fake-pi.js", import.meta.url));
const base = { prompt: "hi", model: "m", provider: "ollama", thinking: "off", label: "t", timeoutSec: 30, piBin: fakePi };

test("invokePi builds the expected argv and captures stdout", async () => {
  const r = await invokePi({ ...base, env: { FAKE_PI_MODE: "success" } });
  assert.deepEqual(r.argv, ["--print", "--provider", "ollama", "--model", "m", "--thinking", "off", "--mode", "json", "--name", "t", "hi"]);
  assert.equal(r.timedOut, false);
  assert.equal(r.exitCode, 0);
  assert.match(r.stdout, /agent_end/);
});

test("invokePi enforces the timeout on a hanging pi", async () => {
  const r = await invokePi({ ...base, timeoutSec: 1, env: { FAKE_PI_MODE: "hang" } });
  assert.equal(r.timedOut, true);
  assert.notEqual(r.signal, null);
});

test("invokePi surfaces a nonzero exit without throwing", async () => {
  const r = await invokePi({ ...base, env: { FAKE_PI_MODE: "crash" } });
  assert.equal(r.exitCode, 2);
  assert.match(r.stderr, /boom/);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test test/invoke.test.js`
Expected: FAIL — cannot find module `../src/invoke.js`.

- [ ] **Step 4: Implement `src/invoke.js`**

```js
import { spawn } from "node:child_process";

export function invokePi(opts) {
  const { prompt, model, provider, thinking, label, timeoutSec, piBin, workdir, env, now = Date.now } = opts;
  const argv = ["--print", "--provider", provider, "--model", model, "--thinking", thinking, "--mode", "json", "--name", label, prompt];

  return new Promise((resolve) => {
    const start = now();
    let timedOut = false;
    let child;
    try {
      child = spawn(piBin, argv, {
        cwd: workdir || process.cwd(),
        env: { ...process.env, ...(env || {}) },
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      resolve({ stdout: "", stderr: String(err?.message ?? err), exitCode: null, signal: null, timedOut: false, durationMs: now() - start, argv });
      return;
    }

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));

    const killTimer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2000).unref();
    }, timeoutSec * 1000);

    child.on("error", (err) => {
      clearTimeout(killTimer);
      resolve({ stdout, stderr: stderr || String(err?.message ?? err), exitCode: null, signal: null, timedOut, durationMs: now() - start, argv });
    });
    child.on("close", (code, signal) => {
      clearTimeout(killTimer);
      resolve({ stdout, stderr, exitCode: code, signal, timedOut, durationMs: now() - start, argv });
    });
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test test/invoke.test.js`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/invoke.js test/invoke.test.js test/fixtures/fake-pi.js
git commit -m "feat(orn): invoke pi with argv-array spawn, env passthrough, kill-timer"
```

---

### Task 7: Run-record + human summary (`src/record.js`, `src/summary.js`)

Resolves the run-record schema open item and writes both the record and the raw event log.

**Files:**
- Create: `src/record.js`
- Create: `src/summary.js`
- Create: `test/record.test.js`
- Create: `test/summary.test.js`

**Interfaces:**
- Consumes: `Options` (Task 5), the `invokePi` result (Task 6), `Summary` (Task 2), `flags` (Task 3), and `workdirChange` (Task 4, `{changed:boolean}|null`).
- Produces:
  - `buildRecord({ options, invocation, summary, flags, workdirChange, runId, timestamp }) => Record` (pure; `runId`/`timestamp` injected).
  - `writeRecord(record, rawStdout, { runsDir }) => { recordPath, logPath }` — writes `runsDir/<runId>.json` (record) and `runsDir/<runId>.jsonl` (raw stream), creating `runsDir`.
  - `formatSummary(record) => string` (in `summary.js`; pure).
  - `deriveExitReason(invocation) => "completed" | "timeout" | "error"` — `timeout` if `timedOut`, `error` if `exitCode !== 0 && !timedOut`, else `completed`.

**Run-record schema (`schemaVersion: 1`):**
```jsonc
{
  "schemaVersion": 1,
  "runId": "2026-07-07T16-50-00-000Z_exp1",  // <ISO with : and . replaced by ->_<label>
  "label": "exp1",
  "timestamp": "2026-07-07T16:50:00.000Z",
  "model": "ornith-1.0-9b-64k",
  "provider": "ollama",
  "thinking": "off",
  "timeoutSec": 900,
  "workdir": "/path" ,                        // or null
  "prompt": "…",                              // the resolved prompt text
  "invocation": { "argv": [...], "exitCode": 0, "signal": null, "timedOut": false, "durationMs": 1234 },
  "exit": { "reason": "completed", "stopReason": "stop", "errorMessage": null },
  "toolSequence": [ { "name": "read", "args": {…}, "isError": false } ],
  "toolCallCount": 2,
  "thinkingBlockCount": 1,
  "finalText": "…",
  "flags": { "toolCallAsText": false, "stoppedBeforeToolCall": false, "claimedDone": true, "claimedDoneNoChange": false },
  "workdirChange": { "before": {…}, "after": {…}, "changed": true },  // or null
  "malformedLines": 0,
  "logPath": "runs/<runId>.jsonl"
}
```

- [ ] **Step 1: Write the failing tests**

Create `test/record.test.js`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRecord, writeRecord, deriveExitReason } from "../src/record.js";

const opts = { label: "exp1", model: "ornith-1.0-9b-64k", provider: "ollama", thinking: "off", timeoutSec: 900, workdir: null, prompt: "make a file" };
const invocation = { argv: ["--print"], exitCode: 0, signal: null, timedOut: false, durationMs: 1234 };
const summary = { toolSequence: [{ name: "write", args: { path: "x" }, isError: false }], toolCallCount: 1, thinkingBlockCount: 0, finalText: "Done.", stopReason: "stop", errorMessage: null };
const flags = { toolCallAsText: false, stoppedBeforeToolCall: false, claimedDone: true, claimedDoneNoChange: false };

test("deriveExitReason maps invocation state", () => {
  assert.equal(deriveExitReason({ timedOut: true, exitCode: null }), "timeout");
  assert.equal(deriveExitReason({ timedOut: false, exitCode: 2 }), "error");
  assert.equal(deriveExitReason({ timedOut: false, exitCode: 0 }), "completed");
});

test("buildRecord composes a schemaVersion-1 record", () => {
  const r = buildRecord({ options: opts, invocation, summary, flags, workdirChange: null, runId: "RID", timestamp: "2026-07-07T16:50:00.000Z" });
  assert.equal(r.schemaVersion, 1);
  assert.equal(r.runId, "RID");
  assert.equal(r.exit.reason, "completed");
  assert.equal(r.exit.stopReason, "stop");
  assert.equal(r.toolCallCount, 1);
  assert.equal(r.logPath, "runs/RID.jsonl");
  assert.equal(r.flags.claimedDone, true);
});

test("writeRecord writes record json and raw log", async () => {
  const dir = await mkdtemp(join(tmpdir(), "orn-runs-"));
  try {
    const r = buildRecord({ options: opts, invocation, summary, flags, workdirChange: null, runId: "RID", timestamp: "2026-07-07T16:50:00.000Z", runsDir: dir });
    const { recordPath, logPath } = writeRecord(r, "{\"type\":\"agent_end\"}\n", { runsDir: dir });
    const written = JSON.parse(await readFile(recordPath, "utf8"));
    assert.equal(written.runId, "RID");
    assert.match(await readFile(logPath, "utf8"), /agent_end/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

Create `test/summary.test.js`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatSummary } from "../src/summary.js";

test("formatSummary renders reason, tool sequence, flags", () => {
  const record = {
    runId: "RID", model: "ornith-1.0-9b-64k", exit: { reason: "completed", stopReason: "stop" },
    invocation: { durationMs: 1234, timedOut: false }, toolSequence: [{ name: "read" }, { name: "write" }],
    toolCallCount: 2, thinkingBlockCount: 0, finalText: "Done.",
    flags: { toolCallAsText: false, stoppedBeforeToolCall: false, claimedDone: true, claimedDoneNoChange: false },
    logPath: "runs/RID.jsonl",
  };
  const out = formatSummary(record);
  assert.match(out, /completed/);
  assert.match(out, /read → write/);
  assert.match(out, /claimed-done/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/record.test.js test/summary.test.js`
Expected: FAIL — cannot find modules `../src/record.js`, `../src/summary.js`.

- [ ] **Step 3: Implement `src/record.js`**

```js
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function deriveExitReason({ timedOut, exitCode }) {
  if (timedOut) return "timeout";
  if (exitCode !== 0) return "error";
  return "completed";
}

export function buildRecord({ options, invocation, summary, flags, workdirChange, runId, timestamp }) {
  return {
    schemaVersion: 1,
    runId,
    label: options.label,
    timestamp,
    model: options.model,
    provider: options.provider,
    thinking: options.thinking,
    timeoutSec: options.timeoutSec,
    workdir: options.workdir,
    prompt: options.prompt,
    invocation: {
      argv: invocation.argv,
      exitCode: invocation.exitCode,
      signal: invocation.signal,
      timedOut: invocation.timedOut,
      durationMs: invocation.durationMs,
    },
    exit: {
      reason: deriveExitReason(invocation),
      stopReason: summary.stopReason,
      errorMessage: summary.errorMessage,
    },
    toolSequence: summary.toolSequence,
    toolCallCount: summary.toolCallCount,
    thinkingBlockCount: summary.thinkingBlockCount,
    finalText: summary.finalText,
    flags,
    workdirChange,
    malformedLines: summary.malformedLines ?? 0,
    logPath: `runs/${runId}.jsonl`,
  };
}

export function writeRecord(record, rawStdout, { runsDir }) {
  mkdirSync(runsDir, { recursive: true });
  const recordPath = join(runsDir, `${record.runId}.json`);
  const logPath = join(runsDir, `${record.runId}.jsonl`);
  writeFileSync(recordPath, JSON.stringify(record, null, 2) + "\n");
  writeFileSync(logPath, rawStdout);
  return { recordPath, logPath };
}
```

- [ ] **Step 4: Implement `src/summary.js`**

```js
const YES = "⚠", NO = "·";
const flag = (v) => (v ? YES : NO);

export function formatSummary(record) {
  const { exit, invocation, toolSequence, flags } = record;
  const seq = toolSequence.length ? toolSequence.map((t) => t.name).join(" → ") : "(none)";
  const secs = (invocation.durationMs / 1000).toFixed(1);
  const lines = [
    `run ${record.runId}  [${record.model}]`,
    `exit: ${exit.reason}  stopReason: ${exit.stopReason ?? "?"}  ${secs}s${invocation.timedOut ? "  (timed out)" : ""}`,
    `tool sequence (${record.toolCallCount}): ${seq}`,
    `thinking blocks: ${record.thinkingBlockCount}`,
    `flags: ${flag(flags.toolCallAsText)} tool-call-as-text  ${flag(flags.stoppedBeforeToolCall)} stopped-before-tool-call  ${flag(flags.claimedDone)} claimed-done  ${flag(flags.claimedDoneNoChange)} claimed-done-no-change`,
    `final text: ${record.finalText ? record.finalText.slice(0, 200) : "(empty)"}`,
    `raw log: ${record.logPath}`,
  ];
  return lines.join("\n");
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test test/record.test.js test/summary.test.js`
Expected: PASS (4 tests total).

- [ ] **Step 6: Commit**

```bash
git add src/record.js src/summary.js test/record.test.js test/summary.test.js
git commit -m "feat(orn): run-record schema v1, writer, and human summary formatter"
```

---

### Task 8: CLI entrypoint (`bin/orn.js`) + integration test

Wires every module together. This is the only task that reads a prompt file, generates the runId/timestamp, and orchestrates git snapshots around the invocation.

**Files:**
- Create: `bin/orn.js`
- Create: `test/cli.test.js`

**Interfaces:**
- Consumes: all of `src/*`.
- Produces: an executable CLI. `orn run …` → writes a run record under `runs/`, prints the human summary, exits `0` on `completed`, `1` otherwise.

Orchestration order:
1. `parseArgs(process.argv.slice(2))`; on `help` print `HELP` and exit 0; on `error` print to stderr and exit 2.
2. If `promptFile`, read it into `options.prompt`.
3. Compute `timestamp = new Date().toISOString()` and `runId = timestamp.replace(/[:.]/g, "-") + "_" + label`.
4. If `workdir`, `before = snapshot(workdir)`.
5. `invokePi(options)`.
6. `parseEventStream` → `summarizeEvents`; attach `malformedLines` onto summary.
7. If `workdir`, `after = snapshot(workdir)`; `workdirChange = { before, after, ...diffSnapshots(before, after) }`, else `null`.
8. `detectFlags({ summary, workdirChange })`.
9. `buildRecord(...)`; `writeRecord(...)`.
10. Print `formatSummary(record)`; exit per `exit.reason`.

- [ ] **Step 1: Write the failing integration test**

Create `test/cli.test.js`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const pexec = promisify(execFile);
const orn = fileURLToPath(new URL("../bin/orn.js", import.meta.url));
const fakePi = fileURLToPath(new URL("./fixtures/fake-pi.js", import.meta.url));

test("orn run: writes a record, prints summary, exits 0", async () => {
  const runs = await mkdtemp(join(tmpdir(), "orn-cli-"));
  try {
    const { stdout } = await pexec(process.execPath, [orn, "run", "make a file", "--label", "it", "--runs-dir", runs], {
      env: { ...process.env, ORN_PI_BIN: fakePi, FAKE_PI_MODE: "success" },
    });
    assert.match(stdout, /exit: completed/);
    assert.match(stdout, /read → write/);
    const files = await readdir(runs);
    assert.ok(files.some((f) => f.endsWith(".json")));
    assert.ok(files.some((f) => f.endsWith(".jsonl")));
  } finally {
    await rm(runs, { recursive: true, force: true });
  }
});

test("orn run: nonzero exit when pi crashes", async () => {
  const runs = await mkdtemp(join(tmpdir(), "orn-cli-"));
  try {
    await assert.rejects(
      pexec(process.execPath, [orn, "run", "hi", "--runs-dir", runs], {
        env: { ...process.env, ORN_PI_BIN: fakePi, FAKE_PI_MODE: "crash" },
      }),
      (err) => err.code === 1
    );
  } finally {
    await rm(runs, { recursive: true, force: true });
  }
});

test("orn --help exits 0 with usage", async () => {
  const { stdout } = await pexec(process.execPath, [orn, "--help"]);
  assert.match(stdout, /orn run/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/cli.test.js`
Expected: FAIL — cannot find `../bin/orn.js`.

- [ ] **Step 3: Implement `bin/orn.js`**

```js
#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { parseArgs, HELP } from "../src/args.js";
import { invokePi } from "../src/invoke.js";
import { parseEventStream, summarizeEvents } from "../src/parse.js";
import { detectFlags } from "../src/flags.js";
import { snapshot, diffSnapshots } from "../src/git.js";
import { buildRecord, writeRecord } from "../src/record.js";
import { formatSummary } from "../src/summary.js";

const parsed = parseArgs(process.argv.slice(2));
if (parsed.help) {
  process.stdout.write(HELP + "\n");
  process.exit(0);
}
if (parsed.error) {
  process.stderr.write(`orn: ${parsed.error}\n\n${HELP}\n`);
  process.exit(2);
}
const options = parsed.options;

if (options.promptFile) {
  try {
    options.prompt = readFileSync(options.promptFile, "utf8");
  } catch (err) {
    process.stderr.write(`orn: cannot read --prompt-file ${options.promptFile}: ${err.message}\n`);
    process.exit(2);
  }
}

const timestamp = new Date().toISOString();
const runId = `${timestamp.replace(/[:.]/g, "-")}_${options.label}`;

const before = options.workdir ? snapshot(options.workdir) : null;

const invocation = await invokePi(options);

const { events, malformedLines } = parseEventStream(invocation.stdout);
const summary = summarizeEvents(events);
summary.malformedLines = malformedLines;

let workdirChange = null;
if (options.workdir && before) {
  const after = snapshot(options.workdir);
  workdirChange = { before, after, changed: diffSnapshots(before, after).changed };
}

const flags = detectFlags({ summary, workdirChange });
const record = buildRecord({ options, invocation, summary, flags, workdirChange, runId, timestamp });
const { recordPath } = writeRecord(record, invocation.stdout, { runsDir: options.runsDir });

process.stdout.write(formatSummary(record) + `\nrecord: ${recordPath}\n`);
if (invocation.stderr.trim() && record.exit.reason !== "completed") {
  process.stderr.write(`\npi stderr:\n${invocation.stderr}\n`);
}
process.exit(record.exit.reason === "completed" ? 0 : 1);
```

- [ ] **Step 4: Make it executable and run the test**

Run: `chmod +x bin/orn.js && node --test test/cli.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: all tests PASS across every `test/*.test.js`.

- [ ] **Step 6: Commit**

```bash
git add bin/orn.js test/cli.test.js
git commit -m "feat(orn): CLI entrypoint wiring parse/flags/git/record/summary + integration test"
```

---

### Task 9: Journal layout + docs (README, CHANGELOG)

Resolves the journal-layout open item and fills the `CLAUDE.md` "Commands" gap.

**Files:**
- Create: `journal/README.md`
- Modify: `README.md` (add a "Usage" / "Commands" section, flip status off "design phase")
- Modify: `CHANGELOG.md` (move items under a new `### Added` for the CLI)
- Modify: `docs/DESIGN.md` (mark the three Open items as resolved, pointing to this plan's decisions)

**Interfaces:**
- Consumes: the run-record schema (Task 7) and `orn` CLI (Task 8).
- Produces: the journal template every skill run will fill.

- [ ] **Step 1: Create `journal/README.md`**

```markdown
# Experiment Journal

One Markdown file per run: `journal/YYYY-MM-DD-<label>.md` (append `-2`, `-3` … on
same-day/label collision). Entries are **self-contained** — they embed the observability
summary so the journal survives even though raw run records under `runs/` are gitignored
and ephemeral.

## Template

​```markdown
# <label> — <YYYY-MM-DD>

- **Model:** ornith-1.0-9b-64k
- **Task (goal given to ornith):** <one line>
- **Grounding supplied:** <paths/versions/routes/selectors the model could not derive>
- **Run record:** runs/<runId>.json  (ephemeral; key facts embedded below)

## What the self-scaffold did
- Exit: <completed|timeout|error>, stopReason <…>, <N>s
- Tool sequence (<n>): read → write → bash → …
- Thinking blocks: <n>
- Flags: <tool-call-as-text? stopped-before-tool-call? claimed-done? claimed-done-no-change?>

## External verification (Claude)
- How verified: <build / test / diff / rendered output>
- Verdict: <pass | fail>, evidence: <…>

## Corrective rounds
- Round 1: added grounding <…> → <result>

## Notes / lessons (grounding for next time)
- <what grounding helped; which failure mode appeared>
​```
```

- [ ] **Step 2: Update `README.md`**

Replace the status blockquote (lines 8-9) and the closing parenthetical (line 73) so the repo no longer says "no code yet." Add after the "What it is" section:

````markdown
## Usage

```bash
# one shot: give ornith a goal + grounding, capture the run
orn run "Create scripts/hello.sh that prints hi; make it executable" \
  --workdir /path/to/target-repo --label hello-script

# from a prompt file, comparing a larger tools-capable model
orn run --prompt-file prompt.md --model qwen3.6-35b-a3b-64k --label compare-qwen
```

`orn run` invokes pi (`--thinking off --mode json` against the local Ollama provider),
enforces a timeout, writes a run record + raw event log under `runs/` (gitignored), and
prints an observability summary: exit reason, ornith's self-built tool sequence, thinking
count, and failure-mode flags. Run `orn --help` for all options.

**Requirements at runtime:** `pi` on `PATH`, Ollama running with the model pulled, and the
`ollama` provider registered in `~/.pi/agent/models.json`.

**Tests:** `npm test` (uses `node --test`; zero dependencies).
````

- [ ] **Step 3: Update `CHANGELOG.md`**

Under `## [Unreleased]`, add above the existing design entry:
```markdown
### Added
- `orn` CLI: invokes pi against the local Ollama provider with the empirically-required
  defaults (`--thinking off`, `--mode json`), a Node kill-timer timeout, and env
  passthrough; parses pi's JSONL event stream into an observability summary (self-built
  tool sequence, thinking-block count, final text) with heuristic failure-mode flags
  (tool-call-as-text, stopped-before-tool-call, claimed-done, claimed-done-no-change) and
  an optional git workdir snapshot. Writes a `schemaVersion: 1` run record + raw log under
  `runs/`.
- Experiment journal format (`journal/README.md`): self-contained per-run Markdown entries.
```

- [ ] **Step 4: Update `docs/DESIGN.md` Open items**

Replace the "Open items" section body with a short "Resolved (see plan)" note recording the three decisions (per-run self-contained journal files; run-record `schemaVersion: 1`; optional `--workdir` git snapshot). Keep it to ~4 lines; the plan is the detail.

- [ ] **Step 5: Verify docs build/read sanely**

Run: `node --test` (ensure nothing broke) and re-read the three edited files.
Expected: tests PASS; docs no longer claim "no code yet."

- [ ] **Step 6: Commit**

```bash
git add journal/README.md README.md CHANGELOG.md docs/DESIGN.md
git commit -m "docs: journal format, orn usage, changelog, resolve DESIGN open items"
```

---

### Task 10: `ornith-loop` Claude Code skill + installer

**Files:**
- Create: `skill/ornith-loop/SKILL.md`
- Create: `scripts/install-skill.sh`
- Modify: `README.md` (add a short "Skill" subsection under Usage)

**Interfaces:**
- Consumes: the `orn` CLI (Task 8) and journal format (Task 9).
- Produces: an installable skill encoding the method.

- [ ] **Step 1: Create `skill/ornith-loop/SKILL.md`**

```markdown
---
name: ornith-loop
description: Use when driving a self-scaffolding local model (ornith 1.0 first) under the pi harness via the `orn` CLI — gather grounding, author a MINIMAL-scaffold prompt, run, verify externally, loop with more grounding (not scaffold), and journal. Use for "run this task on ornith", "have the local model do X", or comparing local models under pi.
---

# ornith-loop

Drive a self-scaffolding local model with the `orn` CLI. **The one rule: do not steal
ornith's nest.** Supply *grounding* (facts it can't derive) and *verification*; never
supply *reasoning scaffold* (plans, step-by-step micro-tasks, tool sequences).

## Distinguish three kinds of help
- **Reasoning scaffold** (plan, sequence, recovery) → ornith's job. NEVER provide it.
- **Grounding** (real paths, versions, routes, selectors, conventions) → you provide it.
- **Verification & observability** → your job.

## Method (follow in order)

1. **Grounding recon.** Explore the target repo for the facts ornith cannot know: exact
   paths, framework versions, routes/endpoints, selectors, naming conventions, the build/
   test command. Do NOT design the solution.
2. **Author a minimal-scaffold prompt.** Give the *goal* + the *grounding*, then stop.
   No numbered steps, no "first do X then Y", no tool-call sequence. Prefer tasks that are
   **write-from-scratch or additive** — ornith corrupts in-place edits (token-level
   dropped/added spaces, wrong casing).
3. **Run via `orn`:**
   `orn run "<goal + grounding>" --workdir <target-repo> --label <short-name>`
   (defaults: model `ornith-1.0-9b-64k`, `--thinking off`, 900s timeout). Use
   `--prompt-file` for long prompts. Read the printed summary and the `runs/<id>.json`.
4. **Verify externally — always.** Never trust ornith's self-report; it confabulates
   success. Run the build/tests, inspect the diff, render output. Cross-check the summary
   flags: `claimed-done-no-change` = it said done but the workdir is untouched;
   `tool-call-as-text` = its call leaked into the reasoning channel (a `--thinking off`
   regression); `stopped-before-tool-call` = it stalled before acting.
5. **Corrective round (bounded, default 3).** Add *grounding* the run revealed was missing
   — never scaffold. If it stalls narrating "now I'll do X", the task is likely too big:
   shrink the goal, keep it additive. After N rounds still failing, STOP and report the
   failure mode rather than spoon-feeding steps.
6. **Journal.** Write `journal/YYYY-MM-DD-<label>.md` using the template in
   `journal/README.md`, embedding the run summary and your verification verdict.

## Guardrails (grounding you always carry)
- `--thinking off` is required; thinking-on leaks tool calls as text.
- Prefer write-from-scratch / additive edits; verify diffs on any edit.
- Keep tasks short — ornith stalls before the last step.
```

- [ ] **Step 2: Create `scripts/install-skill.sh`**

```bash
#!/usr/bin/env bash
# Install the ornith-loop skill into ~/.claude/skills via symlink (copy fallback).
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
src="$repo_root/skill/ornith-loop"
dest_dir="${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}"
dest="$dest_dir/ornith-loop"

[ -d "$src" ] || { echo "error: $src not found" >&2; exit 1; }
mkdir -p "$dest_dir"
rm -rf "$dest"
if ln -s "$src" "$dest" 2>/dev/null; then
  echo "symlinked $dest -> $src"
else
  cp -R "$src" "$dest"
  echo "copied $src -> $dest"
fi
```

- [ ] **Step 3: Verify the installer (dry target) and skill frontmatter**

Run:
```bash
chmod +x scripts/install-skill.sh
CLAUDE_SKILLS_DIR="$(mktemp -d)" bash -c 'scripts/install-skill.sh && ls -l "$0/ornith-loop" && head -3 "$0/ornith-loop/SKILL.md"' "$CLAUDE_SKILLS_DIR"
```
Expected: prints a symlink to `skill/ornith-loop` and the SKILL.md frontmatter (`--- / name: ornith-loop`).

- [ ] **Step 4: Add a "Skill" subsection to `README.md`**

Under Usage, add:
```markdown
### Skill

Install the `ornith-loop` Claude Code skill (usable from any project):

```bash
scripts/install-skill.sh   # symlinks skill/ornith-loop -> ~/.claude/skills/ornith-loop
```

It encodes the method: grounding recon → minimal-scaffold prompt → `orn` run → external
verification → bounded corrective loop (default 3) → journal.
```

- [ ] **Step 5: Commit**

```bash
git add skill/ornith-loop/SKILL.md scripts/install-skill.sh README.md
git commit -m "feat(skill): ornith-loop skill encoding the method + install script"
```

---

## Verification (end-to-end)

1. **Unit + integration suite (no model needed):** `npm test` → every `test/*.test.js`
   passes, including `test/cli.test.js` which drives `bin/orn.js` against the `fake-pi`
   stub for success, crash, and timeout paths.
2. **Real smoke run against Ollama** (ornith is pulled and the `ollama` provider is in
   `~/.pi/agent/models.json` — both verified present):
   ```bash
   mkdir -p /tmp/orn-smoke && (cd /tmp/orn-smoke && git init -q)
   ./bin/orn.js run "Create hello.txt containing the single line: hi from ornith" \
     --workdir /tmp/orn-smoke --label smoke --timeout 300
   ```
   Confirm: a summary prints with a real tool sequence; `runs/<id>.json` + `.jsonl` exist;
   then externally verify `cat /tmp/orn-smoke/hello.txt` — do NOT trust the summary's
   `claimed-done`. If `tool-call-as-text` fires, confirm `--thinking off` was honored.
3. **Skill install:** `scripts/install-skill.sh`, then in a Claude Code session confirm the
   `ornith-loop` skill is discoverable and its steps reference `orn run`.
4. **Journal loop:** After the smoke run, hand-write `journal/2026-07-07-smoke.md` from the
   template to confirm the format captures everything the summary provides.

## Notes for the implementer
- **TDD throughout:** every code task writes the failing test first. The parser, flags,
  args, record, and summary modules are pure — test them without spawning pi.
- **Never add a dependency.** If you reach for one, reconsider — `node:*` builtins cover
  everything here.
- **`orn` reports; it does not judge.** Keep correctness verdicts out of the CLI; they live
  in the skill / external verification.
- **Schema is versioned** (`schemaVersion: 1`) so the journal and any later tooling can
  detect format changes.
