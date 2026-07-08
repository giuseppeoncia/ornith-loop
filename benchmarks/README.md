# Benchmark pilot — local runbook

Phase 1 of [`docs/BENCHMARK.md`](../docs/BENCHMARK.md). This directory is **runnable
scaffolding**: the fixtures, oracles, and a driver. It must run on a machine with the real
stack — it is **not** exercisable in a remote Claude container.

## Why this runs locally only

The driver calls `orn run`, which shells out to `pi --provider ollama` against a local
model. That means you need, on your own workstation:

- **Ollama** running, with the target model pulled (default `ornith-1.0-9b-64k`; a larger
  tools-capable model such as `qwen3.6-35b-a3b-64k` is more reliable for comparison).
- **`pi`** on `PATH` (or `ORN_PI_BIN=/path/to/pi`).
- **Node >= 24** and this repo checked out; `orn` resolved from `bin/orn.js`.
- `git` (the driver seeds each run's workdir as a throwaway git repo).

Sanity check before benchmarking: `orn run "say hi" --timeout 60` should produce a run
record. If that works, the driver will.

## What the driver does (and doesn't)

`bench.mjs` owns only the **mechanical, reproducible** layer:
- copies a task's `template/` into a fresh temp workdir and `git commit`s it (clean baseline);
- assembles the arm's prompt *mechanically* from the fixture files (no per-run improvisation);
- runs `orn run` against that workdir;
- scores with the task's `oracle.mjs` — a hard pass/fail over the **workdir + run-record
  JSON**, never any agent's prose;
- appends one row per attempt to `results/<task>__<arm>.jsonl`.

It does **not** invent corrective grounding. The corrective loop (arms A and B2) is a
**judgment** step and belongs to you / the reviewing agent — see below.

## The four arms

| Arm | Prompt | Loop | Tests |
|---|---|---|---|
| `A`  | goal + grounding (minimal) | yes | reference |
| `B1` | goal only | no | H2: A−B1 (wrapper vs nothing) |
| `B2` | goal + grounding + heavy scaffold | yes (adds scaffold) | H1: A−B2 (don't steal the nest) |
| `B3` | goal + grounding (minimal) | no | H3: A−B3 (loop value) |

Prompts are assembled from `tasks/<id>/{goal,grounding,scaffold-heavy}.md`.

## Running the single-shot arms (fully automatic)

B1 and B3 have no loop — run them straight, K repeats each:

```bash
node benchmarks/bench.mjs run --task T1-scratch --arm B1 --repeats 5
node benchmarks/bench.mjs run --task T1-scratch --arm B3 --repeats 5
```

Round 1 of A and B2 is also mechanical — run it the same way:

```bash
node benchmarks/bench.mjs run --task T1-scratch --arm A  --repeats 5   # records round 1
node benchmarks/bench.mjs run --task T1-scratch --arm B2 --repeats 5
```

## Running the corrective rounds (agent-driven)

For any A/B2 repeat that failed round 1, you (or the reviewing agent) inspect the run
record, decide what was missing, and re-run just that repeat at the next round with the
addition in a file:

- **arm A** — add *grounding* the run revealed was missing (a real path, a version, a
  convention). Never steps.
- **arm B2** — add *more scaffold* (more explicit steps). This is the anti-method, played
  straight.

```bash
# repeat 3 of T3-inplace, arm A, round 2, with corrective grounding:
node benchmarks/bench.mjs run --task T3-inplace --arm A --repeat 3 --round 2 --extra corr.md
```

Bounded at 3 rounds (DESIGN.md). After round 3 still failing, stop — that repeat counts as
a non-pass, which is a real datapoint, not a failure to fix.

> This is exactly the grounding-vs-scaffold split the whole project rests on, so keep it
> honest: arm A rounds add facts, arm B2 rounds add steps. Don't let A's corrections drift
> into step-by-step, or B2's into "here's the missing path" — that would blur H1.

## Reading the results

```bash
node benchmarks/bench.mjs report
```

prints per-task×arm `pass@1` / `pass@N` / rounds-to-pass, then the three hypothesis deltas
(A−B1, A−B2, A−B3). Positive = the method helped. Per the honest-null clause in
BENCHMARK.md: if the deltas hover around zero, the conclusion is "usability wrapper, not
performance multiplier" — write that in the journal.

`results/` is gitignored (ephemeral, like `runs/`). Distil each pilot into a
`journal/YYYY-MM-DD-benchmark-*.md` entry — that is the durable deliverable.

## Suggested pilot matrix

3 tasks × 4 arms × K=5 = 60 round-1 runs, plus corrective rounds for A/B2 failures. Start
with `T1-scratch` (expect all arms to tie — it's the control ceiling) to confirm the
plumbing, then `T2-additive`, then `T3-inplace` (where the method should separate from the
controls, if it separates anywhere).

## Dry-run the plumbing without a model

To verify the driver end-to-end without ollama, point it at the test's fake pi (it won't
satisfy the oracles, so every attempt scores `fail` — that's expected; you're testing the
pipeline, not ornith):

```bash
ORN_PI_BIN="$PWD/test/fixtures/fake-pi.js" node benchmarks/bench.mjs run --task T1-scratch --arm B1 --repeats 2
```
