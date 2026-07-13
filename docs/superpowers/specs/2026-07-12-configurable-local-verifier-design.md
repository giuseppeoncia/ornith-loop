# Spec — configurable local verifier

_Date: 2026-07-12 · Status: approved design, pre-implementation_

Companion to [`docs/VERIFIER.md`](../../VERIFIER.md) (the two-tier verification design) and the
[`ornith-loop` skill](../../../skill/ornith-loop/SKILL.md). Today the optional local-first
verifier lives only as prose in skill step 4: the agent hand-assembles an evidence packet and
calls `orn run --model <verifier>`. This spec makes the verifier **configurable** and its use
**mechanical and discoverable**, without changing the executor path or the presidia.

## Goal

Let a skill user decide, before using the skill, whether the Layer-1 verify pass runs on a
local model (and which one), persist that choice, surface it at install time, and have both the
CLI and the skill honor it — so the local verifier is usable by more than the doc-readers.

## Non-goals / what stays the same

- **The orchestrator stays the harness** (Claude Code / opencode). It is not a configurable
  model — it is whoever runs the skill. Out of scope entirely.
- **The presidia hold** (VERIFIER.md, ORCHESTRATOR.md §4): Layer-0 mechanical checks stay the
  anchor of truth; a model verdict never overrides a red test or an out-of-scope diff. The
  default is **verifier OFF** → Claude verifies inline, i.e. no behavior change vs today for
  anyone who does not opt in.
- **The executor path** (`orn run` → pi → Ollama → ornith) is unchanged except that `orn run`'s
  default model may now come from config.
