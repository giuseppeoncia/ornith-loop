# verifier-selection — 2026-07-10

Selection campaign for the Layer-1 local first-pass verifier (docs/VERIFIER.md). Question:
which lightweight **local** model is safe enough that its `pass` verdicts can be
auto-accepted, keeping Claude only as the audit tier for `fail`/`uncertain`?

- **Host / reviewer:** Claude Code (Opus 4.8), on the local workstation
- **Machine:** Apple M5 Pro, 48 GB unified memory; ollama + pi 0.80.3
- **Executor (the runs being judged):** `ornith-1.0-9b-64k`, `--thinking off` (orn default)
- **Tasks:** `T6-inplace-hard`, `T3-inplace` — the in-place edit modes, where a lazy
  verifier most easily false-passes a green-but-corrupt diff (per the protocol)
- **Arm:** A only · **Repeats (K):** 5, no pinned seed
- **Candidates benchmarked:** `qwen3.5:4b` (floor), `qwen3-coder:30b` (sweet-spot),
  `qwen3.6-35b-a3b-64k` (reference ceiling)
- **Selection metric:** effFP = P(oracle fail | verdict pass); tie-break lowest escalation

## Grounding finding before the run — `qwen3-coder-next` excluded

The doc shortlist listed `qwen3-coder-next` as "~3B active / 80B MoE, ~16 GB". The actual
ollama manifest is **48.2 GB** (`:latest` = `:q4_K_M`; `:q8_0` = 79 GB). On a 48 GB machine
that exceeds total unified memory: it cannot co-reside with the 9.5 GB executor, and running
it alone would thrash to disk — every verifier call would hit the 900 s `orn` timeout and
degrade to `uncertain`, producing no signal. Its only smaller tag is `:cloud`, which is
remote and breaks the entire local-verifier premise. **Excluded as unfit for the target
hardware.** The doc's "qwen3-coder-14b" also does not exist as an ollama tag; `qwen3-coder`
ships only `:30b` (a3b MoE, 17.3 GB) and `:480b`, so `:30b` was used as the sweet-spot
candidate. `docs/VERIFIER.md` shortlist should be corrected.

## Results (`node benchmarks/bench.mjs verify-report`, 26 rows)

```
Verifier vs oracle (sorted safest-first)
model                          n  agree  falsePass  effFP  escalate
qwen3.5:4b                    10   89%     0%     0%    30%
qwen3.6-35b-a3b-64k            6  100%     0%     0%    33%
qwen3-coder:30b               10   67%     0%     0%    80%
```

`n` for the ceiling is 6 (T6 complete, T3 only k1) — the sweep was stopped early to free the
machine; the two selection candidates are complete at K=5 on both tasks, and the ceiling is
reference-only, so the winner is unaffected.

### Per-row detail (oracle gold label vs verifier verdict; `*` = verdict was unparseable → forced uncertain)

```
T3-inplace   qwen3.5:4b          k1 fail→fail  k2 PASS→pass  k3 PASS→pass  k4 PASS→pass  k5 PASS→pass
T6-hard      qwen3.5:4b          k1 PASS→uncertain* k2 PASS→fail k3 PASS→pass k4 PASS→pass k5 PASS→pass
T3-inplace   qwen3-coder:30b     k1 fail→uncertain* k2 PASS→uncertain* k3 PASS→uncertain* k4 PASS→pass k5 PASS→pass
T6-hard      qwen3-coder:30b     k1 PASS→uncertain* k2 PASS→uncertain* k3 PASS→uncertain* k4 PASS→fail k5 PASS→uncertain*
T3-inplace   qwen3.6-35b         k1 PASS→pass
T6-hard      qwen3.6-35b         k1 fail→fail  k2 fail→fail(CHANGED)  k3 PASS→pass  k4 PASS→pass  k5 PASS→pass
```

**6 of the 30b's 7 `uncertain` verdicts were `*` (unparseable), not deliberate.** See the
harness bug below — its escalation number is largely an artifact, not caution.

## Verdict — adopt `qwen3.5:4b` as the first-pass verifier (provisionally)

- **All three candidates hit effFP = 0%.** The falsifiable V1 question ("a lightweight local
  model can be a safe first pass") is answered **yes** on this suite — nobody green-lit a real
  failure. The safety bar is met even by the 3.4 GB floor.
- The discriminator is therefore **escalation cost**, and `qwen3.5:4b` is both the lightest
  and the cheapest (30% escalation) while staying safe. By the selection rule (lightest with
  effFP≈0, tie-break lowest escalation) it wins outright.
- `qwen3-coder:30b`'s 80% escalation is **mostly a harness artifact, not caution** (see the
  bug below): 6 of its 7 `uncertain`s were unparseable replies. When it *did* answer inline it
  judged correctly (2 pass, 1 fail). Its real safety/usefulness is **unmeasured** here and the
  comparison against it is unfair — do not conclude "bigger = more cautious" from this run.
