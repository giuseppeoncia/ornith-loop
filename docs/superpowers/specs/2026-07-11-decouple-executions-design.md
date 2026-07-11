# Decouple executor runs from verifier scoring — design

_Date: 2026-07-11 · Status: approved design, pre-implementation._

## Problem

The verifier-selection harness (`benchmarks/bench.mjs`) couples execution and adjudication:
for each `(task, arm, repeat)`, `bench.mjs run --verifier-model <id>` runs the executor
(ornith) once and has the verifier judge *that* run. Because ornith is non-deterministic
(it self-scaffolds differently each time), comparing candidates by invoking `run
--verifier-model X` then `--verifier-model Y` **re-runs ornith from scratch each time**, so X
and Y are scored on *different* executor outputs.

Consequence (the "still open" caveat in `journal/2026-07-10-verifier-selection.md`): candidates
are not comparable, and a specific failure mode (a green-but-corrupt in-place diff) may reach
only whichever candidate happens to draw it. At K=5 the corrupt case reached only the ceiling;
the light models never saw it.

## Goal

Score every candidate verifier on the **same frozen set** of executor runs. Run the expensive
executor once, persist its outputs as a corpus, then replay each verifier over that identical
corpus. This makes cross-candidate comparison fair and cheaper (adding a candidate no longer
re-runs ornith), and guarantees every candidate faces the same corrupt-but-green cases.

This is the "batch all executions then all verifications" alternative noted in
[`docs/VERIFIER.md`](../../VERIFIER.md) §5.

Non-goals: changing the oracle (Layer 0), the rubric, `verify-report`'s metric (effFP), or the
executor. Cost/speed remain non-goals in general; this change reduces re-execution only as a
side effect of fairness.

## Design decisions (locked)

1. **Additive.** Add `run --save-corpus <dir>` and a new `verify-corpus` command. The existing
   coupled path `run --verifier-model <id>` is unchanged (kept for quick one-offs).
2. **Structured evidence.** The corpus stores raw evidence (goal, grounding, test output/exit,
   diff, changed files, a slim run-signal subset) + the gold label — not a pre-assembled packet
   string. The packet is rebuilt at replay-time via `buildEvidencePacket`, so packet/rubric can
   evolve and be re-replayed on the same frozen executor outputs without re-running ornith.
3. **Corpus is ephemeral / gitignored** (`benchmarks/corpus/`, like `benchmarks/results/`).
   Reproducibility lives in the journal + the versioned suite & rubric, not in committed diffs.
4. **Slim run-signal subset, no `finalText`.** The corpus persists only the run-record fields
   `buildEvidencePacket`'s `formatRunSignals` consumes; ornith's prose (`finalText`) is
   deliberately excluded, exactly as in the coupled path. The task answer-key is never stored.
