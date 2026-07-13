# orchestrator-selection (candidate sweep, complete) — 2026-07-12

Second entry for the orchestrator-selection campaign (`docs/ORCHESTRATOR.md`). The
[first entry](2026-07-12-orchestrator-selection.md) established the **Claude-in-seat baseline**
and validated `orchestrate-report` on hand-recorded rows. This entry is the run of the
**agentic `bench.mjs orchestrate` driver** (M1) against **real ollama**, putting *candidate
local models* in the orchestrator seat. Started partial (env killed long background jobs);
**completed 2026-07-12 21:37** in a session where the sweep survived (see the run-durability
note under Threats).

- **Host / machine:** Mac17,8, 48 GB unified memory; ollama 0.31.2 + pi 0.80.3, Node v24.16.0
- **Executor:** `ornith-1.0-9b-64k` (~9.5 GB), `--thinking off` — the exact local build (KikoCis
  chat-template-fixed GGUF + `top_p 0.95` / `num_ctx 65536` / `temperature 1`); see
  `benchmarks/README.md` → "The executor model (exact build)".
- **Layer-1 verifier (separate model, presidium §4):** `qwen3.5:4b` (~3.4 GB)
- **Tasks:** `T6-inplace-hard`, `T4-additive-hard` (the hard tasks §7.3 names)
- **Repeats (K):** 5 per (candidate, task), no pinned seed; corrective budget 3 rounds
- **Candidates:** `qwen3:8b`, `gemma4:e4b`, `gemma4:12b`, `qwen3:14b`, `llama3.1:8b` (§8 shortlist)
- **Scoring:** Layer-0 oracle on the final workdir (never shown to the candidate); rows via
  the schema in `ORCHESTRATOR.md §9`. `bench.mjs orchestrate` default recon is **fixed** (M1):
  round-1 grounding = the frozen `grounding.md`, so the pass@N delta isolates the loop.

## Milestone: the driver runs end-to-end on real ollama

`bench.mjs orchestrate` had only been dry-run against the `fake-pi` fixture before this
campaign. Here it ran for real: per (task, repeat) it drives `ornith` (executor) → gathers
evidence → `qwen3.5:4b` (verifier) → the **candidate** model's `done`/`retry`/`escalate`
decision → Layer-0 oracle. All three model roles co-resided on 48 GB (no weight-swap).

## Results — complete sweep (`node benchmarks/bench.mjs orchestrate-report`)

Five candidates + the Claude baseline, K=5 on each of two tasks (n=10 per model).

```
model                          n  autoPass  falseSucc  effFS  escalate
claude                        10   100%      0%     0%     0%     (baseline, entry 1)
llama3.1:8b                   10   100%      0%     0%     0%
qwen3:14b                     10   100%      0%     0%     0%
gemma4:e4b                    10    90%      0%     0%    10%
qwen3:8b                      10    90%      0%     0%    10%
gemma4:12b                    10    80%      0%     0%    20%

Per-task pass@N delta vs baseline 'claude'   (passN counts a repeat only if the loop
                                              self-finished 'done' AND the oracle confirmed;
                                              an escalate is NOT counted — it routes to Claude)
task              model        passN  baseN  delta
T4-additive-hard  gemma4:12b    60%    100%   -40%
T4-additive-hard  gemma4:e4b   100%    100%    0%
T4-additive-hard  llama3.1:8b  100%    100%    0%
T4-additive-hard  qwen3:14b    100%    100%    0%
T4-additive-hard  qwen3:8b     100%    100%    0%
T6-inplace-hard   gemma4:12b   100%    100%    0%
T6-inplace-hard   gemma4:e4b    80%    100%   -20%
T6-inplace-hard   llama3.1:8b  100%    100%    0%
T6-inplace-hard   qwen3:14b    100%    100%    0%
T6-inplace-hard   qwen3:8b      80%    100%   -20%
```

