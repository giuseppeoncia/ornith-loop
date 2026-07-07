# Cross-harness `ornith-loop` skill — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the single `ornith-loop` `SKILL.md` work under both Claude Code and opencode, add an `orn install-skill` subcommand that installs it into whichever harness(es) are present, and verify it runs cross-harness — with the reviewer being the host harness's own model.

**Architecture:** The skill is host-neutral instructions; the executing agent is the reviewer (no config). A new pure module `src/install.js` (dir resolution, harness detection, target resolution, effectful symlink/copy) backs a new `install-skill` command routed through a two-command `parseArgs`. `bin/orn.js` gains an install branch; `scripts/install-skill.sh` is removed.

**Tech Stack:** Node v24 ESM, `node:test` + `node:assert/strict`, `node:fs`/`node:path`/`node:os`. Zero dependencies.

**Spec:** [`../specs/2026-07-07-cross-harness-skill-design.md`](../specs/2026-07-07-cross-harness-skill-design.md)

## Global Constraints

- Node ESM (`"type": "module"`), Node >=24, **zero runtime and dev dependencies** (tests use only `node:test` + `node:assert/strict`).
- **One canonical `SKILL.md`** — no per-harness forks.
- **Reviewer = the host harness's model, by construction** — nothing to configure; do not add reviewer config.
- **Do not change** `orn run`, the run-record schema, or the pi invocation.
- **Global/personal install only** (`~/.claude/skills`, `~/.config/opencode/skills`) — no project-level install.
- Install method: **symlink with copy fallback**, idempotent.
- `--target` ∈ `auto` (default) | `claude` | `opencode` — **no `both`** (`auto` already installs to every detected harness).
- Harness discovery dirs, verified: Claude Code `~/.claude/skills/`, opencode `~/.config/opencode/skills/` (opencode also reads `~/.claude/skills/`). Env overrides: `CLAUDE_SKILLS_DIR`, `OPENCODE_SKILLS_DIR`.
- **Release as v0.2.0 via the documented Release Flow** — this plan only adds to CHANGELOG `[Unreleased]`; it does **not** bump `package.json`/lock version (that happens at release time).

---

## File Structure

```
src/install.js          NEW  skillDirs, detectHarnesses, resolveTargets (pure) + installSkill (effectful)
src/args.js             MOD  parseArgs -> two-command dispatch (run, install-skill); HELP rewritten
bin/orn.js              MOD  add install-skill branch; resolve packaged skill source
skill/ornith-loop/SKILL.md  MOD  host-neutral framing line + `license: MIT` frontmatter
scripts/install-skill.sh    DEL  replaced by `orn install-skill`
package.json            MOD  remove the deleted script from `files`
test/install.test.js    NEW  unit tests for install.js
test/skill.test.js      NEW  portability lint for SKILL.md
test/args.test.js       MOD  add install-skill parsing cases
test/cli.test.js        MOD  add `orn install-skill` integration case
README.md               MOD  Skill section -> `orn install-skill` + both harnesses
CHANGELOG.md            MOD  [Unreleased] ### Added entry
CLAUDE.md               MOD  Commands -> add `orn install-skill`
```

---

### Task 1: Host-neutral SKILL.md + portability lint

**Files:**
- Modify: `skill/ornith-loop/SKILL.md`
- Test: `test/skill.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: a `SKILL.md` whose neutrality is guarded by a test.

- [ ] **Step 1: Write the failing portability-lint test**

Create `test/skill.test.js`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const skill = readFileSync(
  fileURLToPath(new URL("../skill/ornith-loop/SKILL.md", import.meta.url)),
  "utf8"
);

function frontmatter(md) {
  const m = md.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(m, "SKILL.md must start with a YAML frontmatter block");
  const fm = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (kv) fm[kv[1]] = kv[2].trim();
  }
  return { fm, body: md.slice(m[0].length) };
}

test("SKILL.md frontmatter has the required, harness-recognized fields", () => {
  const { fm } = frontmatter(skill);
  assert.equal(fm.name, "ornith-loop");
  assert.ok(fm.description && fm.description.length > 20, "non-empty description");
  assert.equal(fm.license, "MIT");
});

test("SKILL.md body is host-neutral (cross-harness framing, no host-locked phrases)", () => {
  const { body } = frontmatter(skill);
  // Positive: an explicit cross-harness framing must be present.
  assert.match(body, /opencode/i, "body should name opencode as a supported host");
  assert.match(body, /any coding agent|whichever .* agent/i, "explicit host-agnostic framing");
  // Negative: no phrases that lock the skill to one host or a host-specific tool API.
  const denylist = [/claude code only/i, /the Read tool/i, /the Write tool/i, /the Bash tool/i];
  for (const re of denylist) assert.ok(!re.test(body), `host-locked phrase present: ${re}`);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/skill.test.js`
