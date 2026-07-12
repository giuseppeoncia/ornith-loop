# Configurable Local Verifier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Layer-1 local verifier configurable and its use mechanical + discoverable — a persisted config, an `orn config` setter, a mechanized `orn verify`, install-time discoverability, and config-driven skill steps — without changing the executor path or the presidia.

**Architecture:** A new user-level JSON config (`~/.config/ornith-loop/config.json`) read by both the `orn` CLI and the skill. New `orn config` (get/set/path) and `orn verify` commands; `orn verify` reuses `src/verifier.js` (`buildEvidencePacket`/`parseVerdict`) over evidence gathered by a new shared `src/evidence.js` (extracted from `bench.mjs`). `install-skill` writes a default config and prints a discoverable pointer. Default verifier is OFF → Claude verifies inline (today's behavior).

**Tech Stack:** Node ≥ 24 ESM, zero dependencies, `node --test`. Existing modules: `src/args.js` (arg parsing), `bin/orn.js` (dispatch), `src/invoke.js` (`invokePi`), `src/parse.js` (`parseEventStream`/`summarizeEvents`), `src/verifier.js`, `src/install.js`.

## Global Constraints

- **Node ≥ 24**, ESM only, **zero dependencies**; test with `node --test`.
- **Config location:** `~/.config/ornith-loop/config.json`; honor `XDG_CONFIG_HOME` when set, else `~/.config`. All config functions take `(env, home)` params so tests never touch the real HOME.
- **Config schema + defaults (verbatim):** `{ "executor": { "model": "ornith-1.0-9b-64k" }, "verifier": { "enabled": false, "model": "qwen3.5:4b" }, "correctiveRounds": 3 }`. Missing file/keys → these defaults; reading never throws on a fresh machine.
- **Known keys (closed set the setter accepts):** `executor.model` (non-empty string), `verifier.enabled` (boolean), `verifier.model` (non-empty string), `correctiveRounds` (positive integer).
- **Presidia:** Layer-0 mechanical checks stay the anchor; `orn verify` never receives a gold label; default `verifier.enabled: false` = Claude-inline verify (no behavior change for non-opt-in users).
- `--test-cmd "<cmd>"` is whitespace-split into argv and run with **no shell**.
- **Exit codes for `orn verify`:** verdict produced → exit 0 (verdict on stdout); verifier not configured and no `--model` → exit 3 with guidance; operational/usage error → exit 2.
- Changelog follows Keep a Changelog; add an `[Unreleased]` entry.

---

### Task 1: `src/config.js` — config model + IO

**Files:**
- Create: `src/config.js`
- Test: `test/config.test.js`

**Interfaces:**
- Produces:
  - `defaultConfig(): {executor:{model}, verifier:{enabled,model}, correctiveRounds}`
  - `KNOWN_KEYS: Record<string,{kind:"string"|"boolean"|"posint"}>`
  - `configPath(env?, home?): string`
  - `loadConfig(env?, home?, warn?): config` (merge file over defaults; malformed → defaults + warn)
  - `setConfigKey(key, rawValue, env?, home?): {config, path} | {error}`
  - `getConfigKey(cfg, key): value`

- [ ] **Step 1: Write the failing tests** — create `test/config.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig, KNOWN_KEYS, configPath, loadConfig, setConfigKey, getConfigKey } from "../src/config.js";

test("defaultConfig: verifier off by default, expected shape", () => {
  const c = defaultConfig();
  assert.equal(c.executor.model, "ornith-1.0-9b-64k");
  assert.equal(c.verifier.enabled, false);
  assert.equal(c.verifier.model, "qwen3.5:4b");
  assert.equal(c.correctiveRounds, 3);
});

test("KNOWN_KEYS is the closed set", () => {
  assert.deepEqual(Object.keys(KNOWN_KEYS).sort(), ["correctiveRounds", "executor.model", "verifier.enabled", "verifier.model"]);
});

test("configPath honors XDG_CONFIG_HOME, else ~/.config", () => {
  assert.equal(configPath({ XDG_CONFIG_HOME: "/x" }, "/home/u"), "/x/ornith-loop/config.json");
  assert.equal(configPath({}, "/home/u"), "/home/u/.config/ornith-loop/config.json");
});

test("loadConfig: missing file -> defaults", () => {
  const c = loadConfig({ XDG_CONFIG_HOME: "/nonexistent-xdg-abc" }, "/home/u");
  assert.deepEqual(c, defaultConfig());
});

test("setConfigKey then loadConfig round-trips known keys; unknown key errors", async () => {
  const dir = await mkdtemp(join(tmpdir(), "orn-cfg-"));
  try {
    const env = { XDG_CONFIG_HOME: dir };
    assert.equal(setConfigKey("verifier.enabled", "true", env, "/home/u").config.verifier.enabled, true);
    setConfigKey("verifier.model", "gemma3:4b", env, "/home/u");
    setConfigKey("correctiveRounds", "5", env, "/home/u");
    const c = loadConfig(env, "/home/u");
    assert.equal(c.verifier.enabled, true);
    assert.equal(c.verifier.model, "gemma3:4b");
    assert.equal(c.correctiveRounds, 5);
    assert.equal(c.executor.model, "ornith-1.0-9b-64k"); // untouched key preserved
    assert.match(setConfigKey("bogus.key", "x", env, "/home/u").error, /unknown key/);
    assert.match(setConfigKey("verifier.enabled", "yes", env, "/home/u").error, /true.*false/);
    assert.match(setConfigKey("correctiveRounds", "0", env, "/home/u").error, /positive integer/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadConfig: malformed file -> defaults + warning", async () => {
  const dir = await mkdtemp(join(tmpdir(), "orn-cfg-"));
  try {
    await mkdir(join(dir, "ornith-loop"), { recursive: true });
    await writeFile(join(dir, "ornith-loop", "config.json"), "{not json");
    let warned = "";
    const c = loadConfig({ XDG_CONFIG_HOME: dir }, "/home/u", (m) => (warned = m));
    assert.deepEqual(c, defaultConfig());
    assert.match(warned, /malformed/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("getConfigKey reads dotted and top-level keys", () => {
  const c = defaultConfig();
  assert.equal(getConfigKey(c, "verifier.model"), "qwen3.5:4b");
  assert.equal(getConfigKey(c, "correctiveRounds"), 3);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/config.test.js`
Expected: FAIL — cannot find module `../src/config.js`.

- [ ] **Step 3: Implement `src/config.js`**

```js
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

export function defaultConfig() {
  return {
    executor: { model: "ornith-1.0-9b-64k" },
    verifier: { enabled: false, model: "qwen3.5:4b" },
    correctiveRounds: 3,
  };
}

// The closed set of dotted keys `orn config set` accepts, with each key's kind.
export const KNOWN_KEYS = {
  "executor.model": { kind: "string" },
  "verifier.enabled": { kind: "boolean" },
  "verifier.model": { kind: "string" },
  "correctiveRounds": { kind: "posint" },
};

export function configPath(env = process.env, home = homedir()) {
  const xdg = env.XDG_CONFIG_HOME && env.XDG_CONFIG_HOME.trim() ? env.XDG_CONFIG_HOME : join(home, ".config");
  return join(xdg, "ornith-loop", "config.json");
}

// Merge the persisted file over defaults, key by key (so an unknown/garbage key
// in the file can never poison the config). Malformed JSON -> defaults + warn.
export function loadConfig(env = process.env, home = homedir(), warn = (m) => process.stderr.write(m + "\n")) {
  const path = configPath(env, home);
  const cfg = defaultConfig();
  if (!existsSync(path)) return cfg;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    if (raw && typeof raw === "object") {
      if (raw.executor && typeof raw.executor.model === "string") cfg.executor.model = raw.executor.model;
      if (raw.verifier && typeof raw.verifier === "object") {
        if (typeof raw.verifier.enabled === "boolean") cfg.verifier.enabled = raw.verifier.enabled;
        if (typeof raw.verifier.model === "string") cfg.verifier.model = raw.verifier.model;
      }
      if (Number.isInteger(raw.correctiveRounds) && raw.correctiveRounds > 0) cfg.correctiveRounds = raw.correctiveRounds;
    }
  } catch {
    warn(`orn: ignoring malformed config at ${path} (using defaults)`);
  }
  return cfg;
}

function coerce(key, value) {
  const spec = KNOWN_KEYS[key];
  if (!spec) return { error: `unknown key '${key}': one of ${Object.keys(KNOWN_KEYS).join(", ")}` };
  if (spec.kind === "string") {
    if (value == null || !String(value).trim()) return { error: `${key} must be a non-empty string` };
    return { value: String(value) };
  }
  if (spec.kind === "boolean") {
    if (value === "true") return { value: true };
    if (value === "false") return { value: false };
    return { error: `${key} must be 'true' or 'false'` };
  }
  // posint
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return { error: `${key} must be a positive integer` };
  return { value: n };
}

// Set one known key without clobbering the others: load current (file or
// defaults), apply, write pretty JSON. Returns { config, path } or { error }.
export function setConfigKey(key, rawValue, env = process.env, home = homedir()) {
  const c = coerce(key, rawValue);
  if (c.error) return { error: c.error };
  const path = configPath(env, home);
  const cfg = loadConfig(env, home, () => {});
  const [a, b] = key.split(".");
  if (b) { cfg[a] = cfg[a] || {}; cfg[a][b] = c.value; } else { cfg[a] = c.value; }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(cfg, null, 2) + "\n");
  return { config: cfg, path };
}

export function getConfigKey(cfg, key) {
  const [a, b] = key.split(".");
  return b ? cfg?.[a]?.[b] : cfg?.[a];
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --test test/config.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/config.js test/config.test.js
git commit -m "feat(config): user-level config model (~/.config/ornith-loop/config.json)"
```

---

### Task 2: `src/evidence.js` — extract `gatherEvidence`

**Files:**
- Create: `src/evidence.js`
- Modify: `benchmarks/bench.mjs` (remove inline `gatherEvidence`; import + adapt 2 call sites)
- Test: `test/evidence.test.js`

**Interfaces:**
- Produces: `gatherEvidence(workdir, testCmdArgv): {testCmd, testOutput, testExitCode, diff, changedFiles}` — `testCmdArgv` is `[cmd, ...args]`; defaults to `["node","--test"]` when falsy/empty.
- Consumed by: `benchmarks/bench.mjs` (`cmdRun`, `cmdOrchestrate`) and Task 4 (`orn verify`).

- [ ] **Step 1: Write the failing test** — create `test/evidence.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gatherEvidence } from "../src/evidence.js";

test("gatherEvidence: runs the test cmd and captures diff + changed files", async () => {
  const wd = await mkdtemp(join(tmpdir(), "orn-ev-"));
  try {
    const git = (a) => spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...a], { cwd: wd });
    git(["init", "-q"]); git(["commit", "-q", "--allow-empty", "-m", "base"]);
    await writeFile(join(wd, "note.txt"), "hi");
    const ev = gatherEvidence(wd, ["node", "--version"]);
    assert.equal(ev.testExitCode, 0);
    assert.match(ev.testOutput, /v\d+\./);
    assert.deepEqual(ev.testCmd, ["node", "--version"]);
    assert.ok(ev.changedFiles.includes("note.txt"));
    assert.match(ev.diff, /note\.txt/);
  } finally {
    await rm(wd, { recursive: true, force: true });
  }
});

test("gatherEvidence: empty argv falls back to node --test", async () => {
  const wd = await mkdtemp(join(tmpdir(), "orn-ev-"));
  try {
    const git = (a) => spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...a], { cwd: wd });
    git(["init", "-q"]); git(["commit", "-q", "--allow-empty", "-m", "base"]);
    const ev = gatherEvidence(wd, null);
    assert.deepEqual(ev.testCmd, ["node", "--test"]);
  } finally {
    await rm(wd, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run to verify it fails** — `node --test test/evidence.test.js` → cannot find `../src/evidence.js`.

- [ ] **Step 3: Create `src/evidence.js`** (lifted verbatim from `bench.mjs`'s current `gatherEvidence`, generalized to take `(workdir, testCmdArgv)`):

```js
import { spawnSync } from "node:child_process";

// Gather the MECHANICAL evidence a verifier adjudicates: test output, the diff,
// and the changed-file list — all ground truth, never the model's prose. Stages
// the index (git add -A) so the diff includes untracked files; consequently
// callers/oracles must read the change set from `git status --porcelain`, not an
// unstaged `git diff`.
export function gatherEvidence(workdir, testCmdArgv) {
  const argv = Array.isArray(testCmdArgv) && testCmdArgv.length ? testCmdArgv : ["node", "--test"];
  const t = spawnSync(argv[0], argv.slice(1), { cwd: workdir, encoding: "utf8" });
  const testOutput = ((t.stdout || "") + (t.stderr || "")).slice(0, 4000);
  const git = (args) => spawnSync("git", args, { cwd: workdir, encoding: "utf8" });
  git(["add", "-A"]);
  const diff = (git(["diff", "--cached"]).stdout || "").slice(0, 8000);
  const status = git(["status", "--porcelain"]).stdout || "";
  const changedFiles = status.split("\n").map((l) => l.slice(3).trim()).filter(Boolean);
  return { testCmd: argv, testOutput, testExitCode: t.status, diff, changedFiles };
}
```

- [ ] **Step 4: Refactor `benchmarks/bench.mjs` to use it**

Remove the inline `function gatherEvidence(task, wd) { ... }` (the block whose doc comment starts "Gather the MECHANICAL evidence a verifier adjudicates"). Add to the import block near the top:

```js
import { gatherEvidence } from "../src/evidence.js";
```

Update the two call sites (both currently `gatherEvidence(t, wd)`):
- in `cmdRun`: `const ev = verifierModel || saveCorpus ? gatherEvidence(wd, t.meta.testCmd) : null;`
- in `cmdOrchestrate`: `const ev = gatherEvidence(wd, t.meta.testCmd);`

- [ ] **Step 5: Run the covering tests** — `node --test test/evidence.test.js test/bench.test.js test/corpus.test.js test/orchestrate.test.js`
Expected: PASS (bench/corpus/orchestrate must stay green — the extraction is behavior-preserving).

- [ ] **Step 6: Commit**

```bash
git add src/evidence.js test/evidence.test.js benchmarks/bench.mjs
git commit -m "refactor(evidence): extract gatherEvidence to src/evidence.js (shared by bench + orn verify)"
```

---

### Task 3: `orn config` command

**Files:**
- Modify: `src/args.js` (add `parseConfig`, wire into `parseArgs`, extend `HELP`)
- Modify: `bin/orn.js` (dispatch `config`)
- Test: `test/args.test.js` (parse), `test/cli.test.js` (subprocess round-trip)

**Interfaces:**
- Consumes: `loadConfig`, `configPath`, `setConfigKey`, `getConfigKey` (Task 1).
- Produces: `parseArgs(["config", ...])` → `{options:{command:"config", action:"get"|"set"|"path", key?, value?}}`.

- [ ] **Step 1: Write the failing parse tests** — append to `test/args.test.js`:

```js
test("config: get/set/path parse", () => {
  assert.deepEqual(parseArgs(["config", "path"]).options, { command: "config", action: "path" });
  assert.deepEqual(parseArgs(["config", "get", "verifier.model"]).options, { command: "config", action: "get", key: "verifier.model" });
  assert.deepEqual(parseArgs(["config", "get"]).options, { command: "config", action: "get", key: null });
  assert.deepEqual(parseArgs(["config", "set", "verifier.enabled", "true"]).options, { command: "config", action: "set", key: "verifier.enabled", value: "true" });
  assert.match(parseArgs(["config", "set", "onlykey"]).error, /needs <key> <value>/);
  assert.match(parseArgs(["config", "bogus"]).error, /get.*set.*path/);
});
```

- [ ] **Step 2: Run to verify it fails** — `node --test test/args.test.js` → the config assertions fail (`parseArgs` returns `unknown command`).

- [ ] **Step 3: Implement `parseConfig` and wire it in `src/args.js`**

In `parseArgs`, add after the `install-skill` line:

```js
  if (command === "config") return parseConfig(argv.slice(1));
```

Add the function (near `parseInstall`):

```js
function parseConfig(args) {
  const sub = args[0];
  if (sub === "-h" || sub === "--help") return { help: true };
  if (sub === "path") return { options: { command: "config", action: "path" } };
  if (sub === "get") return { options: { command: "config", action: "get", key: args[1] ?? null } };
  if (sub === "set") {
    if (args.length < 3) return { error: "config set needs <key> <value>" };
    return { options: { command: "config", action: "set", key: args[1], value: args[2] } };
  }
  return { error: "config: expected 'get', 'set', or 'path'" };
}
```

Extend the `HELP` string's Commands list with:

```
  config <get|set|path>   read/write ~/.config/ornith-loop/config.json (verifier, executor, rounds)
```

- [ ] **Step 4: Dispatch in `bin/orn.js`**

Add the import:

```js
import { loadConfig, configPath, setConfigKey, getConfigKey } from "../src/config.js";
```

Add this block before the `// options.command === "run"` comment (after the install-skill block):

```js
if (options.command === "config") {
  if (options.action === "path") {
    process.stdout.write(configPath() + "\n");
    process.exit(0);
  }
  if (options.action === "get") {
    const cfg = loadConfig();
    if (options.key) {
      const v = getConfigKey(cfg, options.key);
      process.stdout.write((v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v)) + "\n");
    } else {
      process.stdout.write(JSON.stringify(cfg, null, 2) + "\n");
    }
    process.exit(0);
  }
  const res = setConfigKey(options.key, options.value);
  if (res.error) {
    process.stderr.write(`orn: ${res.error}\n`);
    process.exit(2);
  }
  process.stdout.write(`set ${options.key} = ${options.value}  (${res.path})\n`);
  process.exit(0);
}
```

- [ ] **Step 5: Write the failing CLI round-trip test** — append to `test/cli.test.js`:

```js
test("orn config: set then get round-trips via XDG_CONFIG_HOME", async () => {
  const cfgHome = await mkdtemp(join(tmpdir(), "orn-cfg-"));
  try {
    const env = { ...process.env, XDG_CONFIG_HOME: cfgHome };
    await pexec(process.execPath, [orn, "config", "set", "verifier.model", "gemma3:4b"], { env });
    const { stdout } = await pexec(process.execPath, [orn, "config", "get", "verifier.model"], { env });
    assert.match(stdout, /gemma3:4b/);
    const path = await pexec(process.execPath, [orn, "config", "path"], { env });
    assert.match(path.stdout, /ornith-loop\/config\.json/);
  } finally {
    await rm(cfgHome, { recursive: true, force: true });
  }
});
```

- [ ] **Step 6: Run covering tests** — `node --test test/args.test.js test/cli.test.js` → PASS.

- [ ] **Step 7: Commit**

```bash
git add src/args.js bin/orn.js test/args.test.js test/cli.test.js
git commit -m "feat(cli): orn config get/set/path"
```

---

### Task 4: `orn verify` command

**Files:**
- Create: `src/verify.js`
- Modify: `src/args.js` (`parseVerify` + wire + HELP), `bin/orn.js` (dispatch `verify`)
- Test: `test/args.test.js` (parse), `test/cli.test.js` (dry-run via fake-pi + not-configured path)

**Interfaces:**
- Consumes: `loadConfig` (Task 1), `gatherEvidence` (Task 2), `buildEvidencePacket`/`parseVerdict` (`src/verifier.js`), `invokePi` (`src/invoke.js`), `parseEventStream`/`summarizeEvents` (`src/parse.js`).
- Produces: `runVerify(options, {config?}): Promise<{notConfigured:true} | {verdict:{verdict,evidence,reason}}>`; parse shape `{options:{command:"verify", workdir, testCmd, model?, goalFile?, groundingFile?}}`.

- [ ] **Step 1: Write the failing parse tests** — append to `test/args.test.js`:

```js
test("verify: required workdir + test-cmd, optional model/goal/grounding", () => {
  const { options } = parseArgs(["verify", "--workdir", "/r", "--test-cmd", "node --test", "--model", "qwen3.5:4b"]);
  assert.equal(options.command, "verify");
  assert.equal(options.workdir, "/r");
  assert.equal(options.testCmd, "node --test");
  assert.equal(options.model, "qwen3.5:4b");
  assert.match(parseArgs(["verify", "--test-cmd", "node --test"]).error, /workdir/);
  assert.match(parseArgs(["verify", "--workdir", "/r"]).error, /test-cmd/);
});
```

- [ ] **Step 2: Run to verify it fails** — `node --test test/args.test.js` → verify assertions fail.

- [ ] **Step 3: Implement `parseVerify` and wire it in `src/args.js`**

In `parseArgs`, add:

```js
  if (command === "verify") return parseVerify(argv.slice(1));
```

Add the function:

```js
function parseVerify(args) {
  const opts = { command: "verify", workdir: null, testCmd: null, model: null, goalFile: null, groundingFile: null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const next = () => args[++i];
    switch (a) {
      case "-h": case "--help": return { help: true };
      case "--workdir": opts.workdir = next(); break;
      case "--test-cmd": opts.testCmd = next(); break;
      case "--model": opts.model = next(); break;
      case "--goal-file": opts.goalFile = next(); break;
      case "--grounding-file": opts.groundingFile = next(); break;
      default: return { error: `unexpected argument '${a}'` };
    }
  }
  if (!opts.workdir) return { error: "verify: --workdir <repo> required" };
  if (!opts.testCmd || !opts.testCmd.trim()) return { error: "verify: --test-cmd \"<cmd>\" required" };
  return { options: opts };
}
```

Extend `HELP` Commands with:

```
  verify                  run the configured local verifier over a workdir (prints pass|fail|uncertain)
```

and an `orn verify` options block:

```
orn verify [options]
  --workdir <repo>       repo to verify (required)
  --test-cmd "<cmd>"     test command, whitespace-split, no shell (required)
  --model <id>           verifier model (default: config verifier.model when enabled)
  --goal-file <path>     goal text to include in the evidence packet (optional)
  --grounding-file <p>   grounding text to include (optional)
```

- [ ] **Step 4: Create `src/verify.js`**

```js
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { gatherEvidence } from "./evidence.js";
import { buildEvidencePacket, parseVerdict } from "./verifier.js";
import { invokePi } from "./invoke.js";
import { parseEventStream, summarizeEvents } from "./parse.js";

const RUBRIC_PATH = fileURLToPath(new URL("../verifier/rubric.md", import.meta.url));

// Run the Layer-1 verifier over a workdir, read-only. Resolves the model from
// --model or (when enabled) config.verifier.model; returns { notConfigured:true }
// when neither is available (the caller prints guidance). Never sees a gold label.
export async function runVerify(options, { config = loadConfig(), env = process.env } = {}) {
  const model = options.model || (config.verifier.enabled ? config.verifier.model : null);
  if (!model) return { notConfigured: true };

  const testArgv = options.testCmd.trim().split(/\s+/);
  const ev = gatherEvidence(options.workdir, testArgv);
  const goal = options.goalFile ? readFileSync(options.goalFile, "utf8") : "";
  const grounding = options.groundingFile ? readFileSync(options.groundingFile, "utf8") : "";
  const packet = buildEvidencePacket({
    goal, grounding,
    testCmd: ev.testCmd, testOutput: ev.testOutput, testExitCode: ev.testExitCode,
    changedFiles: ev.changedFiles, diff: ev.diff,
  });
  const prompt = `${readFileSync(RUBRIC_PATH, "utf8")}\n\n---\n\n# EVIDENCE PACKET\n\n${packet}`;

  const inv = await invokePi({
    prompt, model, provider: "ollama", thinking: "off",
    label: "verify", timeoutSec: 900, piBin: env.ORN_PI_BIN || "pi", noTools: true,
  });
  const { events } = parseEventStream(inv.stdout);
  const { finalText } = summarizeEvents(events);
  return { verdict: parseVerdict(finalText) };
}
```

- [ ] **Step 5: Dispatch in `bin/orn.js`**

Add the import:

```js
import { runVerify } from "../src/verify.js";
```

Add this block after the `config` block (before `// options.command === "run"`):

