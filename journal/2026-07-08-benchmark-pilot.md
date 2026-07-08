# benchmark: pilot (Phase 1) — 2026-07-08

- **Model(s):** ornith-1.0-9b-64k
- **Tasks:** T1-scratch, T2-additive, T3-inplace  (edit modes: scratch / additive / in-place)
- **Arms:** A (method) · B1 (bare) · B2 (heavy scaffold) · B3 (single-shot)
- **Repeats (K):** 5 per (task, arm) — 60 round-1 runs total
- **Pre-registered:** yes — suite, heavy-scaffold prompts, K, and hypotheses were frozen
  (docs/BENCHMARK.md, committed) before running.
- **Host / reviewer:** Claude Code, opus-4.8

## Harness fix required before results were trustworthy

The **first** full run scored 0/20 on T1 — the control-ceiling task ornith handles cleanly.
Root cause was **the harness, not the model**: the driver wrote `orn`'s run records to
`.bench-runs/` **inside each task workdir**, and every scope-checking oracle
(`git status --porcelain` over the workdir) counted that directory as a stray changed file
and failed the run. The FizzBuzz output was byte-exact in all 20 — the scope guard tripped on
the harness's own artifact.

Fix (`benchmarks/bench.mjs`): run records now go to a temp dir **outside** the workdir,
cleaned up alongside it. Reproduced deterministically (correct FizzBuzz passes without
`.bench-runs/`, fails with it) before and after the fix. All numbers below are post-fix.
Lesson for the suite: harness artifacts must never live in the directory the oracle inspects.

## Results (`node benchmarks/bench.mjs report`)

```
Per task × arm
task            arm  reps  pass@1  pass@N  rounds→pass
T1-scratch      A      5  100%   100%   1:5
T1-scratch      B1     5   80%    80%   1:4 never:1
T1-scratch      B2     5  100%   100%   1:5
T1-scratch      B3     5  100%   100%   1:5
T2-additive     A      5  100%   100%   1:5
T2-additive     B1     5  100%   100%   1:5
T2-additive     B2     5  100%   100%   1:5
T2-additive     B3     5  100%   100%   1:5
T3-inplace      A      5  100%   100%   1:5
T3-inplace      B1     5   60%    60%   1:3 never:2
T3-inplace      B2     5  100%   100%   1:5
T3-inplace      B3     5  100%   100%   1:5

Hypothesis deltas (positive favours the method)
task            A(passN)  H2:A−B1  H1:A−B2  H3:A−B3
T1-scratch       100%     +20%       0%       0%
T2-additive      100%       0%       0%       0%
T3-inplace       100%     +40%       0%       0%
```

No corrective rounds were run: **A and B2 passed round 1 on all 15/15 repeats**, so there was
nothing to correct. Every non-pass belongs to B1 (bare goal, single-shot, no loop).

## Reading of the deltas (against the pre-committed clause)

- **H2 (A vs B1, wrapper value):** **A > B1**, and the gap widens with difficulty —
  0% on additive (T2), +20% on scratch (T1), **+40% on in-place (T3)**. The full method beats
  bare ornith, most on the hard edit mode where ornith's failure modes actually fire. This is
  the pilot's clearest positive signal, and it is driven by **grounding**, not by the loop
  (which never had to fire).
- **H1 (A vs B2, "don't steal the nest"):** **A ≈ B2 (0% everywhere) — inconclusive by
  ceiling effect.** Both saturate at 100% on all three tasks, so this suite cannot separate
  minimal from heavy scaffold. Not evidence the thesis is wrong; evidence the tasks are too
  easy to test it. H1 needs a hard task (T4-additive-hard / T6-inplace-hard) where a 9b model
  can plausibly fail, so richness-of-self-scaffold can matter. **Do not read the 0% as
  "scaffold-neutral, thesis dead" — read it as "not yet tested."**
- **H3 (A vs B3, loop value):** **0% by construction.** A never failed round 1 (15/15), so the
  corrective loop never activated — it cannot add value it was never invoked to add. On this
  suite the loop is untested, not disproven. B1's `never:` counts (T1:1, T3:2) show where a
  loop *would* have had something to fix — but B1 has no loop, which is exactly the arm design.
