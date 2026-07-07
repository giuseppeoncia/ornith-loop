# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/giuseppeoncia/ornith-loop/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/giuseppeoncia/ornith-loop/releases/tag/v0.1.0