```js
if (options.command === "verify") {
  const result = await runVerify(options);
  if (result.notConfigured) {
    process.stderr.write(
      "orn verify: no local verifier configured — Claude verifies inline.\n" +
        "Enable one: orn config set verifier.enabled true && orn config set verifier.model <id>\n"
    );
    process.exit(3);
  }
  process.stdout.write(`${result.verdict.verdict}\n${result.verdict.reason}\n`);
  process.exit(0);
}
```

- [ ] **Step 6: Write the failing CLI tests** — append to `test/cli.test.js` (reuses the `fakePi` const already defined at the top):

```js
test("orn verify: not configured -> exit 3 with guidance", async () => {
  const cfgHome = await mkdtemp(join(tmpdir(), "orn-cfg-"));
  const wd = await mkdtemp(join(tmpdir(), "orn-wd-"));
  try {
    await assert.rejects(
      pexec(process.execPath, [orn, "verify", "--workdir", wd, "--test-cmd", "node --version"], {
        env: { ...process.env, XDG_CONFIG_HOME: cfgHome, ORN_PI_BIN: fakePi },
      }),
      (err) => err.code === 3 && /enable/i.test(err.stderr)
    );
  } finally {
    await rm(cfgHome, { recursive: true, force: true });
    await rm(wd, { recursive: true, force: true });
  }
});

test("orn verify: dry-run via fake-pi prints the stubbed verdict", async () => {
  const cfgHome = await mkdtemp(join(tmpdir(), "orn-cfg-"));
  const wd = await mkdtemp(join(tmpdir(), "orn-wd-"));
  try {
    const { spawnSync } = await import("node:child_process");
    const git = (a) => spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...a], { cwd: wd });
    git(["init", "-q"]); git(["commit", "-q", "--allow-empty", "-m", "base"]);
    const env = { ...process.env, XDG_CONFIG_HOME: cfgHome, ORN_PI_BIN: fakePi, FAKE_PI_VERDICT: "pass" };
    await pexec(process.execPath, [orn, "config", "set", "verifier.enabled", "true"], { env });
    const { stdout } = await pexec(process.execPath, [orn, "verify", "--workdir", wd, "--test-cmd", "node --version"], { env });
    assert.match(stdout, /^pass/);
  } finally {
    await rm(cfgHome, { recursive: true, force: true });
    await rm(wd, { recursive: true, force: true });
  }
});
```