Expected: FAIL — `license` is not `MIT` (absent) and the body lacks the "opencode"/"any coding agent" framing.

- [ ] **Step 3: Edit `skill/ornith-loop/SKILL.md`**

Change the frontmatter to add `license: MIT` (keep `name` and `description` exactly as they are):
```markdown
---
name: ornith-loop
description: Use when driving a self-scaffolding local model (ornith 1.0 first) under the pi harness via the `orn` CLI — gather grounding, author a MINIMAL-scaffold prompt, run, verify externally, loop with more grounding (not scaffold), and journal. Use for "run this task on ornith", "have the local model do X", or comparing local models under pi.
license: MIT
---
```

Insert this paragraph immediately after the opening paragraph (the one ending "…never supply *reasoning scaffold* (plans, step-by-step micro-tasks, tool sequences)."), before `## Distinguish three kinds of help`:
```markdown
Host-agnostic: run this from any coding agent (Claude Code, opencode, …). Whichever agent
executes these steps **is** the external reviewer — it does the verification with its own
model. `orn` and `pi` behave identically on every host.
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/skill.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add skill/ornith-loop/SKILL.md test/skill.test.js
git commit -m "feat(skill): host-neutral framing + license frontmatter; portability lint"
```

---

### Task 2: `src/install.js` — dirs, detection, target resolution, install

**Files:**
- Create: `src/install.js`
- Test: `test/install.test.js`

**Interfaces:**
- Consumes: nothing (pure functions take injected `env`, `homedir`, `exists`, `pathEntries`).
- Produces:
  - `skillDirs(env, homedir) => { claude: string, opencode: string }`
  - `detectHarnesses({ env, homedir, exists, pathEntries }) => { claude: boolean, opencode: boolean }`
  - `resolveTargets({ target, env, homedir, detected }) => Array<{ name: "claude"|"opencode", dir: string }>`
  - `installSkill(targets, sourceDir) => Array<{ name, dest: string, method: "symlinked"|"copied" }>` (effectful)

- [ ] **Step 1: Write the failing tests**

Create `test/install.test.js`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { skillDirs, detectHarnesses, resolveTargets, installSkill } from "../src/install.js";

test("skillDirs uses defaults, env overrides win", () => {
  const d = skillDirs({}, "/home/u");
  assert.equal(d.claude, "/home/u/.claude/skills");
  assert.equal(d.opencode, "/home/u/.config/opencode/skills");
  const o = skillDirs({ CLAUDE_SKILLS_DIR: "/x", OPENCODE_SKILLS_DIR: "/y" }, "/home/u");
  assert.equal(o.claude, "/x");
  assert.equal(o.opencode, "/y");
});

test("detectHarnesses: ~/.claude dir, opencode config dir, opencode on PATH, env overrides", () => {
  const homedir = "/home/u";
  const has = (paths) => (p) => paths.includes(p);
  // claude via ~/.claude
  assert.deepEqual(
    detectHarnesses({ env: {}, homedir, exists: has(["/home/u/.claude"]), pathEntries: [] }),
    { claude: true, opencode: false }
  );
  // opencode via ~/.config/opencode
  assert.deepEqual(
    detectHarnesses({ env: {}, homedir, exists: has(["/home/u/.config/opencode"]), pathEntries: [] }),
    { claude: false, opencode: true }
  );
  // opencode via PATH binary
  assert.deepEqual(
    detectHarnesses({ env: {}, homedir, exists: has(["/usr/local/bin/opencode"]), pathEntries: ["/usr/local/bin"] }),
    { claude: false, opencode: true }
  );
  // env overrides mark present without any fs hit
  assert.deepEqual(
    detectHarnesses({ env: { CLAUDE_SKILLS_DIR: "/x", OPENCODE_SKILLS_DIR: "/y" }, homedir, exists: () => false, pathEntries: [] }),
    { claude: true, opencode: true }
  );
});

