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

> **Don't let the Mac sleep.** `run` auto-wraps itself in `caffeinate -i` on macOS for the
> duration (it prints `caffeinate active …`), because an idle sleep mid-sweep truncates the
> in-flight `orn` call into a bogus timeout/no-change fail. If you drive `orn` directly in
> some other long loop, prefix it with `caffeinate -i` yourself.

> **Re-running accumulates — wipe between campaigns.** Each `run` *appends* to
> `results/<task>__<arm>.jsonl` and numbers repeats from 1 on every invocation, while
> `report` groups by repeat number. So running the same `(task, arm)` twice does **not** give
> you `2×K` independent samples: the second run's repeats `1..K` collide with the first's and
> get merged into the same buckets, skewing `pass@1`/`pass@N`. Run each `(task, arm)` once with
> the full `K` you want, and `rm -rf benchmarks/results` before starting a fresh campaign.
> (Corrective rounds are the exception — they add a `--round 2` row for a specific `--repeat`,
> which `report` folds into that repeat's rounds-to-pass.)

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

## Selecting a local verifier (Layer 1)

The same driver can score a **local first-pass verifier model** against the oracle's gold
labels — the experiment specified in [`../docs/VERIFIER.md`](../docs/VERIFIER.md). Add
`--verifier-model <id>` to any `run`: the driver runs the oracle (gold) **and** the verifier
(prediction) on the same workdir, feeding the model a ground-truth evidence packet built from
`../verifier/rubric.md` (test output + diff + changed files + `orn` signals — never ornith's
prose, never the task answer-key). Then read the scores:

```bash
node benchmarks/bench.mjs run --task T3-inplace --arm A --repeats 5 --verifier-model qwen3-coder-14b
node benchmarks/bench.mjs verify-report
```

`verify-report` prints, per model, `agree` / `falsePass` / **`effFP`** / `escalate`, sorted
safest-first. `effFP` (false-pass among auto-accepted passes) is the selection metric — pick
the lightest model with `effFP ≈ 0` at an acceptable escalation rate. See VERIFIER.md for why
false-pass is the only metric that can sink the design.

Dry-run the verifier plumbing without ollama — the fake pi emits a JSON verdict when it sees
a verifier prompt (`FAKE_PI_VERDICT` sets it, default `uncertain`):

```bash
ORN_PI_BIN="$PWD/test/fixtures/fake-pi.js" FAKE_PI_VERDICT=pass \
  node benchmarks/bench.mjs run --task T1-scratch --arm B1 --repeats 1 --verifier-model fake
node benchmarks/bench.mjs verify-report
```

### Fair cross-candidate comparison (decoupled corpus)

To score several candidates on the *same* ornith runs (and run ornith only once), freeze a
corpus in phase 1, then replay each candidate in phase 2:

```bash
rm -rf benchmarks/results benchmarks/corpus
# Phase 1 — build the corpus once (auto-caffeinated on macOS)
node benchmarks/bench.mjs run --task T6-inplace-hard --arm A --repeats 20 --save-corpus benchmarks/corpus/main
node benchmarks/bench.mjs run --task T3-inplace      --arm A --repeats 20 --save-corpus benchmarks/corpus/main
# Phase 2 — replay each candidate over the SAME corpus (no ornith re-run)
for m in qwen3.5:4b qwen3-coder:30b gemma3:4b phi4 llama3.1:8b; do
  node benchmarks/bench.mjs verify-corpus --corpus benchmarks/corpus/main --verifier-model "$m"
done
node benchmarks/bench.mjs verify-report
```

`--save-corpus` and the coupled `--verifier-model` are independent; the corpus is
gitignored/ephemeral (conclusions go in the journal). `verify-corpus` rows are tagged
`source:"corpus"`: `verify-report` includes them, `report` ignores them.