- [ ] **Step 7: Run covering tests** — `node --test test/args.test.js test/cli.test.js` → PASS.

- [ ] **Step 8: Commit**

```bash
git add src/verify.js src/args.js bin/orn.js test/args.test.js test/cli.test.js
git commit -m "feat(cli): orn verify — mechanized Layer-1 verify over a workdir"
```

---

### Task 5: config-driven executor model + orchestrate rounds default

**Files:**
- Modify: `src/args.js` (`parseRun` tracks `modelExplicit`)
- Modify: `bin/orn.js` (resolve `config.executor.model` when not explicit)
- Modify: `benchmarks/bench.mjs` (`orchestrate --rounds` defaults from `config.correctiveRounds`)
- Test: `test/args.test.js`

**Interfaces:**
- Consumes: `loadConfig` (Task 1).
- Produces: `parseRun` sets `options.modelExplicit` (false unless `--model` given).

- [ ] **Step 1: Write the failing test** — append to `test/args.test.js`:

```js
test("run: modelExplicit is false by default, true when --model given", () => {
  assert.equal(parseArgs(["run", "hi"]).options.modelExplicit, false);
  assert.equal(parseArgs(["run", "hi", "--model", "x"]).options.modelExplicit, true);
});
```

- [ ] **Step 2: Run to verify it fails** — `node --test test/args.test.js` → `modelExplicit` is undefined.

