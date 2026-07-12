# ornith-loop — Local verifier selection

_Status: design + harness (selection runs on a local ollama workstation, not in a remote
container)._

Companion to [`DESIGN.md`](DESIGN.md) (two-tier verification) and [`BENCHMARK.md`](BENCHMARK.md)
(the method experiment). This doc answers a single question with evidence:

> Which lightweight **local** model is safe enough to be the **first-pass verifier** — i.e.
> its `pass` verdicts can be auto-accepted — with Claude kept only as the audit tier for
> `fail`/`uncertain`?

## The role being filled

Layer 1 of verification (DESIGN.md). The verifier does **not** re-implement the oracle. The
harness/host runs the tests, computes the diff, and lists the changed files; the verifier
**adjudicates** that evidence and returns a structured verdict. This keeps the model's job
narrow — read ground truth, decide — which is why a small model can plausibly do it.

Instructions live in [`../verifier/rubric.md`](../verifier/rubric.md). The evidence packet is
built by `buildEvidencePacket` (`src/verifier.js`) and deliberately **excludes**:

- **ornith's own prose / finalText** — the executor confabulates; a verifier that reads its
  self-report inherits the confabulation.
- **the task answer-key** (`meta.json`'s `allowedChangedFiles`, the oracle's byte-guard
  strings) — the model must *infer* the intended scope from goal + grounding + diff, exactly
  as it must on a real task that ships no oracle. Handing it the key would measure the wrong
  thing.

## The falsifiable question

**V1 — "a local model can be a safe first pass":** there exists a lightweight local model
whose **false-pass rate is ≈ 0** on the benchmark suite, at an escalation rate low enough to
be worth it. If no candidate reaches ≈ 0 false-pass without escalating almost everything, the
honest conclusion is *"keep Claude as the primary reviewer"* — a valid, publishable outcome.

## Why false-pass is the only metric that can sink the design

The verdicts map to actions asymmetrically:

- **`pass` → auto-accepted.** A wrong `pass` (oracle says fail) is a **false-pass**: a real
  failure ships unreviewed. Since ornith *already* confabulates success, a false-passing
  verifier is worse than no verifier — two confabulators in a row.
- **`fail` / `uncertain` → escalate to Claude.** A wrong `fail` (oracle says pass) only costs
  an audit; `uncertain` is the model correctly declining to guess. Both are cheap.

So the selection metric is **`effectiveFalsePass` = P(oracle fail | verdict pass)** — of the
runs the verifier auto-accepts, how many were actually broken. Pick the **lightest** model
with `effectiveFalsePass ≈ 0`, then break ties by the **lowest escalation rate** (least Claude
load). `scoreVerifier` (`src/verifier.js`) computes these; `bench.mjs verify-report` prints
them, sorted safest-first.

## Protocol

1. **Gold labels come free.** The benchmark oracles (`benchmarks/tasks/*/oracle.mjs`) already
   produce a mechanical pass/fail per run — that is the ground truth the verifier is scored
   against. No new labelling.
2. **Run each candidate over the existing suite.** For every `(task, arm)` you benchmark, add
   `--verifier-model <id>`; the driver runs the oracle (gold) **and** the candidate verifier
   (prediction) on the same workdir, and records both in the result row:

   ```bash
   node benchmarks/bench.mjs run --task T3-inplace --arm A --repeats 5 --verifier-model qwen3-coder:30b
   node benchmarks/bench.mjs verify-report
   ```
3. **Span the failure modes.** Include the in-place tasks (T3, T6) — the corruption cases are
   where a lazy verifier most easily false-passes a green-but-corrupt diff. A verifier that
   only ever sees clean passes is untested exactly where it matters.
4. **K repeats, no pinned seed** (as in BENCHMARK.md). Report rates with the same "±2 runs at
   K=5" caution; raise K to tighten.
5. **Model swapping.** The executor and the verifier are different Ollama models. On a single
   GPU that can't hold both, each `--verifier-model` call swaps weights (executor out, verifier
   in) and back — accepted (cost/speed are non-goals). Alternatives if it bites: size both to
   co-reside, or batch all executions then all verifications.
   This decoupled flow is implemented: `run --save-corpus <dir>` freezes each run's evidence +
   gold label, and `verify-corpus --corpus <dir> --verifier-model <id>` replays any candidate
   over that identical corpus (ornith runs once). See `benchmarks/README.md`.
6. **The verifier runs read-only.** It is invoked with `orn run --no-tools`, so pi disables all
   tools and the model's only way to answer is an inline reply. This is load-bearing: without
   it pi runs in the driver's cwd (the repo) with write tools live, and a tool-eager verifier
   writes its verdict to a *file* instead of returning it — polluting the tree and scoring as
   an unparseable reply → silent `uncertain`, which confounds the escalation rate. (Regression
   found and fixed 2026-07-10; see the journal.)

