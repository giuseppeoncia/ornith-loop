# CLAUDE.md

Guidance for Claude Code working in this repository.

## Project

`ornith-loop` is a harness for experimenting with **self-scaffolding local models**
(Ornith 1.0 first) under the **pi** minimalist agent harness, with **Claude as the external
reviewer**. The goal is learning — figuring out which grounding lets such a model succeed —
not token savings or production automation. Full design & rationale live in
[`docs/DESIGN.md`](docs/DESIGN.md), which is the source of truth; keep it in sync.

## The one principle that governs everything

**Do not steal ornith's nest.** Ornith is RL-trained to build its own scaffold (plan,
tool-call sequence, error recovery); pi is chosen precisely because it does not impose one.
So this tool must not impose one either.

Distinguish three kinds of help — conflating them is the classic mistake:

- **Reasoning scaffold** (plan, sequence, recovery) → **ornith provides it.** Never
  spoon-feed step-by-step micro-tasks; that bypasses the very capability under test.
- **Grounding** (real paths, versions, routes, selectors, conventions the model can't
  derive) → the wrapper provides it. This is not scaffold — it's missing knowledge.
- **Verification & observability** → Claude's job.

When prompting ornith: give it the **goal + grounding**, then let it self-scaffold. Add
grounding on corrective rounds, never scaffold.

## Architecture

- **`orn`** — thin Node CLI. Invokes `pi -p <prompt> --provider ollama --model <id>
  --thinking off --mode json --name <label>`, enforces a timeout, passes env through, and
  parses pi's json event stream into an observability summary. Does NOT author prompts,
  choose grounding, or judge correctness.
- **`ornith-loop`** — Claude Code skill encoding the method: grounding → minimal-scaffold
  prompt → `orn` → external verification → bounded corrective loop (default 3) → journal.
- **`journal/`** — accumulated run observations (the learning deliverable).

## Hard-won operating notes (from the originating experiment)

These are empirical, model-specific lessons — treat as grounding for any future run:

- **`--thinking off` is required.** With thinking on, ornith leaks tool calls into the
  reasoning channel as `<tool_call>` **text** that pi (openai-completions provider) cannot
  parse, so nothing executes and the turn stalls.
- **Use a tools-capable model.** The default `ornith-1.0-9b-64k` emits tool calls
  intermittently; larger tool-capable models (e.g. `qwen3.6-35b-a3b-64k`) are more reliable
  if comparing.
- **Ornith corrupts in-place edits** (token-level: dropped/added spaces, wrong casing) but
  does **additive edits and write-from-scratch cleanly.** Prefer those; verify diffs.
- **Ornith confabulates success** — it will claim files exist / checks passed when they
  don't. **Never trust its self-report; verify externally every time** (build, tests, diff,
  rendered output/pixels).
- **It stalls before the last step** — often narrates "now I'll do X" as its final message
  instead of doing X. Keep tasks short; verify completion yourself.
- **macOS has no `timeout`.** Use a Node child-process kill timer (or `perl -e 'alarm N;
  exec @ARGV'` in shell).
- **pi's subprocess is not sandboxed like Claude's tools** — it can read `.env` and secrets
  the orchestrator's tools may be blocked from. Useful, but handle credentials with care;
  never persist them.

## Conventions

- CLI in **Node** (single language for invocation + jsonl parsing; same ecosystem as pi).
- Changelog follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); SemVer.
- Design decisions go in `docs/DESIGN.md` first, then implementation.

## Commands

- `orn run "<goal + grounding>" [--workdir <repo>] [--label <name>] [--model <id>]
  [--thinking off] [--timeout <sec>] [--prompt-file <path>] [--runs-dir <path>]` —
  invoke pi against Ollama and capture a run record under `runs/`.
- `npm test` — run the test suite (`node --test`, zero deps).

No linter configured yet.

## Release Flow

Fixed, deterministic process — follow it exactly every time, starting from `develop`.
This is a CLI + skill (no web app / GitHub Pages): a release ships a git tag, a GitHub
Release, and an npm publish, all driven by `.github/workflows/release.yml` on tag push.

**Step 1 — on `develop`:** move `[Unreleased]` content to a new versioned section
`[X.Y.Z] - YYYY-MM-DD`, leave `[Unreleased]` empty, and update the compare/tag link refs at
the bottom of `CHANGELOG.md`. Bump `"version"` in `package.json` and the two `"version"`
fields at the top of `package-lock.json` (root and `packages[""]`) to `X.Y.Z`. Commit and push:

```bash
git add CHANGELOG.md package.json package-lock.json
git commit -m "chore(release): X.Y.Z"
git push origin develop
```

**Step 2 — open PR `develop → main`:** branch protection on `main` rejects direct pushes, so
a PR is mandatory. With `gh` installed:

```bash
gh pr create --base main --head develop \
  --title "Release vX.Y.Z" \
  --body "Release notes: see CHANGELOG.md [X.Y.Z] section."
```

Without `gh`: open `https://github.com/giuseppeoncia/ornith-loop/compare/main...develop`.

**Step 3 — wait for the `build` check, then merge:** `ci.yml` runs `npm ci && npm test` on
the PR and reports the required `build` status. Once green, `gh pr merge --merge <PR#>` (or
the GitHub UI).

**Step 4 — tag the merge commit on `main` and push the tag:** pushing the `vX.Y.Z` tag
triggers `release.yml`, which re-runs tests, verifies the tag matches `package.json`,
publishes to npm, and creates the GitHub Release from the `[X.Y.Z]` CHANGELOG section.

```bash
git checkout main
git pull origin main
git tag vX.Y.Z          # tags the merge commit at HEAD of main
git push origin vX.Y.Z
```

**Step 5 — return to `develop`:**

```bash
git checkout develop
```

Notes:
- Do **not** create the tag before the PR merges — its target SHA only exists after
  GitHub produces the merge commit.
- `release.yml` requires the repo secret `NPM_TOKEN` (an npm automation token). The
  GitHub Release uses the built-in `GITHUB_TOKEN`.
- Reverts go via a follow-up PR (`git revert` on `develop` → PR → merge); `main` history
  is protected, never rewrite it.
