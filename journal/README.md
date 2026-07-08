# Experiment Journal

One Markdown file per run: `journal/YYYY-MM-DD-<label>.md` (append `-2`, `-3` … on
same-day/label collision). Entries are **self-contained** — they embed the observability
summary so the journal survives even though raw run records under `runs/` are gitignored
and ephemeral.

## Template

    # <label> — <YYYY-MM-DD>

    - **Model:** ornith-1.0-9b-64k
    - **Task (goal given to ornith):** <one line>
    - **Grounding supplied:** <paths/versions/routes/selectors the model could not derive>
    - **Run record:** runs/<runId>.json  (ephemeral; key facts embedded below)

    ## What the self-scaffold did
    - Exit: <completed|timeout|error>, stopReason <…>, <N>s
    - Tool sequence (<n>): read → write → bash → …
    - Thinking blocks: <n>
    - Flags: <tool-call-as-text? stopped-before-tool-call? claimed-done? claimed-done-no-change?>

    ## External verification (Claude)
    - How verified: <build / test / diff / rendered output>
    - Verdict: <pass | fail>, evidence: <…>

    ## Corrective rounds
    - Round 1: added grounding <…> → <result>

    ## Notes / lessons (grounding for next time)
    - <what grounding helped; which failure mode appeared>

## Benchmark template (multi-run / multi-arm)

For a benchmark pilot (`benchmarks/`, per `docs/BENCHMARK.md`) a single-run entry does not
fit: a pilot is many runs across four arms and several tasks, and its deliverable is the
*delta between arms*, not one tool sequence. Use `journal/YYYY-MM-DD-benchmark-<suite>.md`
with this shape. The results under `benchmarks/results/` are gitignored and ephemeral, so —
as with normal entries — **embed the numbers here** (paste the `bench.mjs report` output).

    # benchmark: <suite> — <YYYY-MM-DD>

    - **Model(s):** ornith-1.0-9b-64k  (and/or qwen3.6-35b-a3b-64k)
    - **Tasks:** T1-scratch, T2-additive, T3-inplace  (edit modes: scratch / additive / in-place)
    - **Arms:** A (method) · B1 (bare) · B2 (heavy scaffold) · B3 (single-shot)
    - **Repeats (K):** <n> per (task, arm)
    - **Pre-registered:** suite + heavy-scaffold prompts + K + hypotheses frozen before running? <yes/no>
    - **Host / reviewer:** <Claude Code | opencode>, <model>

    ## Results (paste `node benchmarks/bench.mjs report`)
    ```
    <table: per task × arm — pass@1 / pass@N / rounds→pass>
    <table: hypothesis deltas — H2 A−B1, H1 A−B2, H3 A−B3>
    ```

    ## Reading of the deltas (against the pre-committed clause)
    - **H1 (A vs B2, "don't steal the nest"):** <A>B2 → thesis holds | A≈B2 → scaffold-neutral | A<B2 → thesis wrong>, evidence <…>
    - **H2 (A vs B1, wrapper value):** <…>
    - **H3 (A vs B3, loop value):** <…>
    - **Honest-null check:** if A ≈ B1 ≈ B3 across tasks → conclusion is "usability/observability
      wrapper, not a performance multiplier." State it plainly if that is what the numbers say.

    ## Failure modes observed (from run-record flags, per arm)
    - <which of tool-call-as-text / stopped-before-tool-call / claimed-done-no-change dominated, and where>
    - In-place corruption (T3): <did it appear; did grounding/verification catch or prevent it>

    ## Corrective rounds (arms A / B2)
    - <task/arm/repeat>: round <n> added <grounding (A) | scaffold (B2)> <…> → <passed | still failing>

    ## Threats / caveats for this run
    - <small-K variance, B2 strawman risk, seed/none, any task that misbehaved>

    ## Notes / lessons (grounding for next time)
    - <what grounding made self-scaffolding succeed; what to change in the suite or arms>