- No interactive install wizard (fragile under non-TTY: CI, or `install-skill` invoked from an
  agent's Bash tool).

## Config file

**Location:** `~/.config/ornith-loop/config.json` (honor `XDG_CONFIG_HOME` when set; else
`~/.config`). Machine-bound, since the choices are which local Ollama models are pulled.
User-level only (no repo override in this milestone — YAGNI; the per-repo-varying value, the
test command, is passed to `orn verify`, not stored).

**Schema and defaults:**
```json
{
  "executor":  { "model": "ornith-1.0-9b-64k" },
  "verifier":  { "enabled": false, "model": "qwen3.5:4b" },
  "correctiveRounds": 3
}
```
Missing file or missing keys fall back to these defaults — reading config never fails on a
fresh machine. `verifier.enabled: false` is the safe default (Claude-inline verify).

## CLI: `orn config`

- `orn config get [dotted.key]` — print the effective (defaults-merged) config as JSON, or a
  single key's value.
- `orn config set <dotted.key> <value>` — set one known key, creating the file/dir if absent.
  Coerce/validate by key: `verifier.enabled` → boolean (`true`/`false`); `correctiveRounds` →
  positive integer; `executor.model` / `verifier.model` → non-empty string. Unknown key →
  error listing the known keys.
- `orn config path` — print the resolved config file path.

Known keys (the closed set the setter accepts): `executor.model`, `verifier.enabled`,
`verifier.model`, `correctiveRounds`.

## CLI: `orn verify`

`orn verify --workdir <repo> --test-cmd "<cmd>" [--model <id>] [--goal-file <f>] [--grounding-file <f>]`

1. Resolve the verifier model: `--model` if given, else `config.verifier.model`. If
   `config.verifier.enabled` is false **and** no `--model` was passed, exit with a clear,
   non-error-looking message: "no local verifier configured — Claude verifies inline; enable
   with `orn config set verifier.enabled true`" (exit non-zero so a script can branch on it).
2. Run the test command in `--workdir` (capture stdout+stderr+exit code). `--test-cmd
   "<cmd>"` is split on whitespace into an argv and run with no shell (so `node --test`
   works; commands needing shell quoting/pipes must go in a wrapper script). Required flag.
3. Compute the change evidence: `git add -A` (to include untracked), staged diff, changed-file
   list from `git status --porcelain` — the same evidence the benchmark gathers.
4. Assemble the packet with `buildEvidencePacket` (`src/verifier.js`), prepend
   `verifier/rubric.md`, and invoke the verifier read-only (pi `--no-tools`, reply inline).
5. Parse with `parseVerdict` and print the verdict + reason: `pass` / `fail` / `uncertain`
   (exit 0 regardless of verdict — the verdict is on stdout, not the exit code, so the skill
   reads it; only operational failure is a non-zero exit).

**Refactor (in scope):** the evidence-gathering (run test cmd, `git add -A`, diff, changed
files) currently lives inline in `benchmarks/bench.mjs` (`gatherEvidence`). Extract it to a
shared `src/` helper `src/evidence.js` `gatherEvidence(workdir, testCmdArgv)` where
`testCmdArgv` is a `[cmd, ...args]` array (bench passes `task.meta.testCmd`; `orn verify`
passes the whitespace-split `--test-cmd`). Have both callers use it. Behavior identical;
single source of truth.

## Install-time discoverability

`orn install-skill`, after copying the skill files, additionally:
- Creates the default config file if none exists (so `orn config get` always shows something).
- Prints a discoverable pointer to stdout: the local verifier is OFF (Claude verifies each
  run); to offload the first pass to a local model, run
  `orn config set verifier.enabled true` + `orn config set verifier.model <id>`; the Ollama
  models detected on this machine (best-effort `ollama list`; omit the line if `ollama` is
  absent); and a `docs/VERIFIER.md` pointer.
- New flag `orn install-skill --verifier <model>`: one-shot — sets `verifier.enabled true` and
  `verifier.model <model>` as part of install.

## Skill (`SKILL.md`) wiring

- **Step 3 (run):** note that `orn run` uses `config.executor.model` as its default model, so
  the configured executor is used without an explicit `--model`.
- **Step 4 (verify):** replace the current "hand-assemble a packet and call `orn run --model`"
  prose with: check whether a local verifier is configured, and if so run
  `orn verify --workdir <r> --test-cmd "<cmd>"` and honor the verdict — accept `pass`, audit
  `fail`/`uncertain` yourself; the mechanical Layer-0 checks stay the anchor. If not configured,
  verify yourself as Claude (today's default). Keep the false-pass caution and the
  `docs/VERIFIER.md` pointer.
- **`correctiveRounds`:** step 5 reads the configured budget as the loop bound; it also becomes
  the default for `bench.mjs orchestrate --rounds`.

## CLI wiring

- `orn run`: when `--model` is not passed, default to `config.executor.model` (falling back to
  the current hardcoded `ornith-1.0-9b-64k` when no config). `--model` still overrides.
- `bench.mjs orchestrate`: `--rounds` defaults to `config.correctiveRounds` when not passed.
- `orn --help` / usage gains `config` and `verify`.

## Components — new and touched

- **New `src/config.js`** (pure + a thin IO seam): `defaultConfig()`, `configPath()`,
  `loadConfig()` (merge file over defaults; tolerate missing/malformed → defaults + a warning),
  `setConfigKey(key, value)` (validate + coerce + write), `KNOWN_KEYS`.
- **New `src/evidence.js`**: `gatherEvidence(workdir, testCmd)` extracted from `bench.mjs`.
- **`src/args.js`**: parse `config` (get/set/path) and `verify` subcommands + their flags;
  `install-skill --verifier`; `run` no longer hardcodes the model default (resolved against
  config in the command layer).
- **`src/verify.js`** (or a `bin/orn.js` command handler): the `orn verify` flow above, reusing
  `buildEvidencePacket`/`parseVerdict` (`src/verifier.js`), `invokePi` (`src/invoke.js`),
  `gatherEvidence` (`src/evidence.js`).
- **`src/install.js`**: default-config creation + the discoverability message + `--verifier`.
- **`benchmarks/bench.mjs`**: use the extracted `gatherEvidence`; `orchestrate --rounds`
  defaults from config.
- **`skill/ornith-loop/SKILL.md`**: steps 3–5 wiring above.
- **`CHANGELOG.md`**: `[Unreleased]` → Added.
- **Tests:** `test/config.test.js` (defaults, merge, set/validate, unknown key), extend
  `test/args.test.js` (parse config/verify/`--verifier`), an `orn verify` dry-run via `fake-pi`
  (reuses the `# EVIDENCE PACKET` stub), and an `install-skill` test asserting the default
  config is written and the pointer printed.

## Success criteria

- `orn config set/get/path` round-trips the four known keys with validation; unknown key errors.
- `orn verify` on a workdir produces a `pass`/`fail`/`uncertain` verdict using the configured
  (or `--model`) verifier, dry-runnable via `fake-pi` (no ollama); with the verifier disabled
  and no `--model`, it prints the "not configured" guidance and exits non-zero.
- `orn install-skill` writes a default config and prints the discoverable pointer; `--verifier`
  enables + sets the model.
- The skill's step 4 is config-driven; default (verifier off) reproduces today's behavior.
- Presidia intact: Layer-0 mechanical checks remain the anchor; `orn verify` never sees a gold
  label; default is Claude-inline verify.
- `npm test` green.
