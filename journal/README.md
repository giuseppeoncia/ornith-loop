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
