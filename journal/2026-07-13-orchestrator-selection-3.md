# orchestrator-selection (M2 — delegated recon) — 2026-07-13

Third entry for the orchestrator-selection campaign (`docs/ORCHESTRATOR.md`). The
[first entry](2026-07-12-orchestrator-selection.md) set the Claude-in-seat baseline; the
[second](2026-07-12-orchestrator-selection-2.md) ran **M1** (fixed recon — the candidate owned
only the per-round loop decision). This entry runs **M2**: the candidate additionally
**assembles its own round-1 grounding** from a deterministic fact-pool, instead of receiving the
hand-authored gold `grounding.md`. Everything after round 1 is the M1 loop, unchanged, so the
**M2 − own-M1 pass@N delta isolates the cost of delegating recon** (spec:
`docs/superpowers/specs/2026-07-12-orchestrate-driver-m2-design.md`).

- **Host / machine:** Mac17,8 (laptop), 48 GB unified memory; ollama + pi 0.80.3, Node v24.16.0
- **Executor:** `ornith-1.0-9b-64k`, `--thinking off` (exact build: `benchmarks/README.md` →
  "The executor model (exact build)")
- **Layer-1 verifier (separate model, presidium §4):** `qwen3.5:4b`
- **Recon (M2):** deterministic extractors (`src/recon.js`) build a fact-pool — test command,
  file tree, `package.json`, goal-token `git grep` hits + the source of the files they hit
  (answer-keys `meta.json`/`oracle.mjs`/`grounding.md` excluded); the candidate assembles
  round-1 grounding from it **inline** (`orn … --no-tools`, `orchestrator/recon-rubric.md`).
- **Tasks:** `T6-inplace-hard`, `T4-additive-hard`. **K = 5**, no pinned seed; corrective budget 3.
- **Candidates:** `llama3.1:8b`, `qwen3:14b`, `gemma4:12b` (the M1 standouts + one weaker, per §11).
- **Software shipped in 0.5.0** — this is the first real M2 run.

## Results (`node benchmarks/bench.mjs orchestrate-report`)

Candidate-assembled recon (M2), n=10 per model, beside the M1 (fixed gold recon) rollup:

```
== recon: candidate (M2) ==            == recon: fixed (M1, same models) ==
model        n  autoPass effFS esc      model        autoPass effFS esc
llama3.1:8b 10   80%      0%   20%       llama3.1:8b   100%     0%    0%
qwen3:14b   10   80%      0%   20%       qwen3:14b     100%     0%    0%
gemma4:12b  10   60%      0%   40%       gemma4:12b     80%     0%   20%
```

**Recon-delegation delta — candidate-M2 pass@N vs the SAME model's fixed-M1 (negative = the cost
of self-assembling recon):**

```
task              model        M2     M1    delta
T4-additive-hard  llama3.1:8b  60%   100%   -40%
T4-additive-hard  qwen3:14b    80%   100%   -20%
T4-additive-hard  gemma4:12b   60%    60%     0%   (gemma was already weak on T4 in M1)
T6-inplace-hard   llama3.1:8b 100%   100%     0%
T6-inplace-hard   qwen3:14b    80%   100%   -20%
T6-inplace-hard   gemma4:12b   60%   100%   -40%
```

**The headline holds again: `effFS = 0 % for every M2 candidate.`** Even when assembling their own
grounding, none of the three ever shipped a broken run as `done`. Delegating recon **lowers
autonomy** (more genuine executor failures, more escalations) but **does not breach the safety
bar** — the two presidia (§4) hold: every miss is an escalation to the Claude audit tier, not a
false success.

### Per-repeat detail (oracle gold label, not agent prose)

`outcome·round·oracle`. `done` = loop self-finished; `escalate` = routed to Claude.