5. **`goldPass` is frozen at Phase 1** (the oracle's mechanical label). Changing the *oracle*
   later requires regenerating the corpus; changing the *packet/rubric* does not.
6. **Result routing via `source:"corpus"`.** `verify-corpus` rows are tagged `source:"corpus"`.
   `verify-report` includes them (it already filters on `verifierVerdict`); `report` excludes
   them (they carry no executor attempt data and would otherwise count as phantom attempts).

## Architecture

Two phases with an ephemeral corpus between them; `verify-report` unchanged.

```
FASE 1 (execute once)                          FASE 2 (replay N candidates)
run --save-corpus <dir>                         verify-corpus --corpus <dir> --verifier-model <id>
  ornith + oracle + gatherEvidence                for each record:
  → benchmarks/corpus/<dir>/<...>.json              buildEvidencePacket(record)
    (raw evidence + goldPass)                       → orn run --no-tools --model <id>
                                                    → parseVerdict
                                                    → append row to results/<task>__<arm>.jsonl
                                                        (tagged source:"corpus")
                                                          │
                                                verify-report (UNCHANGED) reads results/
```

### Components

- **`run --save-corpus <dir>` (producer)** — new flag on the existing `run` command.
  `gatherEvidence` (currently only called inside `runVerifier`) is extracted so it runs once
  after the oracle when `--verifier-model` **or** `--save-corpus` is set; the single evidence
  result feeds both the (optional) inline verifier and the corpus writer. When `--save-corpus`
  is set, a corpus record is written. Orthogonal to `--verifier-model`: either, both, or
  neither may be present.

- **corpus record** — one JSON file per run at
  `benchmarks/corpus/<dir>/<task>__<arm>__r<round>__k<repeat>.json`:
  ```jsonc
  {
    "task": "T6-inplace-hard", "arm": "A", "round": 1, "repeat": 3,
    "runId": "…", "goldPass": false,
    "goal": "…", "grounding": "…",
    "testCmd": ["node","--test"], "testOutput": "…", "testExitCode": 1,
    "changedFiles": ["src/…"], "diff": "--- a/… +++ b/…",
    "record": { "model": "ornith-1.0-9b-64k", "exit": { "reason": "completed" },
                "toolCallCount": 6, "toolSequence": [ … ],
                "workdirChange": { "changed": true }, "flags": { … } }
  }
  ```
  No `finalText`, no answer-key.

- **`verify-corpus --corpus <dir> --verifier-model <id> [--repeat K]` (consumer)** — new command.
  Reads each corpus record, rebuilds the packet with `buildEvidencePacket`, invokes the verifier
  read-only (`orn run --no-tools`), parses the verdict, and appends a row to
  `results/<task>__<arm>.jsonl` with `{ task, arm, repeat, round, pass: goldPass, verifierModel,
  verifierVerdict, verifierReason, source: "corpus" }`. Runs one model per invocation (loop in a
  shell script for several, as today).

- **`report` change** — filter out `source === "corpus"` rows so verifier-replay rows are not
  aggregated as executor attempts. `verify-report` needs no change.

### Pure, testable surface

- `corpusRecordFrom({ task, arm, round, repeat, runId, goldPass, parts, evidence, record })` —
  pure builder returning the corpus record object (no IO), so serialization is unit-testable and
  the `finalText`/answer-key exclusion is asserted directly. Lives in `src/verifier.js`,
  co-located with `buildEvidencePacket` (which it feeds) and tested in `test/verifier.test.js`.
- `buildEvidencePacket` (already pure & tested) is reused verbatim at replay-time.

## Data flow / integration — the non-qwen sweep (item 2)

```bash
rm -rf benchmarks/results benchmarks/corpus
# Phase 1 — build the corpus once (auto-caffeinated on macOS)
node benchmarks/bench.mjs run --task T6-inplace-hard --arm A --repeats 20 --save-corpus main
node benchmarks/bench.mjs run --task T3-inplace      --arm A --repeats 20 --save-corpus main
# Phase 2 — replay each candidate over the SAME corpus (no ornith re-run)
for m in qwen3.5:4b qwen3-coder:30b gemma3:4b phi4 llama3.1:8b qwen3.6-35b-a3b-64k; do
  node benchmarks/bench.mjs verify-corpus --corpus main --verifier-model "$m"
done
node benchmarks/bench.mjs verify-report   # fair cross-family table, all on identical runs
```

## Error handling

- Missing/empty corpus dir → clear error, exit non-zero (mirror existing `die`).
- A malformed corpus record → skip with a warning, continue (one bad file must not sink a sweep).
- Verifier `orn` failure / empty reply → `parseVerdict` already defaults to `uncertain`
  (escalate), which is recorded normally.
- `--save-corpus` and `--verifier-model` together → both happen (corpus written *and* inline
  verdict recorded), no conflict.

## Testing

Zero deps, `node --test`, consistent with the current suite (58/58).

- **Unit:** `corpusRecordFrom` produces the expected ground-truth fields and omits
  `finalText`/answer-key; round-trip `corpusRecordFrom → buildEvidencePacket` yields a packet
  with the mechanical evidence and none of the excluded content (reuse existing packet
  assertions).
- **Integration (fake-pi, no ollama):** `run --save-corpus tmp` writes the expected number of
  records with correct fields and no `finalText`; `verify-corpus --corpus tmp --verifier-model
  fake` reads them and writes result rows tagged `source:"corpus"` with a `verifierVerdict`;
  `verify-report` aggregates them; `report` excludes them.
- **Regression:** the existing coupled `run --verifier-model` path stays green.

## Docs to update

- `benchmarks/README.md` §"Selecting a local verifier" — document the two-phase flow.
- `docs/VERIFIER.md` §5 — point at the implemented decoupled flow.
- `.gitignore` — add `benchmarks/corpus/`.
- `CHANGELOG.md` — Added entry.

## Out of scope

Deleting/curating corpora, a committed reference corpus, batch multi-model `verify-corpus` in
one invocation, and any change to the executor, oracle, rubric, or effFP metric.