- **Honest-null check:** on **T2-additive all four arms tie at 100%** — there the method is a
  pure usability/observability wrapper, no performance lift, and that is stated plainly. On
  T1/T3 the lift is real but is entirely the **grounding** component (H2 vs B1), not the loop
  (H3) and not scaffold-avoidance (H1, untested). Overall pilot verdict: **grounding earns its
  keep on the hard case; the loop and the anti-scaffold thesis remain untested because the
  suite saturates.** Next step is difficulty, not more repeats.

## Failure modes observed (from run-record flags, per arm)

All three B1 non-passes are textbook ornith failure modes — each on a case A's grounding
directly forecloses:

- **T1-scratch B1 k3** — wrong filename: created `myFizzBuzz.mjs` instead of `fizzbuzz.mjs`.
  Without the exact path in grounding, the model picks its own name → scope fail. A's grounding
  gives the path, so A never does this.
- **T3-inplace B1 k1** — **stalled / no-change**: 32 tool calls, `changed=false`, greet left in
  English. The model churned without applying the edit (the "narrates but doesn't act" mode).
- **T3-inplace B1 k2** — **in-place corruption** + `toolCallAsText`: *both* tests fail, so it
  damaged `shout` too, not just `greet`. This is the exact token-level corruption mode the T3
  `shout` byte-guard exists to catch, and that A's "leave `shout` byte-exact" grounding prevents.

- **In-place corruption (T3):** appeared once, and **only in B1** (no grounding). A/B2/B3, all
  of which carry the "change only the greeting string, leave the rest byte-exact" grounding,
  never corrupted the file. Direct (if small-K) evidence that grounding + the shout-guard
  catch/prevent the corruption mode.

## Self-scaffold shape (tool-sequence, relevant to H1)

| task/arm | avg tools | max | note |
|---|---|---|---|
| T3 B1 (bare) | 15.8 | 32 | longest sequences — and the failing arm |
| T2 B1 (bare) | 11.8 | 33 | long, noisy |
| T3 A / B2 / B3 (grounded) | 3.4 / 4.2 / 6.4 | 5 / 7 / 13 | short, targeted, all pass |

**Counter to the naive H1 framing:** here longer self-scaffolds do **not** correlate with
success — the longest sequences are the *bare* arm flailing without grounding, and they fail.
Grounding *shortens* the tool sequence and raises success. So on this suite "richer self-scaffold
= better" does not hold; grounding makes the self-scaffold *tighter*, not longer. (recorded,
non-scoring: one T2-A repeat hit `timeout` at 24 tool calls but still passed — the correct edit
landed before the clock ran out.)

## Corrective rounds (arms A / B2)

None. A and B2 both passed round 1 at 15/15, so no round-2 grounding (A) or scaffold (B2) was
added. The grounding-vs-scaffold split stayed clean by not being exercised — a real outcome,
not a skipped step.

## Threats / caveats for this run

- **Ceiling effect dominates.** T1/T2/T3 are easy/medium; A, B2, B3 saturate at 100%, so H1 and
  H3 are structurally untestable here. The pilot did its job (confirmed the arms + oracles
  produce trustworthy, distinguishable numbers) but cannot decide the two scaffold hypotheses.
- **Small K (=5).** Single-run swings move a rate 20 points. B1's 60–80% are 3–4/5, not tight
  estimates. Treat deltas as directional.
- **Seed:** none recorded (runs treated as independent samples; Ollama seed not pinned).
- **Single model.** ornith-1.0-9b-64k only; the qwen cross-model comparison is not yet run.
- **B2 good-faith check:** the T3 heavy scaffold is a competent 5-step plan a careful engineer
  would write (read → locate line → replace word → leave shout → run tests), not a strawman —
  verified before running. It simply didn't matter because the task was too easy to fail.

## Notes / lessons (grounding for next time)

- **The harness bug is the headline operational lesson:** never let the driver's own run-record
  dir live inside the oracle's workdir. Fixed; keep it fixed.
- **Grounding, not the loop, is what moved the needle** in this pilot — and it moved it most on
  the in-place case, exactly where DESIGN.md predicts ornith is weakest.
