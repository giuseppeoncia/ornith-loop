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
| Configurable local verifier (`orn config` / `orn verify`) | done |
| **Orchestrator** design (`ORCHESTRATOR.md`) | done |
| Orchestrator **scoring skeleton** (`src/orchestrator.js`, `orchestrate-report`) | done, unit-tested |
| Orchestrator **Phase-1 baseline** (Claude-in-seat, `journal/2026-07-12-orchestrator-selection.md`) | done — K=5 on T6+T4: pass@N 100%, effFS 0%; `orchestrate-report` validated |
| Orchestrator **agentic execution driver** (`bench.mjs orchestrate`, M1) | **built + validated on real ollama** (2026-07-12) |
| Orchestrator **candidate sweep** (`journal/2026-07-12-orchestrator-selection-2.md`, `ORCHESTRATOR.md §11`) | **done (M1)** — 5 candidates + Claude baseline, K=5 × T6/T4. **effFS = 0 % for all**; `llama3.1:8b` (~4.9 GB) and `qwen3:14b` match Claude exactly; `gemma4:12b` weakest (80% autoPass). Next: M2 agentic recon |

All of the above is committed and pushed to
`origin/claude/lightweight-orchestrator-analysis-v9m7kc`.

## How to resume in a new session on the Mac

```bash
git fetch origin claude/lightweight-orchestrator-analysis-v9m7kc
git checkout claude/lightweight-orchestrator-analysis-v9m7kc
git pull origin claude/lightweight-orchestrator-analysis-v9m7kc
npm ci && npm test          # expect green (102 tests)
```

Prerequisites (see `benchmarks/README.md` for detail):

- **Ollama** running; models pulled (`ornith-1.0-9b-64k` executor, `qwen3.5:4b` verifier). The
  executor is a **local build**, not an upstream tag: the `KikoCis/Ornith-1.0-9B-Ollama-fixed-GGUF`
  chat-template-fixed GGUF + a Modelfile (`top_p 0.95`, `num_ctx 65536`, `temperature 1`). Exact
  build & provenance: `benchmarks/README.md` → "The executor model (exact build)".
- **`pi`** on `PATH` (or `ORN_PI_BIN=/path/to/pi`); the `ollama` provider registered in
  `~/.pi/agent/models.json`; **Node ≥ 24**.
- Sanity check before anything: `orn run "say hi" --timeout 60` should write a run record.
- Long runs auto-`caffeinate` on macOS; don't let the Mac idle-sleep mid-sweep (it truncates
  the in-flight `orn` call into a bogus timeout — see `journal/2026-07-10-verifier-selection.md`).

**Kickoff prompt to paste into the new session:**

> Continua il lavoro di ornith-loop sul branch `claude/lightweight-orchestrator-analysis-v9m7kc`.
> Leggi `docs/ROADMAP.md`, `docs/ORCHESTRATOR.md` e la sezione "Selecting a local orchestrator"
> di `benchmarks/README.md`. La traccia 1 (baseline Claude-in-seat su `T6`/`T4`) è fatta —
> vedi `journal/2026-07-12-orchestrator-selection.md`. Parti dalla traccia 2: costruisci il
> driver agentico `bench.mjs orchestrate` (spec `ORCHESTRATOR.md §7`/§9) che mette un modello
> locale candidato nel seggio dell'orchestratore e lo fa girare per l'intero ornith-loop,
> emettendo una riga per (task, repeat). Ollama e i modelli sono locali su questa macchina.

## Prioritized roadmap

### 1 · ~~semi-manual orchestrator Phase-1 pilot~~ — baseline DONE (2026-07-12)
Got the first *real* orchestrator data and validated the scoring end-to-end, the same way the
benchmark and verifier campaigns started (semi-manual before automation).

- **Baseline (Claude-in-seat): done.** Claude drove the real ornith-loop (recon →
  minimal-scaffold prompt → `orn run` → oracle verify → bounded corrective loop) on
  `T6-inplace-hard` and `T4-additive-hard`, K=5 each. Result: **pass@N 100 %** on both,
  **effFS 0 %**, escalation 0 %, mean 1.2 corrective rounds (2/10 repeats needed a round 2).
  Rows: `benchmarks/results/{T6-inplace-hard,T4-additive-hard}__orch-claude.jsonl`
  (`orchestratorModel: "claude"`). `orchestrate-report` confirmed to render both the scoring
  rollup and the per-task delta table. Distilled in
  `journal/2026-07-12-orchestrator-selection.md`.
