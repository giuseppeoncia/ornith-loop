// Pure helpers for the orchestrator-selection experiment (see docs/ORCHESTRATOR.md).
//
// No IO here — the driver owns fixture restore, the agentic loop, and oracle
// scoring; this module only:
//   - parseOrchestratorOutcome — turn the local orchestrator's terminal
//     declaration into a structured outcome
//   - scoreOrchestrator        — score outcomes against the oracle's gold labels
//   - orchestratorDeltas       — per-task pass@N delta of each candidate vs the
//     Claude baseline
//
// The role (DESIGN.md, ORCHESTRATOR.md): the orchestrator is the host that runs
// the ornith-loop skill — grounding recon, minimal-scaffold prompt, orn run,
// verify, bounded corrective loop, journal. This experiment asks whether a
// lightweight LOCAL model can drive that loop, with the Layer-0 oracle kept as
// the anchor of truth and Claude kept as the escalation tier.
//
// UNLIKE the verifier, the orchestrator has no per-decision oracle ("is this the
// right grounding?" has no mechanical pass/fail). So it is scored END-TO-END:
// the loop's final workdir is graded by the task oracle, and the orchestrator's
// own terminal declaration is compared against that gold label.

// The closed set of terminal declarations a local orchestrator can make about a
// loop it drove. `done` = "I believe this task is complete, stop"; `escalate` =
// "I cannot finish this confidently — hand to the Claude audit tier". There is
// deliberately no third state: an orchestrator that is unsure must escalate.
export const OUTCOMES = ["done", "escalate"];

// Parse the orchestrator's reply into { outcome, roundsUsed, reason }.
// Robust to prose wrapping and ```json fences. GOLDEN RULE (mirrors the
// verifier's parseVerdict): anything we cannot confidently read as `done`
// defaults to `escalate` — NEVER `done`. A confabulated or unparseable "I'm
// finished" must route to Claude, not silently ship as complete. `escalate` is
// the safe action, so ambiguity resolves to it.
export function parseOrchestratorOutcome(text) {
  const raw = typeof text === "string" ? text : "";
  const obj = extractJsonObject(raw);

  const rounds = (o) => {
    const n = Number(o?.roundsUsed ?? o?.rounds);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };

  if (obj && typeof obj.outcome === "string") {
    const o = obj.outcome.trim().toLowerCase();
    if (OUTCOMES.includes(o)) {
      return {
        outcome: o,
        roundsUsed: rounds(obj),
        reason: typeof obj.reason === "string" ? obj.reason : "",
      };
    }
  }

  // Fallback: a bare token in prose. Only `done` needs an unambiguous match to
  // be accepted; if `escalate` appears, or the reply is ambiguous/absent, we
  // escalate anyway (the safe default), so we bias against a stray "done".
  const doneHit = /\bdone\b/i.test(raw);
  const escalateHit = /\bescalate\b/i.test(raw);
  if (doneHit && !escalateHit) {
    return { outcome: "done", roundsUsed: null, reason: "parsed from prose (no JSON outcome object found)" };
  }
  return {
    outcome: "escalate",
    roundsUsed: null,
    reason: "no parseable done-outcome; defaulting to escalate (route to Claude)",
  };
}

// Best-effort: parse the whole string, else the widest {...} slice (handles a
// model that wraps JSON in prose or code fences). Shared shape with verifier.js.
function extractJsonObject(text) {
  const attempt = (s) => {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };
  const whole = attempt(text.trim());
  if (whole && typeof whole === "object") return whole;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) {
    const slice = attempt(text.slice(start, end + 1));
    if (slice && typeof slice === "object") return slice;
  }
  return null;
}

