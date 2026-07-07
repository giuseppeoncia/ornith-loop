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
