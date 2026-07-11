# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Orchestrator-selection **scoring skeleton** (`src/orchestrator.js`, unit-tested in
  `test/orchestrator.test.js`; `bench.mjs orchestrate-report`): pure helpers mirroring
  `src/verifier.js` — `parseOrchestratorOutcome` (a `done`/`escalate` reply; unparseable
  defaults to `escalate`, never `done`), `scoreOrchestrator` (per-model
  **`effectiveFalseSuccess` = P(oracle fail | outcome `done`)**, the safety metric, plus
  autonomous-pass and escalation rates, sorted safest-first), and `orchestratorDeltas`
  (per-task pass@N delta vs the Claude baseline). `bench.mjs orchestrate-report
  [--baseline <model>]` prints both tables over `benchmarks/results/*.jsonl`; `bench.mjs
  orchestrate` is an honest stub for the not-yet-built agentic execution driver (a Phase-1
  pilot can populate rows semi-manually, as the verifier campaign did). See
  `docs/ORCHESTRATOR.md` §9.
- Orchestrator-selection design (`docs/ORCHESTRATOR.md`): can the **orchestrator** role (the
  host that runs the `ornith-loop` skill — today Claude) also go **local-first**, like the
  verifier? Companion to `VERIFIER.md`, same falsifiable shape — decomposes the skill's six
  steps by delegability (only grounding recon and corrective-grounding synthesis are genuinely
  model-hard; the rest is already mechanical or delegated), states the falsifiable question
  (O1: a local orchestrator matches Claude's `pass@N` on the frozen suite), and defines the
  metric that can sink it — end-to-end `pass@N`-delta-vs-Claude plus a `false-success` rate
  (how often it declares a broken run done), the orchestrator's analog of the verifier's
  `effectiveFalsePass`. Keeps the two presidia against "three confabulators in a row": the
  Layer-0 oracle as anchor and Claude as the escalation tier. Honest-null "keep Claude as the
  orchestrator" is a valid outcome. No runner built — this doc is the spec.
- Two-tier verification with an optional **local first-pass verifier** (`docs/VERIFIER.md`,
  `verifier/rubric.md`, `src/verifier.js`): Layer 0 stays the mechanical oracle (local, gold
  truth); Layer 1 is an LLM reviewer that can run local-first — a lightweight Ollama model
  adjudicates a ground-truth evidence packet (test output + diff + changed files + `orn`
  signals, never ornith's prose, never the task answer-key) and returns `pass` / `fail` /
  `uncertain`. `pass` is auto-accepted; `fail`/`uncertain` escalate to the Claude audit tier.
- Verifier-selection harness: `bench.mjs run --verifier-model <id>` scores a candidate
  verifier against the oracle on the same run, and `bench.mjs verify-report` prints
  agreement / false-pass / **effective-false-pass** / escalation per model, sorted
  safest-first. `effectiveFalsePass` = P(oracle fail | verdict pass) is the selection metric.
- `ornith-loop` skill step 4 now documents the optional local-first verify flow and points
  at the selection harness.
- `orn run --no-tools` — run pi with all tools disabled (forwards pi's `--no-tools`). Used by
  the Layer-1 verifier so it adjudicates read-only and must return its verdict inline.

### Changed
- `docs/DESIGN.md`: the "no local reviewer model" non-goal is superseded by the two-tier
  model above — explicitly not a cost change (cost/speed remain non-goals; the
  executor↔verifier model-swap cost is accepted); the escalate-on-doubt rule preserves the
  independent check a lone local judge would lose, given a local reviewer has been observed
  to confabulate.

### Fixed
- Verifier ran unsandboxed: `bench.mjs` invoked the Layer-1 verifier via `orn` with no
  `--workdir`, so pi executed in the repo cwd with write tools live. A tool-eager verifier
  (`qwen3-coder:30b`) wrote its verdict to a file instead of replying, which both polluted
  the working tree and scored as an unparseable reply → silent `uncertain`, confounding its
  escalation rate. The verifier call now passes `--no-tools`, forcing a read-only inline
  verdict. (See `journal/2026-07-10-verifier-selection.md`.)

## [0.3.0] - 2026-07-08

### Added
- Benchmark design (`docs/BENCHMARK.md`): a controlled experiment that measures whether the
  `ornith-loop` method lifts a self-scaffolding model's task **success rate** (not cost) —
  four arms (full method vs bare ornith, heavy-scaffold, and single-shot) testing the
  "don't steal the nest" / wrapper-value / loop-value hypotheses, a failure-mode-exercising
  task suite with machine-checkable oracles, repeat-based metrics, and a pre-committed
  honest-null clause that lets "usability wrapper, not performance multiplier" be a
  publishable conclusion.
- Benchmark pilot harness (`benchmarks/`, Phase 1 of the design): a `bench.mjs` driver that
  restores a task fixture git-clean, assembles each arm's prompt mechanically, invokes
  `orn run`, scores with the task's `oracle.mjs` (hard pass/fail over workdir + run-record
  JSON, never agent prose), and aggregates `pass@1`/`pass@N`/rounds-to-pass and the H1/H2/H3
  deltas; three fixtures spanning the edit modes (`T1-scratch`, `T2-additive`, `T3-inplace`,
  the last targeting ornith's in-place corruption mode) each with a verified oracle; and a
  local runbook (`benchmarks/README.md`) — the corrective loop stays agent-driven. Runs on a
  real ollama+pi+ornith workstation, not in a remote container. `src/bench.js` holds the
  pure prompt-assembly/aggregation helpers, unit-tested in `test/bench.test.js`.
- The `npm test` script now scopes discovery to `test/*.test.js` so the benchmark fixtures'
  intentionally-failing baseline tests are not collected into the repo's own suite.
- Benchmark journal template (`journal/README.md`): a multi-run / multi-arm entry shape
  (`journal/YYYY-MM-DD-benchmark-<suite>.md`) that embeds the `bench.mjs report` tables and
  reads the H1/H2/H3 deltas against the pre-committed honest-null clause — since
  `benchmarks/results/` is ephemeral, the numbers live in the journal.
- Two hard benchmark tasks, `T4-additive-hard` (add an operator threaded across two
  coordinated files) and `T6-inplace-hard` (in-place signature refactor across two files with
  a byte-exact corruption guard), added after the pilot saturated on the easy/medium suite so
  H1 (don't-steal-the-nest) and H3 (loop) could actually be exercised; oracles validated
  out-of-band (base-fails / gold-passes / corrupted-or-unscoped-fail) and frozen before running.
- `## Benchmark results` section in the README: a compact per-task success-rate table and an
  honest reading — grounding lifts success on every non-trivial task (+80 on in-place-hard),
  correcting with facts beats correcting with steps (2/2 vs 0/2 recovered), while loop and
  heavy-scaffold rate deltas stay noise-bound at K=5.
- Pilot results recorded in `journal/2026-07-08-benchmark-pilot.md` (T1–T3 plus the T4/T6
  hard extension), including the corrective-round finding and a data-integrity incident note.

### Fixed
- Benchmark driver wrote each run's `orn` records to `.bench-runs/` inside the task workdir,
  so every scope-checking oracle counted that directory as a stray changed file and failed the
  run (a false 0/20 on `T1-scratch` despite byte-exact output). Run records now go to a temp
  dir outside the workdir and are cleaned up alongside it.
- `src/bench.js` used a literal NUL byte as the `aggregate()` grouping-key separator, which
  made git treat the whole driver-helper file as binary (hidden from diffs/PR review). Replaced
  with a space.
- Benchmark driver matched the run-record path with an unanchored `record:` regex, so model
  output containing the substring `record:` (printed in `final text:` before the real
  `record: <path>` line) could hijack the match and null out the run record — losing the
  flags/tool-sequence/exit observability the benchmark exists to collect. Anchored the match to
  the start of a line and reused the parsed path.

### Removed
- The `Repo layout` section from the README (low signal; the design doc and directory names
  carry it).

### Changed
- Project license changed from MIT to Apache-2.0 (`LICENSE`, the `license` field in
  `package.json`, and the `ornith-loop` skill frontmatter).

## [0.2.0] - 2026-07-07

### Added
- Cross-harness skill support: the single `ornith-loop` `SKILL.md` now runs under both
  Claude Code and opencode (the executing agent is the reviewer, using its own model), and a
  new `orn install-skill [--target auto|claude|opencode]` command installs it into the
  detected harness(es). Replaces `scripts/install-skill.sh`.

## [0.1.0] - 2026-07-07

### Added
- `orn` CLI: invokes pi against the local Ollama provider with the empirically-required
  defaults (`--thinking off`, `--mode json`), a Node kill-timer timeout, and env
  passthrough; parses pi's JSONL event stream into an observability summary (self-built
  tool sequence, thinking-block count, final text) with heuristic failure-mode flags
  (tool-call-as-text, stopped-before-tool-call, claimed-done, claimed-done-no-change) and
  an optional git workdir snapshot. Writes a `schemaVersion: 1` run record + raw log under
  `runs/`.
- `ornith-loop` Claude Code skill (`skill/ornith-loop/SKILL.md`) encoding the method
  (grounding → minimal-scaffold prompt → run → external verification → bounded corrective
  loop → journal), plus `scripts/install-skill.sh` to install it into `~/.claude/skills/`.
- Experiment journal format (`journal/README.md`): self-contained per-run Markdown entries.
- Initial design and rationale (`docs/DESIGN.md`): the "why pi + ornith" thesis, the
  grounding-vs-scaffold-vs-verification distinction, and the three-component architecture
  (`orn` CLI, `ornith-loop` skill, experiment journal).
- Project documentation: `README.md`, `CHANGELOG.md`, `CLAUDE.md`.

[Unreleased]: https://github.com/giuseppeoncia/ornith-loop/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/giuseppeoncia/ornith-loop/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/giuseppeoncia/ornith-loop/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/giuseppeoncia/ornith-loop/releases/tag/v0.1.0