- The `qwen3.6-35b` ceiling is the only candidate with perfect agreement (6/6) and the only
  one that faced — and correctly failed — a **green-but-corrupt** run (see caveat).

## Harness bug discovered mid-run — verifier writes into the repo, gets mis-scored

`runVerifier` invokes `orn run` for the verifier **without `--workdir`**, so pi executes in
the driver's cwd — **the ornith-loop repo root** — with its file-write tools live. A
tool-eager verifier (here `qwen3-coder:30b`, a coder model) responded by *writing its verdict
to a file* (`verdict.json`, `tmp-verdict.json`, `.verdict.json`) and even authoring a stray
test (`verifier/verify.js`) into the tracked `verifier/` dir, instead of returning JSON in its
message. Two harms:

1. **Repo pollution.** The verifier mutated the working tree it was supposed to only read.
   (Cleaned up this session; not committed.)
2. **Silent mis-scoring.** The harness reads the verdict from `record.finalText`; when the
   model writes to a file instead, `finalText` is unparseable and `parseVerdict` correctly
   defaults to `uncertain`. So the 30b's escalation rate measured *"how often it used a tool
   instead of replying,"* not *"how often it declined to judge."* This confound is invisible
   in `verify-report` — it only shows up in `verifierReason` = "no parseable verdict".

**Fix (highest priority):** run the verifier in an isolated throwaway cwd (or with write tools
disabled), and treat a verifier that emits no inline verdict as a run error, not a silent
`uncertain`. Until then, escalation-rate comparisons across models are unreliable whenever a
candidate is tool-happy.

## The load-bearing caveat (why "provisionally")

The harness **re-runs ornith fresh for each `--verifier-model`**, so the three verifiers were
scored on *different* executor runs, not a shared evidence set. Consequently:

- The single **green-but-corrupt diff** (oracle `fail` **with** files changed — the exact mode
  the protocol targets, because a naive "diff is non-empty → pass" heuristic false-passes it)
  occurred **only in the ceiling's T6 run (k2)**. The ceiling called it `fail` correctly. The
  two light models **never encountered that case** — all their oracle-`fail` runs were trivial
  (no change, or an orn timeout), which are easy to reject.
- So `qwen3.5:4b`'s effFP=0 is **real but under-tested on the failure mode that matters most.**
  It has proven it won't rubber-stamp a no-op or a timeout; it has *not* been shown to catch a
  corrupt-but-green edit.

This, plus K=5 noise (±~2 runs, per BENCHMARK.md), means the verdict is a provisional adopt,
not a settled result.

## Recommended next steps

1. **Sandbox the verifier call (blocker).** Run it in an isolated throwaway cwd or with
   write tools off, and count an empty/unparseable inline verdict as a harness error, not a
   silent `uncertain`. Without this, escalation numbers for tool-happy models are noise.
2. **Score all verifiers on the SAME ornith executions.** Run the executor once per
   (task, repeat) and fan that one evidence packet out to every candidate (decouple execution
   from adjudication — the "batch executions then verifications" option in docs/VERIFIER.md §5).
   Removes the per-candidate unfairness and guarantees the corrupt-green case reaches every
   candidate.
3. **Re-run at K≥20** on the fixed harness before trusting `qwen3.5:4b` in the skill at
   runtime (open decision (c) — defer runtime integration until this confirms).
4. **Fix the `docs/VERIFIER.md` shortlist:** drop the 16 GB claim for `qwen3-coder-next`
   (it is 48 GB), drop the nonexistent `qwen3-coder-14b`, note `qwen3-coder:30b` as the real
   sweet-spot tag.

## Notes / lessons (grounding for next time)

- On 48 GB, keep executor + verifier co-resident (`ornith-9b` + a ≤~20 GB verifier) to avoid
  per-run weight swaps; the 37 GB ceiling swaps every call and dominated wall-clock.
- `orn` timeouts / crashes surface to the verifier as an unchanged or empty packet and it
  correctly returns `uncertain` — the escalate path degrades safely.
- Verifier prompt-following matters as much as judgment: a coder model (`qwen3-coder:30b`)
  reached for a write tool instead of replying with the verdict. The rubric/harness must make
  the inline-JSON reply the *only* path (no tools available), or tool-happy models score as
  non-committal through no fault of their reasoning.