- **Still open — candidate half:** either (a) the **narrowed / pre-computed** path — feed a
  candidate a hand-built recon or failure packet (verifier-style, per `ORCHESTRATOR.md §5.3`)
  and record its decision, testable now; or (b) track 2's driver for the full autonomous loop.
  This is where the delta-vs-claude table (empty at baseline) becomes the headline.
- **Metric:** `effectiveFalseSuccess` (≈0 is the safety bar) + per-task pass@N delta vs the
  Claude baseline.
- **Detail / commands:** `benchmarks/README.md` → "Selecting a local orchestrator".

### 2 · DONE (M1) — candidate sweep with the agentic `orchestrate` driver
The `bench.mjs orchestrate` command (M1: fixed recon, candidate owns the per-round
`done`/`retry`/`escalate` decision + corrective grounding) is **built, unit-tested, and run to
completion on real ollama** (spec `docs/superpowers/specs/2026-07-12-orchestrate-driver-m1-design.md`;
`ORCHESTRATOR.md §7`/§9/§11). **Full sweep done 2026-07-12** — 5 §8 candidates + the Claude
baseline, K=5 × {T6-inplace-hard, T4-additive-hard}. Results (`ORCHESTRATOR.md §11`,
`journal/2026-07-12-orchestrator-selection-2.md`): **`effectiveFalseSuccess = 0 % for every
candidate`** — none shipped a broken run. `llama3.1:8b` (~4.9 GB, smallest) and `qwen3:14b` match
Claude exactly (100 % autoPass, 0 escalate); `gemma4:e4b`/`qwen3:8b` safe at 90 %; `gemma4:12b`
weakest at 80 % (more cautious than the smaller e4b — calibration, not size). Sweep durability
solved by daemonizing (`setsid` + `caffeinate`, own process group) so the reaping that killed the
partial run couldn't reach it.
**Next: M2** — delegate the *agentic recon* (deterministic extractors + candidate selects, §6.2).

### 3 · PARALLEL — verifier follow-ups (independent of the orchestrator work)
Already annotated in `journal/2026-07-10-verifier-selection.md` ("Recommended next steps" /
"Still open"); consolidated here so they aren't lost. Note: the local verifier is now
**configurable, mechanized, and discoverable** — `orn config` / `orn verify` and
`orn install-skill --verifier <model>` (see `VERIFIER.md` → "Production use"); the items
below are about *which model* to pick, not the plumbing to run it.

- ~~**Decouple executions:**~~ **done** (merged from `develop`) — `run --save-corpus <dir>`
  freezes each run's evidence + gold label, and `verify-corpus --corpus <dir> --verifier-model
  <id>` replays any candidate over that identical frozen corpus (ornith executed once). Rows
  tag `source:"corpus"`. See `benchmarks/README.md` → "Fair cross-candidate comparison".
- **Cross-family lightweight sweep:** score current-gen cross-family lightweights as
  first-pass verifiers (suite + rubric unchanged) — see the July-2026-verified shortlist in
  `ORCHESTRATOR.md §8` (`gemma4:e4b-it`, `qwen3:8b`, `llama3.1:8b`); tool-calling is not a
  gate for the verifier's inline `--no-tools` role.
- ~~**Fix `docs/VERIFIER.md` shortlist sizes:**~~ **done** — the shortlist and hardware note
  carry the corrected figures (`qwen3-coder-next` is ~48 GB not ~16 GB, no `qwen3-coder-14b`
  tag, `:30b` is the real light-coder tag); the stale `qwen3-coder-14b` command examples in
  `VERIFIER.md`/`benchmarks/README.md` now use `qwen3-coder:30b`.

## Candidate orchestrator models (validate, don't assume)

Want a **~4–14 B disciplined _instruct_** model — calibration/restraint over size
(`ORCHESTRATOR.md §5`), **not** a tool-happy coder model. Note (per §8): for the M1 seat the
model answers inline (`--no-tools`), so tool-calling is *not* the gate — calibration is; it
only becomes load-bearing at M2 (agentic recon). `qwen3.5:4b` is already local (the verifier).
The July-2026-verified candidate shortlist lives in `ORCHESTRATOR.md §8` (`gemma4:e4b-it` /
`gemma4:12b-it`, `qwen3:8b` / `qwen3:14b`, `llama3.1:8b`). **Validate the ollama manifest size
before pulling** — the verifier campaign found advertised sizes wrong (`qwen3-coder-next` was
48 GB, not ~16 GB; a claimed `qwen3-coder-14b`
tag did not exist).