**The headline: `effFS = 0 % for every candidate.`** Not one of the five local models ever
shipped a broken run as `done`. The falsifiable safety question — "can a local model own the
loop without rubber-stamping a failure?" — is answered **yes** across the shortlist. Every
negative delta above is an *escalation to the Claude audit tier*, not a shipped failure.

### Per-repeat detail (oracle gold label, not agent prose)

`outcome·round·oracle` per repeat. `done` = loop self-finished; `escalate` = routed to Claude.

```
                 T4-additive-hard                              T6-inplace-hard
claude       k1 done·r1·P k2 done·r1·P k3 done·r1·P     k1 done·r1·P k2 done·r1·P k3 done·r2·P
             k4 done·r2·P k5 done·r1·P                  k4 done·r1·P k5 done·r1·P
llama3.1:8b  k1 done·r1·P k2 done·r1·P k3 done·r1·P     k1 done·r2·P k2 done·r2·P k3 done·r2·P
             k4 done·r1·P k5 done·r1·P                  k4 done·r1·P k5 done·r1·P
qwen3:14b    k1 done·r1·P k2 done·r1·P k3 done·r1·P     k1 done·r1·P k2 done·r1·P k3 done·r2·P
             k4 done·r1·P k5 done·r3·P                  k4 done·r1·P k5 done·r1·P
gemma4:e4b   k1 done·r1·P k2 done·r1·P k3 done·r2·P     k1 done·r1·P k2 done·r1·P k3 done·r1·P
             k4 done·r1·P k5 done·r1·P                  k4 ESCALATE·r1·fail  k5 done·r2·P
qwen3:8b     k1 done·r1·P k2 done·r1·P k3 done·r1·P     k1 done·r1·P k2 done·r2·P k3 done·r1·P
             k4 done·r3·P k5 done·r1·P                  k4 done·r1·P k5 ESCALATE·r1·PASS
gemma4:12b   k1 ESCALATE·r1·PASS k2 done·r1·P           k1 done·r1·P k2 done·r1·P k3 done·r1·P
             k3 done·r1·P k4 ESCALATE·r3·fail k5 done·r2·P   k4 done·r1·P k5 done·r1·P
```

**The four escalations, by kind** (the whole point of `effFS`):

- **Correct refusals** (genuine failure the loop declined to ship — the *valuable* escalation):
  - `gemma4:e4b` T6-k4 (r1): caught the **corrupt-green mode** — its reason: *"`roundCents`
    failed critically … structural code corruption (body deleted/replaced with pseudocode)."*
    This is exactly the in-place-edit failure the suite is built to expose, refused at round 1.
  - `gemma4:12b` T4-k4 (r3): *"model failed to implement the registration in `src/registry.mjs`
    despite explicit grounding, and the retry budget (3 of 3) is reached"* → refuse, don't ship.
- **Over-caution** (a run the oracle actually passed, escalated anyway — the *cheap* error):
  - `qwen3:8b` T6-k5 (r1): deferred to the verifier's `uncertain` — *"escalating ensures Claude
    can re-evaluate … for definitive confirmation."*
  - `gemma4:12b` T4-k1 (r1): deferred to a noisy verifier `fail` (timeout/corruption flag) it
    couldn't resolve with one grounding fact.

Corrective loops that recovered (multi-round `done`, all oracle PASS) landed for every model —
e.g. `llama3.1:8b` needed round 2 on T6 k1/k2/k3 and recovered all three; `qwen3:8b`/`qwen3:14b`
each fixed a run at round 3 on T4. `done` reasons cite the real evidence (test exit 0, exactly
the in-scope files changed, `roundCents` intact), not rubber-stamps.

## Reading — per candidate

- **`qwen3:14b` and `llama3.1:8b` are the standout local orchestrators — they match Claude
  exactly** (100 % autoPass, 0 % escalate, effFS 0 on both tasks). Notably **`llama3.1:8b` is
  the smallest model tested (~4.9 GB)** and still perfect; it simply took more corrective rounds
  (3/5 of its T6 repeats needed round 2) and recovered every one. Restraint + a working loop,
  not size, is what the seat needs — consistent with the verifier finding.
