# ornith-loop — Roadmap & session handoff

_Single source for "what's done, what's next, and how to resume." The other tracks used to
live scattered across journal entries and doc sections; this consolidates them._

The next steps need a real **ollama + pi + ornith** stack (a local workstation, e.g. the
48 GB Mac), not a remote Claude container. This page is the "start here" for a fresh session
there.

## Status

| Piece | State |
|---|---|
| Method + three-role design (`DESIGN.md`) | done |
| Benchmark suite + oracles + driver (`BENCHMARK.md`, `benchmarks/`) | done — pilot run (K=5) + K=20 |
| Layer-1 local **verifier** selection (`VERIFIER.md`) | `qwen3.5:4b` **confirmed** at K=20 (effFP=0%); follow-ups open |
| **Orchestrator** design (`ORCHESTRATOR.md`) | done |
| Orchestrator **scoring skeleton** (`src/orchestrator.js`, `orchestrate-report`) | done, unit-tested |
| Orchestrator **agentic execution driver** (`bench.mjs orchestrate`) | **not built** (honest stub) |

All of the above is committed and pushed to
`origin/claude/lightweight-orchestrator-analysis-v9m7kc`.

## How to resume in a new session on the Mac

```bash
git fetch origin claude/lightweight-orchestrator-analysis-v9m7kc
git checkout claude/lightweight-orchestrator-analysis-v9m7kc
git pull origin claude/lightweight-orchestrator-analysis-v9m7kc
npm ci && npm test          # expect green (69 tests)
```

Prerequisites (see `benchmarks/README.md` for detail):

- **Ollama** running; models pulled (`ornith-1.0-9b-64k` executor, `qwen3.5:4b` verifier).
- **`pi`** on `PATH` (or `ORN_PI_BIN=/path/to/pi`); the `ollama` provider registered in
  `~/.pi/agent/models.json`; **Node ≥ 24**.
- Sanity check before anything: `orn run "say hi" --timeout 60` should write a run record.
- Long runs auto-`caffeinate` on macOS; don't let the Mac idle-sleep mid-sweep (it truncates
  the in-flight `orn` call into a bogus timeout — see `journal/2026-07-10-verifier-selection.md`).

**Kickoff prompt to paste into the new session:**

> Continua il lavoro di ornith-loop sul branch `claude/lightweight-orchestrator-analysis-v9m7kc`.
> Leggi `docs/ROADMAP.md`, `docs/ORCHESTRATOR.md` e la sezione "Selecting a local orchestrator"
> di `benchmarks/README.md`. Parti dalla traccia 1 della roadmap: il pilot semi-manuale
> dell'orchestratore — stabilisci le righe baseline (Claude-in-seat) su `T6-inplace-hard` e
> `T4-additive-hard`, valida `bench.mjs orchestrate-report`, poi passa alla traccia 2.
> Ollama e i modelli sono locali su questa macchina.

## Prioritized roadmap

### 1 · NOW — semi-manual orchestrator Phase-1 pilot
Get the first *real* orchestrator data and validate the scoring end-to-end, the same way the
benchmark and verifier campaigns started (semi-manual before automation).

- **Baseline (Claude-in-seat):** the session itself drives the real ornith-loop (recon →
  minimal-scaffold prompt → `orn run` → verify → bounded corrective loop) on
  `T6-inplace-hard` and `T4-additive-hard`, and records one row per (task, repeat) with
  `orchestratorModel: "claude"`, its terminal `outcome` (`done`/`escalate`), and the oracle
  gold `pass`. This establishes the reference and exercises `orchestrate-report`.
- **Candidate half:** either (a) the **narrowed / pre-computed** path — feed a candidate a
  hand-built recon or failure packet (verifier-style, per `ORCHESTRATOR.md §5.3`) and record
  its decision, testable now; or (b) wait for track 2's driver for the full autonomous loop.
- **Metric:** `effectiveFalseSuccess` (≈0 is the safety bar) + per-task pass@N delta vs the
  Claude baseline.
- **Detail / commands:** `benchmarks/README.md` → "Selecting a local orchestrator".
- **Deliverable:** distil into `journal/YYYY-MM-DD-orchestrator-selection.md`.

### 2 · NEXT — build the agentic `orchestrate` execution driver
The missing `bench.mjs orchestrate` command: put a candidate **local** model in the
orchestrator seat and run it through the whole ornith-loop autonomously, emitting one scoring
row per (task, repeat). This is what unlocks candidate evaluation at scale (K repeats over the
suite). Spec: `ORCHESTRATOR.md §7` (protocol) and §9 (the row schema it must emit). Status:
**not started** — needs iterative testing against ollama, hence the Mac.

### 3 · PARALLEL — verifier follow-ups (independent of the orchestrator work)
Already annotated in `journal/2026-07-10-verifier-selection.md` ("Recommended next steps" /
"Still open"); consolidated here so they aren't lost:

- ~~**Decouple executions:**~~ **done** (merged from `develop`) — `run --save-corpus <dir>`
  freezes each run's evidence + gold label, and `verify-corpus --corpus <dir> --verifier-model
  <id>` replays any candidate over that identical frozen corpus (ornith executed once). Rows
  tag `source:"corpus"`. See `benchmarks/README.md` → "Fair cross-candidate comparison".
- **Cross-family lightweight sweep:** score gemma3 / phi4 / llama3.1 (validated to co-reside
  with the executor) as first-pass verifiers, suite + rubric unchanged.
- **Fix `docs/VERIFIER.md` shortlist sizes:** drop the wrong ~16 GB claim for
  `qwen3-coder-next` (it is 48 GB) and the nonexistent `qwen3-coder-14b`; note `:30b` as the
  real light-coder tag.

## Candidate orchestrator models (validate, don't assume)

Want a **~4–14 B disciplined tools-capable _instruct_** model — calibration/restraint over
size (`ORCHESTRATOR.md §5`), **not** a tool-happy coder model. `qwen3.5:4b` is already local
(the verifier). Cross-family options already flagged as co-resident on 48 GB: gemma3 / phi4 /
llama3.1. **Validate the ollama manifest size before pulling** — the verifier campaign found
advertised sizes wrong (`qwen3-coder-next` was 48 GB, not ~16 GB; a claimed `qwen3-coder-14b`
tag did not exist).
