# Cross-harness `ornith-loop` skill — Design

_Date: 2026-07-07 · Target release: v0.2.0 · Branch: `develop`_

> Design source of truth for the project remains [`docs/DESIGN.md`](../../DESIGN.md); this
> spec covers one feature. If they ever disagree, `docs/DESIGN.md` wins.

## Context

`ornith-loop` ships as a Claude Code skill installed to `~/.claude/skills/`. We want the
**same** skill to also work under [opencode](https://opencode.ai), using **the model
configured on whichever harness runs it** as the reviewer.

Key insight (already satisfied by construction): the skill is *instructions executed by the
host agent*. There is no separate reviewer to configure — whichever agent executes the
verification steps **is** the external reviewer. So "reviewer = the starting harness's model"
is automatic (Claude in Claude Code; the configured model in opencode). `orn` and `pi` are
plain binaries, identical on both.

Grounding (verified):
- opencode ≥1.x discovers skills from `~/.claude/skills/<name>/SKILL.md` (plural `skills`,
  the old singular-glob quirk is resolved), plus `~/.config/opencode/skills/` and project
  `.opencode/skills/`, `.claude/skills/`. It invokes them via a native `skill` tool by name.
  ([opencode.ai/docs/skills](https://opencode.ai/docs/skills/))
- `SKILL.md` frontmatter: `name`, `description` required; `license`, `compatibility`,
  `metadata` optional; unknown fields ignored.
- opencode 1.17.9 is installed on this machine → the cross-harness run can be verified
  empirically, not just theorized.
- The current `SKILL.md` body is already host-neutral (second person to the executing agent,
  no `Claude` hardcoding, no PascalCase tool identifiers, no `/`-command references).

So the work is packaging + explicit neutrality + verification + docs — not new logic.

## Goal & non-goals

**Goal:** one canonical `SKILL.md` that loads and runs under both Claude Code and opencode,
installable to either via `orn install-skill`, with the reviewer being the host harness's
own model.

**Non-goals:**
- No project-level install (`.claude/skills`, `.opencode/skills`) — global/personal only
  (addable later).
- No change to `orn run`, the run-record schema, or the pi invocation.
- No harness-specific forks of the skill content — a single source file.
- No separate reviewer model configuration (it is the host's model, by construction).

## Components

### 1. `skill/ornith-loop/SKILL.md` — explicit host-neutrality (minimal edits)

- Add one framing line near the top: the skill is runnable from any coding agent (Claude
  Code, opencode, …); **the agent that executes these steps IS the external reviewer**.
- Add `license: MIT` to the frontmatter (recognized field). Keep `name`/`description`. Do
  not add `compatibility` (no defined semantics; ignored anyway).
- No other body changes — it is already neutral.

### 2. `orn install-skill` — new CLI subcommand (replaces `scripts/install-skill.sh`)

```
orn install-skill                    # auto: install into every detected harness
orn install-skill --target claude    # ~/.claude/skills/ornith-loop
orn install-skill --target opencode  # ~/.config/opencode/skills/ornith-loop
```

- **`--target`** ∈ `auto` (default) | `claude` | `opencode`. (No `both`: `auto` already
  installs to all detected harnesses.)
- **Auto-detect:** Claude Code present if `~/.claude/` exists; opencode present if
  `opencode` is on `PATH` or `~/.config/opencode/` exists. With `--target auto` and no
  harness detected → print guidance and exit non-zero.
- **Install method:** symlink from the packaged source `skill/ornith-loop` (resolved
  relative to the package, so it works both in-repo and after `npm i -g`), with a copy
  fallback if symlinking fails. Idempotent: replace any existing `ornith-loop` at the dest.
- **Overrides (for tests/custom setups):** env `CLAUDE_SKILLS_DIR`, `OPENCODE_SKILLS_DIR`.
- Prints, per target, whether it symlinked or copied and to where.
- `scripts/install-skill.sh` is **removed**; README references updated to the subcommand.

### 3. CLI wiring (`src/args.js`, `bin/orn.js`)

- `parseArgs` becomes a **two-command dispatch** (`run`, `install-skill`), each with its own
  options; unknown command → error. `run` behavior is unchanged.
- **Pure target resolution** extracted as `resolveTargets({ target, env, homedir, hasOpencode })`
  → `[{ name: "claude"|"opencode", dir: string }]` — no filesystem side effects, fully
  unit-testable (harness detection is passed in, not probed inside).
- **Effectful install** as a thin `installSkill(targets, sourceDir)` → `[{ name, dir, method }]`
  doing the symlink/copy, tested against temp dirs (à la `src/git.js`).
- `bin/orn.js` dispatches: `run` → existing pipeline; `install-skill` → resolve targets
  (probing the real fs/PATH for detection), install, print results, exit 0 / non-zero.

### 4. Testing + portability safeguard

- `resolveTargets` unit tests: `auto` with claude-only / opencode-only / both present /
  none; explicit `--target claude` / `--target opencode`; env overrides honored.
- `installSkill` test: creates the symlink at a temp dest, idempotent re-install, copy
  fallback path.
- `test/skill.test.js` **portability lint**: parse the `SKILL.md` frontmatter and assert
  `name === "ornith-loop"` and a non-empty `description`; assert the body contains no
  host-locked phrases from a small denylist (e.g. "Claude Code only", a tool presented as a
  PascalCase API like "the Read tool"). Guards neutrality against future edits.

### 5. Docs + empirical verification

- **README** "Skill" section: document both harnesses and `orn install-skill` (replacing the
  `scripts/install-skill.sh` instructions). **CHANGELOG**: `### Added` under `[Unreleased]`
  for the subcommand + opencode compatibility (released as **v0.2.0** via the documented
  `develop → PR → main → tag` flow). **CLAUDE.md** Commands: add `orn install-skill`.
- **Empirical verification in opencode 1.17.9** (installed here): `orn install-skill
  --target opencode`, confirm opencode discovers/invokes `ornith-loop`, and drive one real
  `orn run` through it. Externally verify the result (never trust the self-report).
- **Journal entry** documenting the first cross-harness (opencode) run — extends the
  learning deliverable and validates that the reviewer is genuinely the opencode-side model.

## Acceptance criteria

- A single `SKILL.md` loads and is invokable in **both** Claude Code and opencode; verified
  empirically in opencode 1.17.9.
- `orn install-skill` installs to detected harness location(s); `--target claude|opencode`
  forces one; `auto` (default) installs to all detected; no harness detected → helpful
  error, non-zero exit.
- The reviewer is the host harness's model, by construction — documented, no configuration.
- Portability-lint test guards `SKILL.md` frontmatter + neutrality.
- `scripts/install-skill.sh` removed; README/CHANGELOG/CLAUDE.md updated; version → 0.2.0.
- A journal entry records the first opencode-driven run.

## References

- Design source of truth: [`docs/DESIGN.md`](../../DESIGN.md)
- opencode skills: https://opencode.ai/docs/skills/
- Related plan/spec pair: [`../plans/2026-07-07-ornith-loop-implementation.md`](../plans/2026-07-07-ornith-loop-implementation.md)