- **To actually test H1/H3, raise difficulty, not K.** Add T4-additive-hard and T6-inplace-hard
  (multi-file, signature refactor) where a 9b model plausibly fails round 1 — only there can the
  loop fire (H3) and can minimal-vs-heavy scaffold diverge (H1).
- **Longer self-scaffold ≠ better here.** Bare-goal runs flail (up to 33 tool calls) and fail;
  grounded runs are short and pass. Watch whether this inverts on the hard tasks.

---

# benchmark: pilot extension — hard tasks (T4, T6) — 2026-07-08

Follow-up to the pilot above, whose conclusion was "the suite saturates; raise difficulty,
not K." Added two harder tasks (frozen before running, per pre-registration):

- **T4-additive-hard** — RPN calculator; add a `pow` operator that must be *both* implemented
  (`src/ops.mjs`) and registered (`src/registry.mjs`). Additive, threaded across two files.
- **T6-inplace-hard** — pricing module; refactor `withTax(amount)` → `withTax(amount, rate)`
  and update both call sites across two files, leaving `roundCents` byte-exact. In-place
  signature refactor — ornith's corruption mode, harder than T3.

- **Model:** ornith-1.0-9b-64k · **K:** 5 · **Host/reviewer:** Claude Code, opus-4.8

## Data-integrity incident (recorded for honesty)

The **first** hard run's T6 numbers were **discarded**: mid-run, the T6 template's
`pricing.mjs` was edited on disk to the gold signature (`withTax(amount, rate)`) while
`checkout.mjs` stayed original, so the driver copied an inconsistent/pre-solved template for
some repeats. Tell-tale: `T6-B1-k2` scored **PASS with exit=null, 0 tool calls, changed=null**
— impossible on a valid template (tests must start red). T4 was unaffected (it doesn't use
`pricing.mjs`). Fix: restored the template from commit, re-validated the oracles
(base-fails / gold-passes / corruption-&-scope-fail), wiped only the T6 result files, re-ran
T6 clean. All T6 numbers below are from the clean re-run; the same empty-run pattern
(`T6-B1-k3`) now correctly scores **fail**, confirming the restored template is sound.

## Results (`node benchmarks/bench.mjs report`, hard tasks only)

```
Per task × arm
task            arm  reps  pass@1  pass@N  rounds→pass
T4-additive-hard A      5  100%   100%   1:5
T4-additive-hard B1     5   60%    60%   1:3 never:2
T4-additive-hard B2     5   60%    60%   1:3 never:2
T4-additive-hard B3     5   60%    60%   1:3 never:2
T6-inplace-hard  A      5   60%   100%   1:3 2:2
T6-inplace-hard  B1     5   20%    20%   1:1 never:4
T6-inplace-hard  B2     5  100%   100%   1:5
T6-inplace-hard  B3     5  100%   100%   1:5

Hypothesis deltas (positive favours the method)
task            A(passN)  H2:A−B1  H1:A−B2  H3:A−B3
T4-additive-hard  100%     +40%     +40%     +40%
T6-inplace-hard   100%     +80%       0%       0%
```

## Reading of the deltas (against the pre-committed clause)

- **H2 (grounding vs bare): consistently positive and largest on the hard case** — +40 (T4),
  **+80 (T6)**, where bare ornith collapses to 20%. Across the whole suite (incl. the easy
  pilot) H2 is the one delta that repeats task after task. This is the method's real,
  measurable lift, and it is the *grounding* component.
- **H1 (minimal vs heavy scaffold) and H3 (loop) in the final *rates*: inconclusive at K=5.**
  On T4 the +40 is A going 5/5 while B1/B2/B3 all went 3/5 — and A/B3 share the identical
  round-1 prompt, so that gap is sampling variance, not the loop. On T6 the raw round-1 gap
  even ran *against* A (A 3/5 vs B2/B3 5/5) — again impossible as a real effect between
  identical-prompt A and B3, i.e. noise. **±40 at K=5 is ±2 runs.** Do not over-read either
  sign; the rates cannot decide H1/H3.