## Results — the `qwen3.5:4b` selection (2026-07-10 → 2026-07-11)

The findings that answer V1. Full narrative, harness-bug writeup, and lessons in
[`../journal/2026-07-10-verifier-selection.md`](../journal/2026-07-10-verifier-selection.md);
this section is the durable record of the numbers. Reproduce the rollup any time with
`node benchmarks/bench.mjs verify-report`.

**Run matrix.** Host: Apple M-series, 48 GB unified memory, ollama + pi 0.80.3. Executor
(the runs being judged): `ornith-1.0-9b-64k`, `--thinking off` — the exact local build (KikoCis
chat-template-fixed GGUF + `top_p 0.95` / `num_ctx 65536` / `temperature 1`) described in
`benchmarks/README.md` → "The executor model (exact build)". Tasks: `T6-inplace-hard`,
`T3-inplace` — the in-place edit modes, where a lazy verifier most easily false-passes a
green-but-corrupt diff. Arm A only. Gold label = the Layer-0 oracle; verifier verdict =
the prediction scored against it.

### First pass — K=5, three candidates (26 rows)

```
model                          n  agree  falsePass  effFP  escalate
qwen3.5:4b                    10   89%      0%       0%     30%
qwen3.6-35b-a3b-64k            6  100%      0%       0%     33%   (reference ceiling; T6 full, T3 k1 only)
qwen3-coder:30b               10   67%      0%       0%     80%   (escalation inflated by a harness bug, see below)
```

Per-row detail (oracle gold → verifier verdict; `*` = unparseable reply forced to `uncertain`):

```
T3-inplace  qwen3.5:4b       k1 fail→fail   k2 PASS→pass        k3 PASS→pass        k4 PASS→pass   k5 PASS→pass
T6-hard     qwen3.5:4b       k1 PASS→uncert* k2 PASS→fail       k3 PASS→pass        k4 PASS→pass   k5 PASS→pass
T3-inplace  qwen3-coder:30b  k1 fail→uncert* k2 PASS→uncert*    k3 PASS→uncert*     k4 PASS→pass   k5 PASS→pass
T6-hard     qwen3-coder:30b  k1 PASS→uncert* k2 PASS→uncert*    k3 PASS→uncert*     k4 PASS→fail   k5 PASS→uncert*
T3-inplace  qwen3.6-35b      k1 PASS→pass
T6-hard     qwen3.6-35b      k1 fail→fail   k2 fail→fail(CHANGED) k3 PASS→pass       k4 PASS→pass   k5 PASS→pass
```