- [ ] **Step 3: Track `modelExplicit` in `parseRun`**

In `parseRun`, add `modelExplicit: false,` to the `opts` object (next to `model`), and in the `case "--model"` set it: `case "--model": opts.model = next(); opts.modelExplicit = true; break;`.

- [ ] **Step 4: Resolve config in `bin/orn.js`**

In the run path (after the `--prompt-file` handling, before `const timestamp`), add:

```js
if (!options.modelExplicit) options.model = loadConfig().executor.model;
```

(`loadConfig` is already imported by Task 3. `config.executor.model` defaults to `ornith-1.0-9b-64k`, so a machine with no config is unchanged.)

- [ ] **Step 5: Default `orchestrate --rounds` from config in `benchmarks/bench.mjs`**

Add to the bench import block: `import { loadConfig } from "../src/config.js";`. In `cmdOrchestrate`, replace `const maxRounds = Number(o.rounds || 3);` with:

```js
  const maxRounds = o.rounds !== undefined && o.rounds !== true ? Number(o.rounds) : loadConfig().correctiveRounds;
```

(keep the existing `if (!Number.isInteger(maxRounds) || maxRounds < 1) die("--rounds must be an integer >= 1");` guard on the next line.)

- [ ] **Step 6: Run covering tests** — `node --test test/args.test.js test/cli.test.js test/orchestrate.test.js` → PASS (the orchestrate dry-run test passes `--rounds` implicitly via default; `config.correctiveRounds` default 3 keeps behavior).

