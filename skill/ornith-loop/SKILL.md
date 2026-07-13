---
name: ornith-loop
description: Use when driving a self-scaffolding local model (ornith 1.0 first) under the pi harness via the `orn` CLI — gather grounding, author a MINIMAL-scaffold prompt, run, verify externally, loop with more grounding (not scaffold), and journal. Use for "run this task on ornith", "have the local model do X", or comparing local models under pi.
license: Apache-2.0
version: 0.4.0
---

# ornith-loop

Drive a self-scaffolding local model with the `orn` CLI. **The one rule: do not steal
ornith's nest.** Supply *grounding* (facts it can't derive) and *verification*; never
supply *reasoning scaffold* (plans, step-by-step micro-tasks, tool sequences).

Host-agnostic: run this from any coding agent (Claude Code, opencode, …). Whichever agent
executes these steps **is** the external reviewer — it does the verification with its own
model. `orn` and `pi` behave identically on every host.

## Distinguish three kinds of help
- **Reasoning scaffold** (plan, sequence, recovery) → ornith's job. NEVER provide it.
- **Grounding** (real paths, versions, routes, selectors, conventions) → you provide it.
- **Verification & observability** → your job.

## Method (follow in order)

1. **Grounding recon.** Explore the target repo for the facts ornith cannot know: exact
   paths, framework versions, routes/endpoints, selectors, naming conventions, the build/
   test command. Do NOT design the solution.
2. **Author a minimal-scaffold prompt.** Give the *goal* + the *grounding*, then stop.
   No numbered steps, no "first do X then Y", no tool-call sequence. Prefer tasks that are
   **write-from-scratch or additive** — ornith corrupts in-place edits (token-level
   dropped/added spaces, wrong casing).
3. **Run via `orn`:**
   `orn run "<goal + grounding>" --workdir <target-repo> --label <short-name>`
   (defaults: model `ornith-1.0-9b-64k`, `--thinking off`, 900s timeout). Use
   `--prompt-file` for long prompts. Read the printed summary and the `runs/<id>.json`.
   `orn run` uses your configured executor model (`orn config get executor.model`,
   default `ornith-1.0-9b-64k`) unless you pass `--model`.
4. **Verify externally — always.** Never trust ornith's self-report; it confabulates
   success. Run the build/tests, inspect the diff, render output. Cross-check the summary
   flags: `claimed-done-no-change` = it said done but the workdir is untouched;
   `tool-call-as-text` = its call leaked into the reasoning channel (a `--thinking off`
   regression); `stopped-before-tool-call` = it stalled before acting.

   *Optional two-tier verify (local-first, configurable).* If a local verifier is configured
   (`orn config get verifier.enabled` → `true`), offload the first pass to it instead of
   judging every run yourself: `orn verify --workdir <repo> --test-cmd "<test command>"`
   prints `pass` / `fail` / `uncertain`. **Accept a `pass`; audit `fail` and `uncertain`
   yourself** — the Layer-0 mechanical checks stay the anchor of truth, and a model verdict
   never overrides a red test or an out-of-scope diff. If no verifier is configured (the
   default), verify the run yourself. Enable/choose one with `orn config set verifier.enabled
   true` / `orn config set verifier.model <id>`; pick the model empirically with
   `benchmarks/bench.mjs verify-report` (see [`docs/VERIFIER.md`](../../docs/VERIFIER.md)) —
   the metric that matters is its **false-pass rate**, since ornith already confabulates.
5. **Corrective round (bounded — `orn config get correctiveRounds`, default 3).** Add
   *grounding* the run revealed was missing — never scaffold. If it stalls narrating "now
   I'll do X", the task is likely too big: shrink the goal, keep it additive. After N
   rounds still failing, STOP and report the failure mode rather than spoon-feeding steps.
6. **Journal.** Write `journal/YYYY-MM-DD-<label>.md` using the template in
   `journal/README.md`, embedding the run summary and your verification verdict.

## Guardrails (grounding you always carry)
- `--thinking off` is required; thinking-on leaks tool calls as text.
- Prefer write-from-scratch / additive edits; verify diffs on any edit.
- Keep tasks short — ornith stalls before the last step.