- **All three hit `effFP = 0%`** — nobody green-lit a real failure, so V1 ("a lightweight
  local model can be a safe first pass") is answered **yes** on this suite even at the 3.4 GB
  floor. The discriminator is escalation cost, and `qwen3.5:4b` is both lightest and cheapest
  (30%) while safe → it wins by the selection rule.
- `qwen3-coder:30b`'s 80% escalation is **mostly a harness artifact**: 6 of its 7 `uncertain`s
  were unparseable replies (it wrote its verdict to a *file* rather than answering inline —
  the pre-`--no-tools` bug). When it did answer inline it judged correctly. Its true safety is
  unmeasured here; do not read "bigger = more cautious" from this row.
- Load-bearing caveat at K=5: the harness re-ran ornith per candidate, so the one **green-but-
  corrupt diff** (oracle `fail` *with* files changed — the mode the protocol targets) occurred
  only in the ceiling's T6 k2, which caught it. The two light models never met that case — all
  their oracle-`fail` runs were trivial (no-op / timeout). So the 4b's effFP=0 was **real but
  under-tested on the mode that matters most** → provisional adopt.

### Confirmation — K=20 on the fixed harness (40 rows)

Two fixes landed first: the verifier now runs **read-only** (`orn run --no-tools`, commit
`ce04daf`) so it can no longer write files and must reply inline; and `bench.mjs run`
**auto-caffeinates** on macOS (commit `474c886`) after an idle-sleep truncated 4 in-flight
runs. Then `qwen3.5:4b` was re-run at K=20 on `T6-inplace-hard` + `T3-inplace`:

```
model         n  agree  falsePass  effFP  escalate
qwen3.5:4b   40  100%     0%         0%     25%
```

Partitioned to separate genuine runs from the quarantined sleep artifacts:

| subset | n | effFP | escalation | confusion |
|---|---|---|---|---|
| **clean (genuine runs)** | 36 | **0%** | **17%** | truePass 30 · trueFail 4 · uncertain 2 · **falsePass 0** |
| sleep artifacts | 4 | 0% | 100% | all `oracle=fail` interrupted runs, all correctly `fail` |
| all | 40 | 0% | 25% | falsePass 0 · agreement 100% on decided verdicts |

**The mode that matters — genuine green-but-corrupt in-place diffs** (`exit completed`,
`oracle=fail`, files changed): 4 occurred (T6 k3/k16/k20, T3 k8). **Zero false-passed** — 3
called `fail`, 1 escalated `uncertain` (the safe outcome: routes to the Claude audit tier
rather than rubber-stamping). This is exactly the evidence K=5 lacked.

### Verdict: **confirmed** (on this suite)

`qwen3.5:4b` is adopted as the Layer-1 first-pass verifier. effFP = 0 held at K=20 including
on the corrupt-but-green failure mode; its clean escalation is ~17%, cheap. **A 3.4 GB general
model is a safe auto-accept gate — size is not the lever, calibration is.**

**Caveats still open:** only the 4b was re-executed at K=20, so the per-candidate
re-execution *unfairness* vs the 30b/ceiling is not yet removed (needs the
`--save-corpus` / `verify-corpus` decoupled flow, now implemented — §Protocol step 5); and
cross-family lightweight verifiers (`gemma4:e4b-it`, `qwen3:8b`, `llama3.1:8b`) remain
untested as verifiers. K=5/K=20 carry the usual ±2-runs noise.

## Production use: `orn config` / `orn verify`

The protocol above is the **selection** harness — `bench.mjs run --verifier-model` +
`bench.mjs verify-report` — for empirically picking a candidate. Once a candidate is chosen,
the local-first verify is **configurable and mechanized** via the `orn` CLI itself, distinct
from that selection harness:

- **Config** lives at `~/.config/ornith-loop/config.json` (honors `XDG_CONFIG_HOME`; missing
  or malformed file falls back to defaults, never throws). The relevant keys:
  `verifier.enabled` (boolean, default `false`) and `verifier.model` (default `qwen3.5:4b`).
  Set them with:

  ```bash
  orn config set verifier.enabled true
  orn config set verifier.model qwen3-coder:30b
  ```

  `orn install-skill --verifier <model>` does both in one shot at install time.
- **`orn verify --workdir <repo> --test-cmd "<cmd>" [--model <id>] [--goal-file <path>]
  [--grounding-file <path>]`** is the production verify command: it runs the same read-only
  (`--no-tools`), rubric-adjudicated Layer-1 check described above and prints
  `pass`/`fail`/`uncertain` plus a reason. It resolves the model from `--model`, else from
  `verifier.model` when `verifier.enabled` is true; with neither set it exits 3 and prints
  guidance instead of guessing.
- **Default is off.** Until a verifier is configured (or `--model` is passed explicitly),
  `orn verify` declines to run and Claude remains the verifier — no behavior change for
  anyone who hasn't opted in.

## Candidate shortlist (validate, don't assume)

Starting points for the first pass; the winner is whatever `verify-report` says, not this
list. The adjudication load is lighter than open-ended bug-hunting because the mechanics are
pre-computed, so a small model may suffice:

- **`qwen3-coder:30b`** (a3b MoE, ~17 GB Q4) — the dense-ish sweet-spot for modest hardware,
  and it co-resides with the 9.5 GB executor on a 48 GB machine (no per-run weight swap).
- **`qwen3.5:4b`** (~3.4 GB) — a floor candidate: is even a tiny general model a safe first
  pass? (In the 2026-07-10 campaign it was, at the lowest escalation — see the journal.)
- **`qwen3.6-35b-a3b-64k`** (~37 GB) — already used in the repo as the reliable tools-capable
  model; useful as a heavier **reference ceiling** to see how much the light models give up.
  Cannot co-reside with the executor on 48 GB, so it swaps weights every call.

> **Hardware note (validated 2026-07-10).** The `qwen3-coder-next` MoE is **~48 GB** at Q4
> (an 80B model), not the ~16 GB once assumed — it exceeds a 48 GB machine and is unfit as a
> local verifier there (its only smaller tag is `:cloud`, which is not local). `qwen3-coder`
> ships no 14b tag; `:30b` is the real light-coder option. Validate sizes with the ollama
> manifest before pulling.

## Success criteria for this experiment

- Produces `effectiveFalsePass` + escalation per candidate, over the benchmark suite incl.
  the in-place tasks.
- Every gold label traces to a mechanical oracle, never agent prose.
- Can conclude "no local model is safe enough; keep Claude primary" as cleanly as it can pick
  a winner.
- Re-runnable as new local models appear, suite and rubric unchanged.

Distil each campaign into `journal/YYYY-MM-DD-verifier-selection.md`.