- [ ] **Step 7: Commit**

```bash
git add src/args.js bin/orn.js benchmarks/bench.mjs test/args.test.js
git commit -m "feat(config): orn run + orchestrate honor config (executor.model, correctiveRounds)"
```

---

### Task 6: install-time discoverability + `--verifier`

**Files:**
- Modify: `src/install.js` (add `ensureDefaultConfig`, `discoveryMessage`)
- Modify: `src/args.js` (`parseInstall` accepts `--verifier <model>`)
- Modify: `bin/orn.js` (install path: `--verifier` one-shot, else ensure default; print message + detected ollama models)
- Test: `test/install.test.js` (pure helpers), `test/cli.test.js` (install writes config + prints pointer)

**Interfaces:**
- Consumes: `setConfigKey`, `loadConfig`, `configPath`, `defaultConfig` (Task 1).
- Produces: `ensureDefaultConfig(env, home): {created:boolean, path}`; `discoveryMessage(cfg, ollamaModels): string`; `parseInstall` → `options.verifier` (string|null).

- [ ] **Step 1: Write the failing tests** — append to `test/install.test.js`:

```js
import { ensureDefaultConfig, discoveryMessage } from "../src/install.js";
import { defaultConfig } from "../src/config.js";

test("ensureDefaultConfig writes defaults once, is idempotent", async () => {
  const dir = await mkdtemp(join(tmpdir(), "orn-inst-"));
  try {
    const env = { XDG_CONFIG_HOME: dir };
    const first = ensureDefaultConfig(env, "/home/u");
    assert.equal(first.created, true);
    assert.ok(existsSync(first.path));
    assert.equal(ensureDefaultConfig(env, "/home/u").created, false); // already there
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("discoveryMessage: names the enable command; lists detected models; omits list when none", () => {
  const on = discoveryMessage(defaultConfig(), ["qwen3.5:4b", "gemma3:4b"]);
  assert.match(on, /verifier.enabled true/);
  assert.match(on, /qwen3\.5:4b/);
  const none = discoveryMessage(defaultConfig(), []);
  assert.doesNotMatch(none, /Ollama models detected/);
});
```