```
                 T4-additive-hard                          T6-inplace-hard
llama3.1:8b  k1 done·r1·P  k2 ESC·r1·fail  k3 done·r1·P  k1 done·r2·P  k2 done·r1·P  k3 done·r3·P
             k4 ESC·r1·fail k5 done·r1·P                 k4 done·r2·P  k5 done·r1·P
qwen3:14b    k1 done·r1·P  k2 ESC·r2·fail  k3 done·r1·P  k1 done·r1·P  k2 done·r2·P  k3 ESC·r3·fail
             k4 done·r1·P  k5 done·r1·P                  k4 done·r1·P  k5 done·r1·P
gemma4:12b   k1 done·r1·P  k2 ESC·r1·fail  k3 ESC·r1·PASS k1 done·r1·P k2 done·r1·P  k3 ESC·r1·fail
             k4 done·r1·P  k5 done·r1·P                  k4 ESC·r1·PASS k5 done·r1·P
```

**The 8 escalations, by kind** (0 false successes, as always):

- **Correct refusals of a genuine failure (6):** llama3.1:8b T4-k2/k4, qwen3:14b T4-k2 & T6-k3,
  gemma4:12b T4-k2 & T6-k3. These are the recon cost made concrete — see below.
- **Over-caution on a passing run (2, the cheap error):** gemma4:12b T4-k3 & T6-k4.

## Reading — why delegated recon costs pass@N

Sampling the candidates' assembled grounding (`reconGrounding`) against the failures explains the
delta — and the causes differ:

- **Thin recon → real failure (the pure delegation cost).** `llama3.1:8b` T4-k2: its
  self-assembled grounding named the test file, the `src/ops.mjs` path, and the test command —
  **but never mentioned that `pow` must be registered in `src/registry.mjs`'s `OPS` map** (the
  second required file, which the gold `grounding.md` states explicitly). The executor
  implemented `pow` but didn't register it → genuine oracle fail → llama escalated. This is
  exactly the size-sensitive sub-task §5.3 predicted: a small model under-specifies the scope,
  and the run fails honestly rather than falsely.
- **Good recon, failure elsewhere → still a safe escalation.** `gemma4:12b` T6-k3 assembled
  *correct* facts (the `withTax` refactor, both call sites, `roundCents` byte-exact) — but the
  executor produced **in-place-corrupted, syntactically broken code** (ornith's known failure
  mode); gemma correctly called it unrecoverable and escalated. `qwen3:14b` T4-k2 also had solid
  grounding but escalated on a Layer-1 verifier `uncertain` (unparseable verdict) — deferring to
  caution. Neither miss is a recon defect; both are the safety valve working.
- **The corrective loop compensates.** `llama3.1:8b` held **100 % on T6** despite self-recon,
  using rounds 2–3 to recover (k1·r2, k3·r3, k4·r2 all → done·PASS): weaker round-1 grounding,
  fixed by the loop it already owns from M1.

