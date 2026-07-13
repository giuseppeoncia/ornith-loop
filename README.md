# ornith-loop

A repeatable, observable harness for experimenting with **self-scaffolding local models**
(starting with [Ornith](https://huggingface.co/KikoCis) 1.0) under the
[pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) minimalist agent harness — with
Claude as the external reviewer.

> **Status: the `orn` CLI and the `ornith-loop` skill are implemented; see below.**
> The design is in [`docs/DESIGN.md`](docs/DESIGN.md).
> Next steps & how to resume on a local workstation → [`docs/ROADMAP.md`](docs/ROADMAP.md).

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
2. **`ornith-loop`** — a cross-harness skill (Claude Code + opencode) encoding the method: gather grounding → author a
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
`ollama` provider registered in `~/.pi/agent/models.json`. **Use the exact ornith build** — a
stock ornith GGUF has a broken chat template; see [The ornith model](#the-ornith-model-use-the-exact-build)
below.

**Tests:** `npm test` (uses `node --test`; zero dependencies).

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

Check which skill version is bundled vs installed:

```bash
orn skill-version   # bundled: 0.3.0 / claude: 0.3.0 / opencode: not installed
```

### Configurable local verifier (optional)

By default Claude verifies every run inline. If you've picked a local model as a safe
first-pass verifier (see [`docs/VERIFIER.md`](docs/VERIFIER.md)), configure and use it via
`orn config` / `orn verify`:

```bash
orn config set verifier.enabled true
orn config set verifier.model qwen3.5:4b
orn verify --workdir /path/to/target-repo --test-cmd "npm test"
```

Config lives at `~/.config/ornith-loop/config.json`; run `orn config get` / `orn --help` for
all keys and flags.

## Goal & non-goals

**Goal:** learn which grounding lets a self-scaffolding local model succeed, repeatably and
with evidence.

**Non-goals:** token/cost savings (Claude-as-reviewer does not save them, by design);
production automation; a local reviewer model; auto-escalation or a scaffold "dial".

## Benchmark results

Does the method actually raise ornith's **task success rate**, or is it just a convenient
wrapper? We measure it directly: each task runs under four arms, and a mechanical **oracle**
(runs the code / tests, checks the change is scoped) — never the model's own "done!" — scores
each attempt. Full design in [`docs/BENCHMARK.md`](docs/BENCHMARK.md), runs in
[`journal/`](journal/).

**Arms:** `A` = goal + **grounding** (facts it can't derive), with a corrective loop ·
`B1` = bare goal · `B2` = grounding + heavy step-by-step scaffold · `B3` = grounding, single
shot. So `A−B1` isolates grounding, `A−B2` isolates minimal-vs-heavy scaffold, `A−B3` the loop.

_Pilot · `ornith-1.0-9b-64k` · K=5 repeats per cell · success rate (%)_

| Task (edit mode)     | A (method) | B1 (bare) | B2 (heavy) | **A−B1** (grounding) |
|----------------------|:----------:|:---------:|:----------:|:--------------------:|
| T1 scratch (easy)    |    100     |    80     |    100     |        **+20**       |
| T2 additive (med)    |    100     |    100    |    100     |          0           |
| T3 in-place (med)    |    100     |    60     |    100     |        **+40**       |
| T4 additive (hard)   |    100     |    60     |     60     |        **+40**       |
| T6 in-place (hard)   |    100     |    20     |    100     |        **+80**       |

**What the numbers say (honestly):**

- ✅ **Grounding earns its keep.** Giving ornith the facts it can't derive lifts success on
  every non-trivial task, most on the hard in-place case (+80) — exactly where ornith's known
  failure modes (wrong filename, stalls, **in-place token corruption**) fire. On easy tasks
  everything ties: there the method is a pure usability wrapper, and we say so.
- ✅ **Correcting with _facts_ beats correcting with _steps_.** On the hard tasks, arm A's
  round-2 (add grounding) recovered **2/2** failed repeats; arm B2's round-2 (add scaffold)
  recovered **0/2** — extra step-by-step even introduced syntax errors. Small N, but it points
  the way the thesis predicts: don't steal the nest.
- ➖ **Not yet proven:** that the loop beats a single shot, and that minimal beats heavy
  scaffold, in the *final rates* — at K=5 a ±40 delta is ±2 runs (noise). Needs larger K.
- 🔎 **The observability itself already paid off:** the harness caught ornith confabulating
  success, caught the in-place corruption via a byte-guard, and even surfaced a bug in our own
  oracle. You stop trusting a lying model's self-report.

See [`journal/2026-07-08-benchmark-pilot.md`](journal/2026-07-08-benchmark-pilot.md) for the
per-arm breakdown, failure-mode flags, and threats to validity.

## Requirements

- [pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) on `PATH`
- [Ollama](https://ollama.com) running locally with the ornith model built (see below) and
  registered as the `ollama` provider in `~/.pi/agent/models.json`
- Node (v24+)

### The ornith model (use the exact build)

This project is designed around **Ornith 1.0 9B** under pi — but the specific build matters:
**a stock ornith GGUF ships a broken chat template**, and pi (openai-completions provider)
will not drive it correctly. Every result in this repo used a local build named
`ornith-1.0-9b-64k`, made from a chat-template-**fixed** GGUF:

- **Source GGUF:** [`KikoCis/Ornith-1.0-9B-Ollama-fixed-GGUF`](https://huggingface.co/KikoCis/Ornith-1.0-9B-Ollama-fixed-GGUF)
  (~9.5 GB) — patches the chat template baked into the GGUF metadata.
- **Modelfile** (the `-64k` = the 64 K context; low, deterministic sampling for a controller):

  ```
  FROM hf.co/KikoCis/Ornith-1.0-9B-Ollama-fixed-GGUF:latest
  PARAMETER top_p 0.95
  PARAMETER num_ctx 65536
  PARAMETER temperature 1
  ```

  ```bash
  ollama create ornith-1.0-9b-64k -f Modelfile   # build the exact tag orn/bench expect
  ```

`orn` / the benchmark driver also pass `--thinking off` (required — with thinking on, ornith
leaks tool calls into the reasoning channel as unparseable text and nothing executes). Full
provenance and the blob-match verification are in
[`benchmarks/README.md`](benchmarks/README.md#the-executor-model-exact-build).