And add `import { existsSync } from "node:fs";` to `test/install.test.js` if not already imported (it is).

- [ ] **Step 2: Run to verify it fails** — `node --test test/install.test.js` → missing exports.

- [ ] **Step 3: Implement the helpers in `src/install.js`**

Add imports at the top: `import { existsSync } from "node:fs";` (extend the existing `node:fs` import) and `import { defaultConfig, configPath } from "./config.js";` and `import { writeFileSync } from "node:fs";` (fold into the existing fs import list: `mkdirSync, rmSync, symlinkSync, cpSync, existsSync, writeFileSync`).

Add:

```js
// Write the default config if none exists yet. Idempotent.
export function ensureDefaultConfig(env, home) {
  const path = configPath(env, home);
  if (existsSync(path)) return { created: false, path };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(defaultConfig(), null, 2) + "\n");
  return { created: true, path };
}

// The install-time pointer that makes the optional local verifier discoverable.
export function discoveryMessage(cfg, ollamaModels) {
  const lines = [
    "",
    `Local verifier: ${cfg.verifier.enabled ? `ON (${cfg.verifier.model})` : "OFF (Claude verifies each run)"}.`,
    "Optional: offload the first verification pass to a local model —",
    "  orn config set verifier.enabled true",
    "  orn config set verifier.model <id>",
  ];
  if (Array.isArray(ollamaModels) && ollamaModels.length) {
    lines.push(`Ollama models detected: ${ollamaModels.join(", ")}`);
  }
  lines.push("See docs/VERIFIER.md for how to pick one (the metric is false-pass rate).");
  return lines.join("\n") + "\n";
}
```