**Per candidate:** `llama3.1:8b` and `qwen3:14b` remain the strongest (80 % autonomous under
delegated recon, effFS 0), and llama is untouched on the in-place task. `gemma4:12b` is again the
weakest (60 %), and self-recon widened its T6 gap (−40 %). **The M1 ordering is preserved but
compressed and shifted down** — delegating recon is a real, uniform capability tax (~20 pp of
autonomy on average here), heaviest on **T4-additive**, where the scope ("change *two* files,
register the op") is the fact most often dropped.

## Qualitative finding — format adherence is loose; the parser fallback is load-bearing

Candidates did **not** reliably emit the requested `{ "grounding": "<string>" }`. `llama3.1:8b`
returned `{ "grounding": [<array of fact strings>] }` wrapped in prose ("Here's the grounding…" /
"I've extracted the facts…"); `parseGrounding`'s fallback took the raw body verbatim, and it still
worked. So the JSON-string contract is aspirational — the fallback (strip fences, take the body)
is what actually carries M2. **Follow-up:** either relax the rubric to accept an array, or teach
`parseGrounding` to unwrap `{grounding:[…]}` into joined bullets. Crucially, across all samples
the grounding stayed **facts, not steps** — the nest was not stolen.

## Threats / caveats

- **K = 5, no pinned seed** — ±~2-runs noise; the −20/−40 % deltas are 1–2 escalations. The robust
  readings are (a) effFS = 0 everywhere and (b) the *direction* (delegated recon lowers autonomy,
  heaviest on T4), not the exact percentages.
- **Verifier-`uncertain` noise** contributed ≥1 escalation (qwen3:14b T4-k2): a `qwen3.5:4b`
  unparseable verdict, not a recon failure. Separating "escalated because recon was thin" from
  "escalated because the verifier hiccuped" would need the decoupled-corpus treatment.
- **`effFS = 0` is on this suite** and, as in M1, partly structural (the reliable Layer-1 verifier
  gates `done`). The empirical result that matters is that self-assembled recon did **not** induce
  a single false success.
- **Claude-M2 ceiling now run** (2026-07-14 addendum below). The semi-manual Claude-in-seat,
  candidate-recon baseline — Claude assembles grounding from the same `bench.mjs recon`
  fact-pool, then drives the full corrective loop by hand — is complete, so the "vs claude"
  delta in the candidate partition is now populated. A **first single-shot attempt (1 round, no
  loop) was scrapped** as non-comparable to the K=5 loop-driven M1/M2 candidate numbers: it
  scored 20 %/60 % purely from ornith's round-1 flakiness, not grounding quality.
- **Ran through a power cut.** Mains (and the network) dropped mid-sweep; the MacBook continued on
  **battery** and the daemon (own session, `caffeinate`) ran to completion uninterrupted — the
  run-durability pattern from M1 held even against a power event. Harness-tracked watcher tasks
  were repeatedly reaped; the detached daemon + on-disk rows were the source of truth.

## Addendum (2026-07-14) — the Claude-M2 ceiling (loop-driven)

The upper bound of the recon-assembly task: **how well can round-1 grounding be assembled from
the fact-pool at all**, done right (Claude in the recon seat AND the decision seat, driving the
full corrective loop — not the scrapped single-shot). Same host/executor/verifier/tasks/K as
above; Layer-0 oracle hidden during the loop, applied post-hoc as the gold label. A throwaway
harness owned only the mechanical glue (fresh workdir from template → `orn run` → gather
evidence → `qwen3.5:4b` verify); **every grounding and every done/retry/escalate decision was
Claude's**, from ground-truth evidence — mirroring the M1 Claude baseline method.

```
model (M2 candidate-recon)  n  autoPass  effFS  escalate   vs own fixed-M1
claude                     10  100%      0%     0%         100% → 100%  (recon-delegation cost = 0)
llama3.1:8b                10   80%      0%     20%        100% →  80%
qwen3:14b                  10   80%      0%     20%        100% →  80%
gemma4:12b                 10   60%      0%     40%         80% →  60%

Per-task pass@N delta vs the CLAUDE ceiling (now populated), candidate mode:
task              model        passN  ceiling  delta
T4-additive-hard  claude       100%   100%       —   (the ceiling)
T4-additive-hard  llama3.1:8b   60%   100%    -40%
T4-additive-hard  qwen3:14b     80%   100%    -20%
T4-additive-hard  gemma4:12b    60%   100%    -40%
T6-inplace-hard   claude       100%   100%       —
T6-inplace-hard   llama3.1:8b  100%   100%      0%
T6-inplace-hard   qwen3:14b     80%   100%    -20%
T6-inplace-hard   gemma4:12b    60%   100%    -40%
```

**Per-repeat (oracle gold label):**

```
              T4-additive-hard                             T6-inplace-hard
claude   k1 done·r2·P  k2 done·r1·P  k3 done·r1·P   k1 done·r2·P  k2 done·r2·P  k3 done·r1·P
         k4 done·r1·P  k5 done·r1·P                 k4 done·r1·P  k5 done·r1·P
```

**Findings.**

1. **Ceiling = 100 % autoPass on both hard tasks, effFS 0 %, escalate 0 %** — identical to the
   Claude fixed-recon M1 baseline. **The recon-delegation cost for a capable assembler is 0 %**
   (T4 and T6 both M2 100 % = M1 100 %). Assembling round-1 grounding from the deterministic
   fact-pool, done well, loses nothing versus receiving the hand-authored gold `grounding.md`.
2. **So the candidates' ~20 pp M2 drop is model accuracy, not a fact-pool/harness gap.** Reading
   both fact-pools directly confirms they contain all the gold grounding: for **T4** the pool
   prints the entire `registry.mjs` (the `OPS` map + `evaluate`) and `ops.mjs`, so "register
   `pow` in `OPS`" is fully derivable; for **T6** it prints `pricing.mjs` (with `roundCents`
   byte-exact and the hardcoded `0.2`), both `checkout.mjs` call sites, and the test file (the
   2-arg `withTax` signature and expected values). The candidates that dropped the scope fact
   (e.g. llama omitting the `registry.mjs` registration, `journal §Reading`) did so from
   assembly accuracy, not because the fact was absent from the pool.