- **The corrective loop, read as a mechanism (not a rate), points the thesis's way.** This is
  the extension's most informative result and it lives in the round-2 behaviour, below.

## The key finding — corrective rounds: facts recover, steps do not

The hard tasks finally produced round-1 failures on the looped arms, so the corrective loop
actually fired — the first real test of "add grounding (A) vs add scaffold (B2)" in the whole
experiment:

- **Arm A round-2 (added *grounding*): recovered 2/2.** `T6-A-k3` (had corrupted `roundCents`)
  and `T6-A-k5` (botched the call sites, 60 tool calls) both **PASS** after adding facts
  (the exact byte-text to preserve; the two exact call sites). A: 60% → **100% pass@N**.
- **Arm B2 round-2 (added *scaffold*): recovered 0/2.** `T4-B2-k3` and `T4-B2-k5` still
  **fail** after adding more explicit steps — the extra step-by-step even introduced a syntax
  error (`export function …` broken). B2 stays 60%.

Small N (2 vs 2), but it is exactly the direction "don't steal the nest" predicts: on this
model, **corrective *facts* fix failures; corrective *steps* don't** (and can harm). This is
the cleanest pro-thesis signal the pilot produced — and it is behavioural, not a saturated rate.

## Failure modes observed (from run-record flags)

- **In-place corruption appeared and was caught** (T6-A-k3): tests for `withTax` passed but the
  `roundCents` byte-guard failed — ornith damaged an untouched function. The guard did its job;
  the grounding round then prevented it. Direct evidence for the T6 design.
- **`toolCallAsText`** recurred across arms on the hard tasks (T4-B2, T6-A, T6-B1/B3) — the
  known leak of tool calls into prose; correlated with the longest, failing runs.
- **Bare arm collapses on in-place-hard** (T6-B1 = 20%, 4/5 never passing) — the clearest
  bare-vs-grounded gap in the whole experiment.

## Self-scaffold shape

| task/arm | avg tools | max | note |
|---|---|---|---|
| T6 A | 17.6 | 60 | one flailing 60-call repeat (k5) — recovered only via round-2 grounding |
| T4 B2 | 16.1 | 44 | heavy scaffold did not shorten or de-risk the sequence |
| T6 B1 | 5.0 | 12 | short *because* it gave up early (20% pass) — short ≠ good here |

No single "richness" story: on the hard tasks both flailing-long (T6-A-k5) and giving-up-short
(T6-B1) fail. Grounding's benefit is accuracy, not sequence length.

## Corrective rounds (arms A / B2)

- `T6-inplace-hard A k3`: round 2 added grounding (preserve `roundCents` byte-exact; the two
  exact call sites) → **passed**.
- `T6-inplace-hard A k5`: round 2 added the same grounding → **passed**.
- `T4-additive-hard B2 k3`: round 2 added scaffold (explicit registration steps) → still failing.
- `T4-additive-hard B2 k5`: round 2 added scaffold → still failing.

The grounding-vs-scaffold split was kept clean: A's `--extra` stated facts only; B2's stated
steps only (`benchmarks/` corr files, ephemeral).

## Threats / caveats

- **K=5 dominates H1/H3.** Final-rate deltas are ±2 runs; treat as directional only. The
  corrective-round finding is 2-vs-2 — suggestive, not conclusive. Raising K (20–50) is the
  next lever.
- **Data-integrity incident** on the first T6 run (above) — resolved by template restore +
  re-validation + clean re-run; first-run T6 numbers not used.
- **Single model, no pinned seed.** ornith-1.0-9b-64k only; qwen cross-model still pending.

## Notes / lessons (grounding for next time)

- **Overall pilot verdict:** the measurable win is (1) grounding (H2, robust and repeated) and
  (2) observability/verification (caught confabulation, corruption, and an oracle bug). The
  loop and anti-scaffold thesis are *supported by the corrective-round mechanism* (facts 2/2,
  steps 0/2) but *not yet by the saturated rates* — report both, claim only what the numbers
  hold.
- **Next:** raise K to tighten H1/H3; add a mid-hard in-place task between T3 and T6 to avoid
  ceiling/floor; re-run the suite on qwen3.6-35b to see if the failure-mode profile shifts.