Add `dirname` to the existing `node:path` import: `import { join, dirname } from "node:path";`.

- [ ] **Step 4: Accept `--verifier` in `parseInstall` (`src/args.js`)**

In `parseInstall`, add `opts.verifier = null;` to the initial `opts`, and a case: `case "--verifier": opts.verifier = next(); break;`.

- [ ] **Step 5: Wire the install path in `bin/orn.js`**

Add `import { detectHarnesses, resolveTargets, installSkill, ensureDefaultConfig, discoveryMessage } from "../src/install.js";` (extend the existing install import). Add `import { spawnSync } from "node:child_process";` if not present.

In the `install-skill` block, after the `for (const r of installSkill(...))` loop and before `process.exit(0)`, add:

```js
  if (options.verifier) {
    setConfigKey("verifier.enabled", "true");
    setConfigKey("verifier.model", options.verifier);
  } else {
    ensureDefaultConfig(process.env, homedir());
  }
  const cfg = loadConfig();
  let ollamaModels = [];
  try {
    const out = spawnSync("ollama", ["list"], { encoding: "utf8" });
    if (out.status === 0) {
      ollamaModels = (out.stdout || "").split("\n").slice(1).map((l) => l.split(/\s+/)[0]).filter(Boolean);
    }
  } catch { /* ollama absent — omit the list */ }
  process.stdout.write(discoveryMessage(cfg, ollamaModels));
```

- [ ] **Step 6: Write the failing CLI test** — append to `test/cli.test.js`:

```js
test("orn install-skill: writes a default config and prints the verifier pointer", async () => {
  const skills = await mkdtemp(join(tmpdir(), "orn-skills-"));
  const cfgHome = await mkdtemp(join(tmpdir(), "orn-cfg-"));
  try {
    const { stdout } = await pexec(process.execPath, [orn, "install-skill", "--target", "claude"], {
      env: { ...process.env, CLAUDE_SKILLS_DIR: skills, XDG_CONFIG_HOME: cfgHome },
    });
    assert.match(stdout, /Local verifier: OFF/);
    assert.match(stdout, /verifier\.enabled true/);
    const { stdout: got } = await pexec(process.execPath, [orn, "config", "get", "verifier.enabled"], {
      env: { ...process.env, XDG_CONFIG_HOME: cfgHome },
    });
    assert.match(got, /false/);
  } finally {
    await rm(skills, { recursive: true, force: true });
    await rm(cfgHome, { recursive: true, force: true });
  }
});
```

- [ ] **Step 7: Run covering tests** — `node --test test/install.test.js test/args.test.js test/cli.test.js` → PASS.

- [ ] **Step 8: Commit**

```bash
git add src/install.js src/args.js bin/orn.js test/install.test.js test/cli.test.js
git commit -m "feat(cli): install-skill writes default config + discoverable verifier pointer (--verifier)"
```

---

### Task 7: skill wiring (`SKILL.md`) + CHANGELOG

**Files:**
- Modify: `skill/ornith-loop/SKILL.md` (steps 3–5 config-driven)
- Modify: `CHANGELOG.md` (`[Unreleased]` → Added)
- Test: `test/skill.test.js` (existing frontmatter/host-neutral checks must stay green)

**Interfaces:** none (documentation/prose). No new exports.