3. **Even with complete grounding, ornith single-shot passes little on the hard tasks — the
   corrective loop is what delivers pass@N.** Round-1 clean was **7/10** (T4 4/5; T6 3/5); the
   loop recovered all 3 round-1 failures at round 2 → 10/10. Mean corrective rounds: T4 1.2, T6
   1.4. The three round-1 failures were canonical ornith modes, each fixed by *grounding, not
   scaffold*: **T4-k1** implemented `pow` in `ops.mjs` but left `registry.mjs` unregistered
   (corrective: named the missing `OPS` registration); **T6-k1** dropped the opening `{` from
   both `checkout.mjs` declarations → SyntaxError (corrective: named the dropped-brace state +
   the brace invariant; ornith recovered via write-from-scratch); **T6-k2** the in-place edits
   errored and applied nothing (corrective: named the no-op + restated the end-state invariants).
4. **The scrapped single-shot attempt (20 %/60 %) is the control that proves point 3.** With no
   loop, those same round-1 flakes score as failures/escalations — it measured ornith's round-1
   reliability, not grounding quality, which is why it was non-comparable to the K=5 loop-driven
   candidate numbers and was discarded.
5. **Verifier noise is real but the strong orchestrator absorbs it.** On T4-k2 the `qwen3.5:4b`
   verifier returned `uncertain` via a parse failure on a manifestly-green run; Claude (which
   *is* the escalation tier) adjudicated the ground-truth evidence directly and declared `done` —
   exactly the resolution a candidate could not make (qwen3:14b escalated the analogous case in
   the main M2 sweep). This is a large part of why the ceiling clears the candidates.

Ceiling rows: `benchmarks/results/{T4-additive-hard,T6-inplace-hard}__orch-claude-recon.jsonl`
(`orchestratorModel:"claude"`, `reconMode:"candidate"`). Reproduce the tables with
`node benchmarks/bench.mjs orchestrate-report`.

## Status: M2 candidate sweep + Claude-M2 ceiling COMPLETE — next

- M2 candidate sweep (llama3.1:8b, qwen3:14b, gemma4:12b) **done**; **Claude-M2 ceiling done**
  (2026-07-14 addendum) — 100 % autoPass, effFS 0 %, recon-delegation cost 0 %. Distilled into
  `docs/ORCHESTRATOR.md §11.2`. Rows in the gitignored `benchmarks/results/*-recon.jsonl` (the
  tables here + §11.2 are the durable record).
- **Next:** (1) tighten `parseGrounding`/rubric for the array-format quirk; (2) **M3** — let the
  candidate drive *agentic* recon (Read/Grep/Bash) instead of pre-computed extractors
  (`ORCHESTRATOR.md §6.2`, where function-calling finally becomes load-bearing).