test("resolveTargets: forced targets ignore detection; auto uses detection", () => {
  const base = { env: {}, homedir: "/home/u" };
  assert.deepEqual(resolveTargets({ ...base, target: "claude", detected: { claude: false, opencode: false } }),
    [{ name: "claude", dir: "/home/u/.claude/skills" }]);
  assert.deepEqual(resolveTargets({ ...base, target: "opencode", detected: { claude: false, opencode: false } }),
    [{ name: "opencode", dir: "/home/u/.config/opencode/skills" }]);
  assert.deepEqual(
    resolveTargets({ ...base, target: "auto", detected: { claude: true, opencode: true } }).map((t) => t.name),
    ["claude", "opencode"]);
  assert.deepEqual(resolveTargets({ ...base, target: "auto", detected: { claude: false, opencode: false } }), []);
});

test("installSkill symlinks the source into each target and is idempotent", async () => {
  const src = await mkdtemp(join(tmpdir(), "orn-src-"));
  const dest = await mkdtemp(join(tmpdir(), "orn-dest-"));
  try {
    await writeFile(join(src, "SKILL.md"), "marker");
    const first = installSkill([{ name: "claude", dir: dest }], src);
    assert.equal(first[0].method, "symlinked");
    assert.equal(first[0].dest, join(dest, "ornith-loop"));
    assert.equal(await readlink(join(dest, "ornith-loop")), src);
    // the source content is reachable through the installed link
    assert.ok(existsSync(join(dest, "ornith-loop", "SKILL.md")));
    // idempotent: second run replaces cleanly, still points at src
    installSkill([{ name: "claude", dir: dest }], src);
    assert.equal(await readlink(join(dest, "ornith-loop")), src);
    assert.ok(existsSync(join(dest, "ornith-loop", "SKILL.md")));
  } finally {
    await rm(src, { recursive: true, force: true });
    await rm(dest, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/install.test.js`
Expected: FAIL — cannot find module `../src/install.js`.

- [ ] **Step 3: Implement `src/install.js`**

```js
import { mkdirSync, rmSync, symlinkSync, cpSync } from "node:fs";
import { join } from "node:path";

const SKILL_NAME = "ornith-loop";

// Where each harness discovers global/personal skills (env override wins).
export function skillDirs(env, homedir) {
  return {
    claude: env.CLAUDE_SKILLS_DIR || join(homedir, ".claude", "skills"),
    opencode: env.OPENCODE_SKILLS_DIR || join(homedir, ".config", "opencode", "skills"),
  };
}

// Pure detection: `exists` and `pathEntries` are injected so this is unit-testable.
export function detectHarnesses({ env, homedir, exists, pathEntries }) {
  const claude = Boolean(env.CLAUDE_SKILLS_DIR) || exists(join(homedir, ".claude"));
  const opencode =
    Boolean(env.OPENCODE_SKILLS_DIR) ||
    exists(join(homedir, ".config", "opencode")) ||
    pathEntries.some((p) => exists(join(p, "opencode")));
  return { claude, opencode };
}

// Pure: (target + detected) -> install targets. `auto` yields only detected harnesses.
export function resolveTargets({ target, env, homedir, detected }) {
  const dirs = skillDirs(env, homedir);
  if (target === "claude") return [{ name: "claude", dir: dirs.claude }];
  if (target === "opencode") return [{ name: "opencode", dir: dirs.opencode }];
  const out = [];
  if (detected.claude) out.push({ name: "claude", dir: dirs.claude });
  if (detected.opencode) out.push({ name: "opencode", dir: dirs.opencode });
  return out;
}

// Effectful: symlink the skill source into each target dir (copy fallback). Idempotent.
export function installSkill(targets, sourceDir) {
  return targets.map(({ name, dir }) => {
    const dest = join(dir, SKILL_NAME);
    mkdirSync(dir, { recursive: true });
    rmSync(dest, { recursive: true, force: true });
    let method;
    try {
      symlinkSync(sourceDir, dest);
      method = "symlinked";
    } catch {
      cpSync(sourceDir, dest, { recursive: true });
      method = "copied";
    }
    return { name, dest, method };
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/install.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/install.js test/install.test.js
git commit -m "feat(orn): install module — dirs, harness detection, target resolution, symlink"
```

---

### Task 3: `parseArgs` two-command dispatch

**Files:**
- Modify: `src/args.js`
- Test: `test/args.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `parseArgs(argv)` returning `{ options }` for `run` (unchanged shape, `command:"run"`) and for `install-skill` (`{ command:"install-skill", target }`), `{ help:true }`, or `{ error }`. Rewritten `HELP`.

- [ ] **Step 1: Add failing install-skill parsing tests**

Append to `test/args.test.js`:
```js
test("install-skill: defaults to target auto", () => {
  const { options } = parseArgs(["install-skill"]);
  assert.equal(options.command, "install-skill");
  assert.equal(options.target, "auto");
});

test("install-skill: --target is honored and validated", () => {
  assert.equal(parseArgs(["install-skill", "--target", "opencode"]).options.target, "opencode");
  assert.equal(parseArgs(["install-skill", "--target", "claude"]).options.target, "claude");
  assert.match(parseArgs(["install-skill", "--target", "both"]).error, /target/i);
  assert.match(parseArgs(["install-skill", "--nope"]).error, /unexpected|unknown/i);
});

test("run parsing still works after dispatch refactor", () => {
  const { options } = parseArgs(["run", "make a file", "--label", "x"]);
  assert.equal(options.command, "run");
  assert.equal(options.prompt, "make a file");
  assert.equal(options.label, "x");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/args.test.js`
Expected: FAIL — `install-skill` is rejected as an unknown command by the current `parseArgs`.

- [ ] **Step 3: Rewrite `src/args.js`**

Replace the entire file with:
```js
const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh"]);
const INSTALL_TARGETS = new Set(["auto", "claude", "opencode"]);

function slugLabel(prompt) {
  const slug = prompt.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").split("-").slice(0, 5).join("-");
  return slug || "run";
}

export function parseArgs(argv) {
  const command = argv[0];
  if (!command || command === "-h" || command === "--help") return { help: true };
  if (command === "run") return parseRun(argv.slice(1));
  if (command === "install-skill") return parseInstall(argv.slice(1));
  return { error: `unknown command '${command}': expected 'run' or 'install-skill'` };
}

function parseRun(args) {
  if (args.includes("-h") || args.includes("--help")) return { help: true };
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
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const next = () => args[++i];
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

function parseInstall(args) {
  const opts = { command: "install-skill", target: "auto" };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const next = () => args[++i];
    switch (a) {
      case "-h": case "--help": return { help: true };
      case "--target": opts.target = next(); break;
      default: return { error: `unexpected argument '${a}'` };
    }
  }
  if (!INSTALL_TARGETS.has(opts.target))
    return { error: `invalid --target '${opts.target}': one of ${[...INSTALL_TARGETS].join(", ")}` };
  return { options: opts };
}

export const HELP = `orn <command> [options]

Commands:
  run <prompt>       drive a self-scaffolding local model via pi, capturing a run record
  install-skill      install the ornith-loop skill into your coding agent(s)

orn run <prompt> [options]
  --prompt-file <path>   read the prompt from a file (instead of a positional)
  --model <id>           default: ornith-1.0-9b-64k
  --provider <name>      default: ollama
  --thinking <level>     off|minimal|low|medium|high|xhigh (default: off)
  --timeout <seconds>    kill pi after N seconds (default: 900)
  --label, -n <name>     session/run label (default: slug of prompt)
  --workdir <path>       git repo to snapshot before/after (claimed-done-no-change flag)
  --runs-dir <path>      where to write run records (default: runs)
  env: ORN_PI_BIN overrides the pi binary path (default: pi)

orn install-skill [options]
  --target <where>       auto|claude|opencode (default: auto = every detected harness)
  env: CLAUDE_SKILLS_DIR, OPENCODE_SKILLS_DIR override install locations

  -h, --help             show this help`;
```

- [ ] **Step 4: Run the full arg suite to verify pass**

Run: `node --test test/args.test.js`
Expected: PASS (all existing run cases + 3 new install-skill cases).

- [ ] **Step 5: Commit**

```bash
git add src/args.js test/args.test.js
git commit -m "feat(orn): two-command arg dispatch (run, install-skill)"
```

---

### Task 4: Wire `install-skill` into `bin/orn.js`; remove the shell script

**Files:**
- Modify: `bin/orn.js`
- Delete: `scripts/install-skill.sh`
- Modify: `package.json` (drop the deleted script from `files`)
- Test: `test/cli.test.js`

**Interfaces:**
- Consumes: `parseArgs`/`HELP` (Task 3), `detectHarnesses`/`resolveTargets`/`installSkill` (Task 2).
- Produces: `orn install-skill` end to end; `orn run` unchanged.

- [ ] **Step 1: Add a failing CLI integration test**

Append to `test/cli.test.js`:
```js
test("orn install-skill --target claude: symlinks into CLAUDE_SKILLS_DIR", async () => {
  const skills = await mkdtemp(join(tmpdir(), "orn-skills-"));
  try {
    const { stdout } = await pexec(process.execPath, [orn, "install-skill", "--target", "claude"], {
      env: { ...process.env, CLAUDE_SKILLS_DIR: skills },
    });
    assert.match(stdout, /symlinked|copied/);
    const files = await readdir(skills);
    assert.ok(files.includes("ornith-loop"), "skill installed at target dir");
  } finally {
    await rm(skills, { recursive: true, force: true });
  }
});
```
(`pexec`, `orn`, `mkdtemp`, `readdir`, `rm`, `join`, `tmpdir` are already imported at the top of `test/cli.test.js`.)

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/cli.test.js`
Expected: FAIL — `install-skill` currently falls through / errors (no install branch in `bin/orn.js`).

- [ ] **Step 3: Rewrite `bin/orn.js`**

Replace the entire file with:
```js
#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { parseArgs, HELP } from "../src/args.js";
import { invokePi } from "../src/invoke.js";
import { parseEventStream, summarizeEvents } from "../src/parse.js";
import { detectFlags } from "../src/flags.js";
import { snapshot, diffSnapshots } from "../src/git.js";
import { buildRecord, writeRecord } from "../src/record.js";
import { formatSummary } from "../src/summary.js";
import { detectHarnesses, resolveTargets, installSkill } from "../src/install.js";

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

if (options.command === "install-skill") {
  const sourceDir = fileURLToPath(new URL("../skill/ornith-loop", import.meta.url));
  const detected = detectHarnesses({
    env: process.env,
    homedir: homedir(),
    exists: existsSync,
    pathEntries: (process.env.PATH || "").split(":").filter(Boolean),
  });
  const targets = resolveTargets({ target: options.target, env: process.env, homedir: homedir(), detected });
  if (targets.length === 0) {
    process.stderr.write(
      "orn: no coding agent detected (looked for ~/.claude and opencode).\n" +
        "Install one, or force a target: orn install-skill --target claude|opencode\n"
    );
    process.exit(1);
  }
  for (const r of installSkill(targets, sourceDir)) {
    process.stdout.write(`${r.method} ${r.dest} (${r.name})\n`);
  }
  process.exit(0);
}

// options.command === "run"
if (options.promptFile) {
  try {
    options.prompt = readFileSync(options.promptFile, "utf8");
  } catch (err) {
    process.stderr.write(`orn: cannot read --prompt-file ${options.promptFile}: ${err.message}\n`);
    process.exit(2);
  }
}

const timestamp = new Date().toISOString();
const safeLabel = options.label.replace(/[^A-Za-z0-9._-]/g, "-");
const runId = `${timestamp.replace(/[:.]/g, "-")}_${safeLabel}`;

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
const record = buildRecord({ options, invocation, summary, flags, workdirChange, runId, timestamp, runsDir: options.runsDir });
const { recordPath } = writeRecord(record, invocation.stdout, { runsDir: options.runsDir });

process.stdout.write(formatSummary(record) + `\nrecord: ${recordPath}\n`);
if (invocation.stderr.trim() && record.exit.reason !== "completed") {
  process.stderr.write(`\npi stderr:\n${invocation.stderr}\n`);
}
process.exit(record.exit.reason === "completed" ? 0 : 1);
```

- [ ] **Step 4: Remove the shell script and its `files` entry**

Run:
```bash
git rm scripts/install-skill.sh
```
Then edit `package.json`: in the `"files"` array, delete the line `"scripts/install-skill.sh",` (leave `bin/`, `src/`, `skill/`, `docs/DESIGN.md`).

- [ ] **Step 5: Run tests to verify pass**

Run: `node --test test/cli.test.js` then `npm test`
Expected: the new install-skill CLI test passes; the whole suite is green.

- [ ] **Step 6: Commit**

```bash
git add bin/orn.js package.json test/cli.test.js
git commit -m "feat(orn): orn install-skill command; remove scripts/install-skill.sh"
```

---

### Task 5: Docs — README, CHANGELOG, CLAUDE.md

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: the `orn install-skill` command (Task 4).
- Produces: docs describing cross-harness usage.

- [ ] **Step 1: Update the README "Skill" section**

Read `README.md` and locate the `### Skill` subsection (it currently references `scripts/install-skill.sh`). Replace its body with:
````markdown
### Skill

`ornith-loop` is a single `SKILL.md` that works from **any** coding agent — Claude Code or
[opencode](https://opencode.ai). Whichever agent runs it is the external reviewer (it does
the verification with its own model). Install it into the harness(es) you use:

```bash
orn install-skill            # auto: every detected harness
orn install-skill --target claude     # ~/.claude/skills/ornith-loop
orn install-skill --target opencode   # ~/.config/opencode/skills/ornith-loop
```

It encodes the method: grounding recon → minimal-scaffold prompt → `orn` run → external
verification → bounded corrective loop (default 3) → journal.
````

- [ ] **Step 2: Add a CHANGELOG entry**

In `CHANGELOG.md`, under `## [Unreleased]`, add (create the `### Added` heading if absent):
```markdown
### Added
- Cross-harness skill support: the single `ornith-loop` `SKILL.md` now runs under both
  Claude Code and opencode (the executing agent is the reviewer, using its own model), and a
  new `orn install-skill [--target auto|claude|opencode]` command installs it into the
  detected harness(es). Replaces `scripts/install-skill.sh`.
```

- [ ] **Step 3: Update CLAUDE.md Commands**

In `CLAUDE.md`, in the `## Commands` section, add after the `orn run …` bullet:
```markdown
- `orn install-skill [--target auto|claude|opencode]` — install the `ornith-loop` skill into
  the detected coding agent(s) (`~/.claude/skills`, `~/.config/opencode/skills`).
```

- [ ] **Step 4: Verify nothing broke**

Run: `npm test`
Expected: still green (docs-only task). Confirm the README no longer mentions `scripts/install-skill.sh`.

- [ ] **Step 5: Commit**

```bash
git add README.md CHANGELOG.md CLAUDE.md
git commit -m "docs: cross-harness skill usage + orn install-skill"
```

---

### Task 6: Empirical cross-harness verification in opencode + journal entry

**Manual/interactive verification — NOT a subagent TDD task.** Requires driving an interactive opencode session; the controller/human runs it and records the result.

**Files:**
- Create: `journal/YYYY-MM-DD-opencode-crossharness.md`

- [ ] **Step 1: Install the skill into opencode**

Run: `node bin/orn.js install-skill --target opencode`
Expected: prints `symlinked <~/.config/opencode/skills>/ornith-loop (opencode)`; confirm `~/.config/opencode/skills/ornith-loop/SKILL.md` resolves.

- [ ] **Step 2: Confirm opencode discovers the skill**

Launch opencode in a scratch dir and confirm `ornith-loop` appears among available skills (opencode exposes skills via its `skill` tool by name). If opencode's version needs a different global dir, fall back to `orn install-skill --target claude` (opencode also reads `~/.claude/skills/`) and re-confirm.

- [ ] **Step 3: Drive one real `orn run` through the skill from opencode**

Give opencode the same kind of minimal-scaffold task used in the inaugural smoke run (write-from-scratch, additive), letting it invoke the skill which calls `orn run … --workdir <scratch-repo>`.

- [ ] **Step 4: Externally verify (never trust the self-report)**

Inspect the actual file(s) in the scratch workdir (`cat`, `git status`) and the `runs/<id>.json`. Confirm the run record and flags match ground truth.

- [ ] **Step 5: Write the journal entry**

Using the template in `journal/README.md`, write `journal/YYYY-MM-DD-opencode-crossharness.md`: note the host = opencode, that the reviewer was opencode's configured model, the tool sequence, the external-verification verdict, and any host-specific friction (discovery path, tool naming). Commit:
```bash
git add journal/YYYY-MM-DD-opencode-crossharness.md
git commit -m "journal: first cross-harness run (ornith-loop under opencode)"
```

---

## Verification (end-to-end)

1. `npm test` — full suite green, including `test/skill.test.js` (portability lint), `test/install.test.js` (dirs/detection/resolution/symlink), the new `test/args.test.js` install cases, and the `test/cli.test.js` install-skill case.
2. `node bin/orn.js install-skill --target claude` with `CLAUDE_SKILLS_DIR=$(mktemp -d)` → symlink created; re-run is idempotent.
3. `node bin/orn.js --help` shows both `run` and `install-skill`.
4. Task 6 confirms the skill loads and a run completes under real opencode 1.17.9, verified externally, with a journal entry.
5. Release as **v0.2.0** via the documented Release Flow (`develop → PR → main → tag`); the tag triggers OIDC npm publish + GitHub Release.

## Notes for the implementer
- **TDD throughout** for Tasks 1–4 (failing test first). Task 6 is manual verification.
- **Zero dependencies** — `node:*` only.
- **Do not bump the version** here; the Release Flow cuts `[0.2.0]` and bumps `package.json`/lock at release time.
- Keep `orn run` and the run-record schema untouched — this feature is additive.