// Score orchestrator outcomes against oracle gold labels, grouped by model.
// Each row: { orchestratorModel, orchestratorOutcome: "done"|"escalate",
//             pass: <boolean oracle label on the FINAL workdir> }.
//
// Asymmetric error model (parallels scoreVerifier):
//   outcome `done` + oracle pass  -> trueSuccess   (an autonomous win)
//   outcome `done` + oracle fail  -> falseSuccess  (THE fatal case: a broken
//                                     run shipped as complete — the orchestrator
//                                     rubber-stamped a failure the oracle rejects)
//   outcome `escalate`            -> escalated     (cheap; routed to Claude,
//                                     safe regardless of the oracle label)
//
// The safety metric is effectiveFalseSuccess = P(oracle fail | outcome done):
// of the loops the orchestrator declared finished, how many were actually
// broken. It must be ≈0 — since ornith already confabulates success, an
// orchestrator that also green-lights a failure erases the last check.
// autonomousPassRate is the capability metric (how often it finished the task
// itself); escalationRate is the cost paid (Claude load) to stay safe.
export function scoreOrchestrator(rows) {
  const byModel = new Map();
  for (const r of rows) {
    if (!r || r.orchestratorOutcome == null) continue;
    const model = r.orchestratorModel || "(unknown)";
    if (!byModel.has(model)) byModel.set(model, []);
    byModel.get(model).push(r);
  }

  const out = [];
  for (const [model, rs] of byModel) {
    const n = rs.length;
    const c = { trueSuccess: 0, falseSuccess: 0, escalatedOnPass: 0, escalatedOnFail: 0 };
    for (const r of rs) {
      const oraclePass = Boolean(r.pass);
      if (r.orchestratorOutcome === "done") oraclePass ? c.trueSuccess++ : c.falseSuccess++;
      else oraclePass ? c.escalatedOnPass++ : c.escalatedOnFail++;
    }
    const doneVerdicts = c.trueSuccess + c.falseSuccess;
    const escalated = c.escalatedOnPass + c.escalatedOnFail;
    out.push({
      model,
      n,
      counts: c,
      doneVerdicts,
      escalated,
      autonomousPassRate: n ? c.trueSuccess / n : 0,
      falseSuccessRate: n ? c.falseSuccess / n : 0,
      escalationRate: n ? escalated / n : 0,
      effectiveFalseSuccess: doneVerdicts ? c.falseSuccess / doneVerdicts : 0,
    });
  }
  // Safest first: lowest effectiveFalseSuccess, then most capable (highest
  // autonomous pass), then cheapest (lowest escalation), then name.
  out.sort(
    (a, b) =>
      a.effectiveFalseSuccess - b.effectiveFalseSuccess ||
      b.autonomousPassRate - a.autonomousPassRate ||
      a.escalationRate - b.escalationRate ||
      a.model.localeCompare(b.model)
  );
  return out;
}

// Per-task pass@N delta of each candidate orchestrator vs the Claude baseline
// (the primary metric in ORCHESTRATOR.md §3). "pass@N" here = autonomousPassN =
// trueSuccess / repeats: the fraction of repeats the orchestrator finished
// itself and the oracle confirmed. The baseline (Claude) never escalates, so its
// autonomousPassN is just its oracle pass rate.
//
// rows as in scoreOrchestrator, plus `task` and `repeat`. `baselineModel` names
// the reference orchestrator's rows (default "claude"). Returns one entry per
// (task, candidate model), sorted by task then model; delta is null when the
// baseline has no rows for that task.
export function orchestratorDeltas(rows, { baselineModel = "claude" } = {}) {
  // task -> model -> { repeats:Set, trueSuccess }
  const byTask = new Map();
  for (const r of rows) {
    if (!r || r.orchestratorOutcome == null || r.task == null) continue;
    const model = r.orchestratorModel || "(unknown)";
    if (!byTask.has(r.task)) byTask.set(r.task, new Map());
    const models = byTask.get(r.task);
    if (!models.has(model)) models.set(model, { repeats: new Set(), trueSuccess: 0 });
    const cell = models.get(model);
    cell.repeats.add(r.repeat);
    if (r.orchestratorOutcome === "done" && Boolean(r.pass)) cell.trueSuccess++;
  }

  const passN = (cell) => (cell && cell.repeats.size ? cell.trueSuccess / cell.repeats.size : null);

  const out = [];
  for (const [task, models] of byTask) {
    const base = passN(models.get(baselineModel));
    for (const [model, cell] of models) {
      if (model === baselineModel) continue;
      const cand = passN(cell);
      out.push({
        task,
        model,
        autonomousPassN: cand,
        baselinePassN: base,
        delta: cand != null && base != null ? cand - base : null,
      });
    }
  }
  out.sort((a, b) => (a.task === b.task ? a.model.localeCompare(b.model) : a.task.localeCompare(b.task)));
  return out;
}
