# ornith-loop

A repeatable, observable harness for experimenting with **self-scaffolding local models**
(starting with [Ornith](https://huggingface.co/KikoCis) 1.0) under the
[pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) minimalist agent harness — with
Claude as the external reviewer.

> **Status: the `orn` CLI and the `ornith-loop` skill are implemented; see below.**
> The design is in [`docs/DESIGN.md`](docs/DESIGN.md).

## Why pi + ornith

Ornith is trained (RL) to generate not just a solution but the **scaffold** that drives it
— the plan, the tool-call sequence, the error recovery. Self-scaffolding is the whole point
(Ornith = a bird, builds its own nest); its distinctive trait is not needing a
pre-packaged human scaffold.

Pi is the minimalist harness: four tools (Read, Write, Edit, Bash), no plan mode, no
imposed phases. It lets the agent build the structure it needs.

The thing that makes ornith interesting is exactly what pi leaves it room to do. This tool
exists to work **with** that grain, not against it — so it must not steal ornith's nest.

## The principle

Supplying facts is not the same as imposing scaffold:

- **Reasoning scaffold** (plan, sequence, recovery) → **ornith's job.** Don't impose it.
- **Grounding** (real paths, versions, routes, selectors, conventions the model can't
  derive) → the wrapper provides it.
- **Verification & observability** (what it did, where it broke) → Claude's job.

**Minimal imposed scaffold, maximal grounding, verification at the centre.** Give ornith
the goal plus the grounding it can't know, let it build the nest, and measure how well it
does.

## What it is

Three components (see the design for detail):

1. **`orn`** — a thin Node CLI that invokes pi with the right defaults (`--thinking off`,
   print mode, timeout, env passthrough) and parses pi's json event stream into an
   observability summary (ornith's self-built tool sequence + failure-mode flags).
2. **`ornith-loop`** — a Claude Code skill encoding the method: gather grounding → author a
   minimal-scaffold prompt → run via `orn` → verify externally → bounded corrective loop →
   journal.
3. **Experiment journal** — accumulated, comparable observations across runs and models.

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

### Skill

Install the `ornith-loop` Claude Code skill (usable from any project):

```bash
scripts/install-skill.sh   # symlinks skill/ornith-loop -> ~/.claude/skills/ornith-loop
```

It encodes the method: grounding recon → minimal-scaffold prompt → `orn` run → external
verification → bounded corrective loop (default 3) → journal.

## Goal & non-goals

**Goal:** learn which grounding lets a self-scaffolding local model succeed, repeatably and
with evidence.

**Non-goals:** token/cost savings (Claude-as-reviewer does not save them, by design);
production automation; a local reviewer model; auto-escalation or a scaffold "dial".

## Requirements

- [pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) on `PATH`
- [Ollama](https://ollama.com) running locally with a self-scaffolding model pulled
  (default `ornith-1.0-9b-64k`), registered as the `ollama` provider in
  `~/.pi/agent/models.json`
- Node (v24+)

## Repo layout

```
docs/DESIGN.md   design & rationale (source of truth)
README.md        this file
CHANGELOG.md     Keep a Changelog format
CLAUDE.md        guidance for Claude Code working in this repo
bin/, src/       the `orn` CLI
skill/           the `ornith-loop` Claude Code skill (see Skill section above)
journal/         experiment journal (per-run entries; see journal/README.md)
```
