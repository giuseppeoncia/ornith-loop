# opencode-xharness — 2026-07-07

First cross-harness run: the `ornith-loop` skill driven from **opencode** instead of Claude Code.

- **Host harness / reviewer:** opencode 1.17.9, model `ollama/qwen3.6-35b-a3b-64k` (local) — i.e. the reviewer was opencode's configured model, exactly as intended (reviewer = the starting harness's model, by construction).
- **Driven model:** ornith-1.0-9b-64k (via `orn` → pi → ollama).
- **Task (goal given to ornith):** create `hello-opencode.txt` containing exactly the single line `hi from ornith via opencode`.
- **Grounding supplied:** absolute `--workdir`; otherwise minimal (write-from-scratch).
- **Install:** `orn install-skill --target opencode` → symlink at `~/.config/opencode/skills/ornith-loop`; opencode discovered it and invoked it via its native `skill` tool.

## What the self-scaffold did (orn run record — ground truth)
- Exit: completed, stopReason `stop`.
- Tool sequence (7): write → read → bash → bash → write → bash → bash — ornith wrote, re-read, and shelled out to check its work several times (a richer self-built scaffold than the inaugural smoke run's `write → read`).
- Thinking blocks: 8.
- Flags: all false (no `tool-call-as-text`, no `stopped-before-tool-call`, no `claimed-done*`). `workdirChange.changed = true`.

## How opencode used the skill (from the run log)
opencode(qwen) called its `skill` tool → loaded `ornith-loop` → `which orn` (resolved) → ran
`orn run "<goal>" --workdir <scratch> --label opencode-xharness --timeout 300` → then `read` the
file to verify externally. It followed the method (minimal grounding, run via orn, external
verification) without being told the steps — the skill's instructions carried across the host.

## External verification (Claude, above the host)
- How verified: read the actual file and the `orn` run-record JSON directly (not the host agent's narration). `cat` + `xxd` on `hello-opencode.txt`; `git status` on the scratch repo.
- Verdict: **pass**. File is exactly `hi from ornith via opencode` (27 bytes, hexdump `…6f70 656e 636f 6465`, no trailing newline as the "single line" task implied); `git status` shows `?? hello-opencode.txt`.

## Corrective rounds
- None — succeeded on the first round.

## Notes / lessons (grounding for next time)
- **Cross-harness works end to end.** A single `SKILL.md` (installed via `orn install-skill`) loaded and ran under opencode; `orn`/`pi`/ornith behaved identically; the reviewer was opencode's own model. No host-specific changes to the skill were needed.
- **The host/reviewer can confabulate too — verify above it.** opencode(qwen)'s final narration claimed `orn` reported `stopped-before-tool-call` and `claimed-done-no-change`. The actual run record contradicts this flatly (7 executed tool calls, `changed = true`, all flags false). ornith succeeded cleanly; the *reviewer* misreported the observability summary. This is the "never trust the self-report" principle one level up: external verification must sit above even the reviewing harness, not just above ornith. It also argues for keeping the machine-readable run record (JSON) as the source of truth, never the agent's prose recap of it.
- **qwen-35b is a capable driver.** As a host agent it correctly selected the skill from its description, resolved and invoked `orn`, and performed an external read — a good reviewer-side counterpart to ornith.
