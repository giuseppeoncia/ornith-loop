# orchestrator-selection (candidate sweep, partial) — 2026-07-12

Second entry for the orchestrator-selection campaign (`docs/ORCHESTRATOR.md`). The
[first entry](2026-07-12-orchestrator-selection.md) established the **Claude-in-seat baseline**
and validated `orchestrate-report` on hand-recorded rows. This entry is the first run of the
**agentic `bench.mjs orchestrate` driver** (M1, built this day) against **real ollama**, putting
*candidate local models* in the orchestrator seat.

- **Host / machine:** Mac17,8, 48 GB unified memory; ollama 0.31.2 + pi 0.80.3, Node v24.16.0
- **Executor:** `ornith-1.0-9b-64k` (~9.5 GB), `--thinking off`
- **Layer-1 verifier (separate model, presidium §4):** `qwen3.5:4b` (~3.4 GB)
- **Tasks:** `T6-inplace-hard`, `T4-additive-hard` (the hard tasks §7.3 names)
- **Repeats (K):** 5 per (candidate, task), no pinned seed; corrective budget 3 rounds
- **Scoring:** Layer-0 oracle on the final workdir (never shown to the candidate); rows via
  the schema in `ORCHESTRATOR.md §9`. `bench.mjs orchestrate` default recon is **fixed** (M1):
  round-1 grounding = the frozen `grounding.md`, so the pass@N delta isolates the loop.

## Milestone: the driver runs end-to-end on real ollama

Until today `bench.mjs orchestrate` had only been dry-run against the `fake-pi` fixture. This
is its first real run: per (task, repeat) it drives `ornith` (executor) → gathers evidence →
`qwen3.5:4b` (verifier) → the **candidate** model's `done`/`retry`/`escalate` decision →
Layer-0 oracle. All three model roles co-resided on 48 GB (no weight-swap). Confirmed working.

## Results (`node benchmarks/bench.mjs orchestrate-report`)

```
model                          n  autoPass  falseSucc  effFS  escalate
claude                        10   100%      0%     0%     0%     (baseline, entry 1)
qwen3:8b                      10    90%      0%     0%    10%     (COMPLETE: T6 + T4, K=5)
gemma4:e4b                     3   100%      0%     0%     0%     (PARTIAL: T6 only, 3/5)

Per-task pass@N delta vs baseline 'claude'
task              model        passN  baseN  delta
T4-additive-hard  qwen3:8b      100%   100%    0%
T6-inplace-hard   qwen3:8b       80%   100%  -20%
T6-inplace-hard   gemma4:e4b    100%   100%    0%   (n=3, partial)
```

### Per-repeat detail (oracle gold label, not agent prose)

`qwen3:8b` — **T6:** k1 done·r1·PASS, k2 done·**r2**·PASS (corrective round worked), k3 done·r1·PASS,
k4 done·r1·PASS, k5 **escalate**·r1·(oracle PASS). **T4:** k1–k3 done·r1·PASS, k4 done·**r3**·PASS,
k5 done·r1·PASS.

`gemma4:e4b` — **T6:** k1–k3 done·r1·PASS (k4, k5 not run — see below).

## Reading

- **`qwen3:8b` is a promising local orchestrator.** `effFS = 0` (never shipped a broken run as
  done) — the safety bar holds. It **matches Claude on T4 (Δ 0)** and lands **−20 % on T6**, and
  that single miss is the *cheap* error, not the fatal one: T6-k5 it **escalated a run the oracle
  actually passed** (over-caution → a Claude audit, not a shipped failure). Its corrective loop
  works (T6-k2 fixed at round 2; T4-k4 at round 3), and its `done` reasons cite the real evidence
  (test exit, in-scope diff, `roundCents` intact) rather than rubber-stamping. At K=5 this is
  within the "±2 runs" noise of the baseline on T6.
- **`gemma4:e4b`: the "Gemma is a weak tool-caller" caution does not bite the inline M1 role, so
  far.** 3/3 done·PASS on T6, effFS 0 — consistent with §8's thesis that the M1 seat (a
  `--no-tools` inline decision) needs *calibration*, not function-calling. Too few rows to
  conclude; must be completed.

## Threats / caveats

- **The sweep is INCOMPLETE.** The local ollama compute sweep could not finish in this session:
  long background jobs were **killed ~1–2 min after launch** by the environment (the first few
  completed; later ones died — see the run log). Only `qwen3:8b` (K=5, both tasks) is complete.
- **K=5, no pinned seed** — rates carry ±2-runs variance; `gemma4:e4b` at n=3 is indicative only.
- Baseline `claude` effFS = 0 is structural (Claude gates `done` on the oracle); the candidates'
  effFS = 0 here is the *empirical* result that matters, and it held for both.

## Resume plan (what remains + exact commands)

Models pulled and ready: `qwen3:8b` ✓, `gemma4:e4b` ✓, `gemma4:12b` ✓.
Still to pull: `qwen3:14b`, `llama3.1:8b` (see `ORCHESTRATOR.md §8`).

Rows live in the gitignored `benchmarks/results/` (ephemeral — the numbers above are the record).
Because rows are **append-only per (candidate, task)**, avoid duplicates on resume:

```bash
# gemma4:e4b — T6 has k1-k3 already; add only the missing repeats, then all of T4:
node benchmarks/bench.mjs orchestrate --task T6-inplace-hard --orchestrator-model gemma4:e4b --repeat 4
node benchmarks/bench.mjs orchestrate --task T6-inplace-hard --orchestrator-model gemma4:e4b --repeat 5
node benchmarks/bench.mjs orchestrate --task T4-additive-hard --orchestrator-model gemma4:e4b --repeats 5

# fresh candidates (no rows yet) — full K=5 both tasks each:
for m in gemma4:12b qwen3:14b llama3.1:8b; do
  for t in T6-inplace-hard T4-additive-hard; do
    node benchmarks/bench.mjs orchestrate --task "$t" --orchestrator-model "$m" --repeats 5
  done
done
node benchmarks/bench.mjs orchestrate-report
```

If a (candidate, task) file ends up with a wrong count after an interrupted run, delete just that
`benchmarks/results/<task>__orch-<slug>.jsonl` and re-run its K=5. Run on a session where long
jobs survive (the driver auto-`caffeinate`s; the blocker here was background-task reaping, not sleep).
