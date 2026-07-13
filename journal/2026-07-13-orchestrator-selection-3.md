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
- **Claude-M2 ceiling not yet run.** The semi-manual Claude-in-seat, candidate-recon baseline
  (Claude assembles grounding from the same `bench.mjs recon` fact-pool, then drives the loop by
  hand) is still pending — so the "vs claude" delta in the candidate partition shows `—`. The
  candidate-M2-vs-own-M1 delta above is the meaningful comparison for now.
- **Ran through a power cut.** Mains (and the network) dropped mid-sweep; the MacBook continued on
  **battery** and the daemon (own session, `caffeinate`) ran to completion uninterrupted — the
  run-durability pattern from M1 held even against a power event. Harness-tracked watcher tasks
  were repeatedly reaped; the detached daemon + on-disk rows were the source of truth.

## Status: M2 candidate sweep COMPLETE — next

- M2 candidate sweep (llama3.1:8b, qwen3:14b, gemma4:12b) **done**; distilled into
  `docs/ORCHESTRATOR.md §11`. Rows in the gitignored `benchmarks/results/*-recon.jsonl` (the
  tables here are the durable record).
- **Next:** (1) the **Claude-M2 ceiling** (semi-manual) to bound how well the assembly task can be
  done at all; (2) tighten `parseGrounding`/rubric for the array-format quirk; (3) **M3** — let the
  candidate drive *agentic* recon (Read/Grep/Bash) instead of pre-computed extractors
  (`ORCHESTRATOR.md §6.2`, where function-calling finally becomes load-bearing).