- **`qwen3:8b` (complete since the first partial run): 90 % autoPass, effFS 0.** Matches Claude
  on T4; −20 % on T6 from a single *over-cautious* escalation of a run the oracle passed. Safe,
  slightly Claude-hungry.
- **`gemma4:e4b`: 90 % autoPass, effFS 0** — and its one escalation is the *good* kind (caught
  the genuine `roundCents` corruption). The "Gemma is a weak tool-caller" caution does not bite
  the inline `--no-tools` M1 seat; calibration, not function-calling, is what M1 needs (§8).
- **`gemma4:12b`: the weakest, 80 % autoPass / 20 % escalate — yet still effFS 0.** Perfect on
  T6 (5/5 done·r1) but −40 % on T4, where it escalated 2/5 (one correct on a genuine fail, one
  over-cautious on a verifier false-alarm). Striking: the **larger** Gemma is *more* cautious and
  *less* autonomous than the smaller `gemma4:e4b` — size did not help calibration here.

**Ranking (lightest safe → most Claude-load), all effFS 0:** `llama3.1:8b` ≈ `qwen3:14b`
(perfect) > `gemma4:e4b` ≈ `qwen3:8b` (one escalation each) > `gemma4:12b` (two escalations).
`llama3.1:8b` is the value pick (smallest, perfect); `qwen3:14b` the safe pick if a larger
model is wanted.

## Threats / caveats

- **Run durability (the blocker from the partial run, now solved).** The earlier attempt died
  because long background jobs were reaped ~1–2 min after launch. This session ran the sweep as
  a **daemon in its own session/process group** (Python double-fork + `setsid`, orphaned to
  launchd, wrapped in `caffeinate -i`), so a process-group-targeted reap could not reach it. It
  ran ~2.5 h unattended to completion. Use this pattern for any future long sweep here.
- **First-hour I/O contention (benign).** The two missing models (`qwen3:14b`, `llama3.1:8b`)
  were pulled in parallel while the gemma runs executed; disk thrash made the first repeat take
  ~13 min. Throughput recovered to ~1–2 min/repeat once pulls finished. No rows affected (each
  repeat is scored only on its own final workdir).
- **K=5, no pinned seed** — rates carry ±~2-runs variance (per BENCHMARK.md). The −20 %/−40 %
  deltas are 1–2 escalations, within noise; the robust finding is the *ordering* and effFS=0.
- **passN penalises escalation by construction.** A repeat counts as pass@N only if the loop
  self-finished; a correct refusal (e.g. gemma4:e4b catching corruption) scores as a non-pass
  even though it's the *right* call. Read passN as "autonomy vs Claude", and effFS as safety —
  they are different axes, and safety is the one that can sink the design.
- Baseline `claude` effFS = 0 is structural (Claude gates `done` on the oracle); the candidates'
  effFS = 0 is the *empirical* result that matters, and it held for all five.

## Status: sweep COMPLETE — next is M2

The M1 candidate sweep (fixed recon, candidate owns the per-round decision) is **done** for the
§8 shortlist; results distilled into `docs/ORCHESTRATOR.md` → "Results — candidate sweep". Rows
live in the gitignored `benchmarks/results/*__orch-*.jsonl` (ephemeral — the tables above and in
`ORCHESTRATOR.md` are the durable record). Reproduce any time with `orchestrate-report`.

**Next: M2 — delegate the *agentic recon*** (deterministic extractors + candidate selects what
to send as round-1 grounding, `ORCHESTRATOR.md §6.2`). M1 held recon fixed to isolate the loop;
M2 tests whether a candidate can also *assemble the grounding*, which is where a weak model is
likeliest to under- or over-feed the executor.