- [ ] **Step 1: Update `SKILL.md` step 3 (Run)**

In step 3 (the `orn run ...` step), add a sentence after the existing invocation line:

```
   `orn run` uses your configured executor model (`orn config get executor.model`,
   default `ornith-1.0-9b-64k`) unless you pass `--model`.
```

- [ ] **Step 2: Replace the optional-verify paragraph in step 4**

Replace the existing "*Optional two-tier verify (local-first).*" paragraph (the one that says "hand it to the verifier via `orn run --model <verifier>`") with:

```
   *Optional two-tier verify (local-first, configurable).* If a local verifier is configured
   (`orn config get verifier.enabled` → `true`), offload the first pass to it instead of
   judging every run yourself: `orn verify --workdir <repo> --test-cmd "<test command>"`
   prints `pass` / `fail` / `uncertain`. **Accept a `pass`; audit `fail` and `uncertain`
   yourself** — the Layer-0 mechanical checks stay the anchor of truth, and a model verdict
   never overrides a red test or an out-of-scope diff. If no verifier is configured (the
   default), verify the run yourself. Enable/choose one with `orn config set verifier.enabled
   true` / `orn config set verifier.model <id>`; pick the model empirically with
   `benchmarks/bench.mjs verify-report` (see [`docs/VERIFIER.md`](../../docs/VERIFIER.md)) —
   the metric that matters is its **false-pass rate**, since ornith already confabulates.
```

- [ ] **Step 3: Note the round budget in step 5**

In step 5 (Corrective round), change "bounded, default 3" to reference the config:

```
5. **Corrective round (bounded — `orn config get correctiveRounds`, default 3).**
```

- [ ] **Step 4: Run the skill test** — `node --test test/skill.test.js`
Expected: PASS (the edits keep the frontmatter and host-neutral framing; no host-locked phrases added).

- [ ] **Step 5: Add the CHANGELOG entry**

In `CHANGELOG.md` under `## [Unreleased]` → `### Added`:

```markdown
- Configurable local verifier: a user-level config (`~/.config/ornith-loop/config.json`,
  honoring `XDG_CONFIG_HOME`) for the executor model, the Layer-1 local verifier (on/off +
  model, **off by default** → Claude verifies inline), and the corrective-round budget.
  New `orn config get|set|path`, and `orn verify --workdir <r> --test-cmd "<cmd>"` — a
  mechanized read-only Layer-1 verify that reuses the evidence-packet machinery and prints
  `pass`/`fail`/`uncertain`. `orn install-skill` now writes a default config and prints a
  discoverable pointer (with detected Ollama models), plus a `--verifier <model>` one-shot
  flag. `orn run` and `bench.mjs orchestrate` honor the config defaults. `gatherEvidence`
  extracted to `src/evidence.js` (shared by the benchmark and `orn verify`). The `ornith-loop`
  skill's steps 3–5 are now config-driven. Presidia unchanged: Layer-0 stays the anchor;
  the verifier never sees a gold label.
```

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS — previous 82 + Task 1 (7) + Task 2 (2) + Task 3 (1) + Task 4 (2) + Task 5 (1) + Task 6 (3) = 98 tests, 0 fail. (Exact count may vary by ±1; the requirement is 0 failures and every new test present.)

- [ ] **Step 7: Commit**

```bash
git add skill/ornith-loop/SKILL.md CHANGELOG.md
git commit -m "docs(skill): config-driven verify + executor + rounds in SKILL.md; CHANGELOG"
```

---

## Self-Review

**Spec coverage:**
- Config file (location/schema/defaults) → Task 1. ✅
- `orn config` get/set/path → Task 3. ✅
- `orn verify` (resolve model, gather evidence, packet, verdict, exit codes) → Task 4. ✅
- `gatherEvidence` extraction to `src/` → Task 2. ✅
- Install discoverability + default config + `--verifier` → Task 6. ✅
- Config-driven executor model + orchestrate rounds → Task 5. ✅
- Skill steps 3–5 wiring → Task 7. ✅
- CHANGELOG → Task 7. ✅
- Presidia (default off, no gold label, Layer-0 anchor) → enforced in Task 4 (`runVerify` never receives a workdir gold label; default `enabled:false` → `notConfigured`) and stated in Task 7 prose. ✅

**Placeholder scan:** none — every code step has complete code; every command is exact.

**Type consistency:** `loadConfig`/`setConfigKey`/`getConfigKey`/`configPath` (Task 1) are used with matching signatures in Tasks 3, 4, 5, 6. `gatherEvidence(workdir, testCmdArgv)` (Task 2) is called with `(wd, t.meta.testCmd)` in bench and `(options.workdir, testArgv)` in `runVerify`. `runVerify(options, {config})` returns `{notConfigured}` | `{verdict}`, consumed exactly in `bin/orn.js` (Task 4 Step 5). `buildEvidencePacket`/`parseVerdict` calls match `src/verifier.js` signatures. `parseEventStream(stdout).events` → `summarizeEvents(events).finalText` matches `src/parse.js`.

**Note for the executor:** Task 2 changes `gatherEvidence`'s call convention; Tasks that run bench tests (2, 5) must confirm `test/bench.test.js`, `test/corpus.test.js`, `test/orchestrate.test.js` stay green after the refactor.
