# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/giuseppeoncia/ornith-loop/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/giuseppeoncia/ornith-loop/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/giuseppeoncia/ornith-loop/releases/tag/v0.1.0
