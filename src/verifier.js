// Pure helpers for the Layer-1 LLM verifier (see docs/VERIFIER.md).
//
// No IO here. The driver (benchmarks/bench.mjs) and the skill own fixture
// restore, test execution, diffing, and orn invocation; this module only:
//   - buildEvidencePacket  — assemble the ground-truth packet a verifier reads
//   - parseVerdict         — turn the model's reply into a structured verdict
//   - scoreVerifier        — score verdicts against the oracle's gold labels
//
// Two-layer verification (DESIGN.md): Layer 0 is the mechanical oracle (gold
// truth); Layer 1 is this LLM reviewer, run local-first with a `pass` verdict
// auto-accepted and `fail`/`uncertain` escalated to the Claude audit tier.

export const VERDICTS = ["pass", "fail", "uncertain"];

// The evidence packet a verifier model adjudicates. GROUND TRUTH ONLY: goal +
// grounding + the MECHANICAL results (test output, diff, changed files) + the
// `orn` run-record signals. It deliberately EXCLUDES two things:
//   - ornith's own finalText/prose — the model must never judge from the
//     executor's self-report (it confabulates success);
//   - the task answer-key (allowedChangedFiles, byte-guard strings) — the model
//     must INFER scope from goal+grounding+diff, exactly as it must on a real
//     task that ships no oracle. That is what the selection experiment measures.
export function buildEvidencePacket({
  goal = "",
  grounding = "",
  testCmd = null,
  testOutput = "",
  testExitCode = null,
  changedFiles = [],
  diff = "",
  record = null,
} = {}) {
  const sec = (title, body) => `## ${title}\n${body}`.trimEnd();
  const parts = [];

  parts.push(sec("GOAL", (goal || "(none)").trim()));
  if (grounding && grounding.trim()) parts.push(sec("GROUNDING", grounding.trim()));

  const cmd = Array.isArray(testCmd) ? testCmd.join(" ") : testCmd || "(unspecified)";
  parts.push(
    sec(
      "TEST RESULT",
      `command: ${cmd}\nexit code: ${testExitCode === null ? "(unknown)" : testExitCode}\n\n${(testOutput || "(no output captured)").trim()}`
    )
  );

  const files = Array.isArray(changedFiles) ? changedFiles : [];
  parts.push(sec("CHANGED FILES", files.length ? files.map((f) => `- ${f}`).join("\n") : "(none — the workdir is unchanged)"));

  parts.push(sec("DIFF", (diff && diff.trim()) || "(empty)"));

  parts.push(sec("RUN SIGNALS (from orn, heuristics — corroborate, don't trust blindly)", formatRunSignals(record)));

  return parts.join("\n\n") + "\n";
}

function formatRunSignals(record) {
  if (!record) return "(no run record)";
  const lines = [];
  if (record.model) lines.push(`model: ${record.model}`);
  if (record.exit?.reason) lines.push(`exit: ${record.exit.reason}`);
  if (typeof record.toolCallCount === "number") lines.push(`tool calls: ${record.toolCallCount}`);
  const seq = Array.isArray(record.toolSequence) ? record.toolSequence : [];
  if (seq.length) {
    const names = seq.map((t) => (t && t.isError ? `${t.name}!` : t?.name)).filter(Boolean).join(" → ");
    if (names) lines.push(`tool sequence: ${names}   (a trailing ! marks a tool error)`);
  }
  if (record.workdirChange) lines.push(`workdir changed: ${record.workdirChange.changed}`);
  const onFlags = Object.entries(record.flags || {}).filter(([, v]) => v).map(([k]) => k);
  lines.push(`flags on: ${onFlags.length ? onFlags.join(", ") : "(none)"}`);
  return lines.join("\n");
}

// Parse the verifier model's reply into { verdict, evidence, reason }.
// Robust to prose wrapping and ```json fences. GOLDEN RULE: anything we cannot
// confidently read as pass/fail defaults to "uncertain" — NEVER "pass". A
// confabulated or unparseable reply must escalate, not silently green-light.
export function parseVerdict(text) {
  const raw = typeof text === "string" ? text : "";
  const obj = extractJsonObject(raw);

  if (obj && typeof obj.verdict === "string") {
    const v = obj.verdict.trim().toLowerCase();
    if (VERDICTS.includes(v)) {
      return {
        verdict: v,
        evidence: Array.isArray(obj.evidence) ? obj.evidence.map(String) : [],
        reason: typeof obj.reason === "string" ? obj.reason : "",
      };
    }
  }

  // Fallback: a bare verdict token somewhere in the prose. Only accept an
  // unambiguous single match; ambiguity or absence -> uncertain.
  const hits = VERDICTS.filter((v) => new RegExp(`\\b${v}\\b`, "i").test(raw));
  if (hits.length === 1 && hits[0] !== "uncertain") {
    return { verdict: hits[0], evidence: [], reason: "parsed from prose (no JSON verdict object found)" };
  }
  return { verdict: "uncertain", evidence: [], reason: "no parseable verdict; defaulting to uncertain (escalate)" };
}

// Best-effort: parse the whole string, else the widest {...} slice (handles a
// model that wraps JSON in prose or code fences).
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

// Score verifier verdicts against oracle gold labels, grouped by model.
// Each row: { verifierModel, verifierVerdict: "pass"|"fail"|"uncertain",
//             pass: <boolean oracle label> }.
//
// Co-verifier semantics: a `pass` verdict is auto-accepted; `fail` and
// `uncertain` both escalate to the Claude audit tier. So the metric that
// governs safety is effectiveFalsePass = P(oracle fail | verdict pass) — the
// rate at which a real failure is silently green-lit. The whole point of the
// `uncertain` state is to drive that number to ~0 by escalating instead of
// guessing. escalationRate is the cost paid (Opus load) to get there.
export function scoreVerifier(rows) {
  const byModel = new Map();
  for (const r of rows) {
    if (!r || r.verifierVerdict == null) continue;
    const model = r.verifierModel || "(unknown)";
    if (!byModel.has(model)) byModel.set(model, []);
    byModel.get(model).push(r);
  }

  const out = [];
  for (const [model, rs] of byModel) {
    const n = rs.length;
    const c = { truePass: 0, falsePass: 0, trueFail: 0, falseFail: 0, uncertainOnPass: 0, uncertainOnFail: 0 };
    for (const r of rs) {
      const oraclePass = Boolean(r.pass);
      const v = r.verifierVerdict;
      if (v === "pass") oraclePass ? c.truePass++ : c.falsePass++;
      else if (v === "fail") oraclePass ? c.falseFail++ : c.trueFail++;
      else oraclePass ? c.uncertainOnPass++ : c.uncertainOnFail++;
    }
    const passVerdicts = c.truePass + c.falsePass;
    const decided = passVerdicts + c.trueFail + c.falseFail;
    const escalated = c.falseFail + c.trueFail + c.uncertainOnPass + c.uncertainOnFail; // fail + uncertain
    out.push({
      model,
      n,
      oraclePass: c.truePass + c.falseFail + c.uncertainOnPass,
      oracleFail: c.falsePass + c.trueFail + c.uncertainOnFail,
      counts: c,
      passVerdicts,
      escalated,
      agreementRate: decided ? (c.truePass + c.trueFail) / decided : null,
      falsePassRate: n ? c.falsePass / n : 0,
      falseFailRate: n ? c.falseFail / n : 0,
      escalationRate: n ? escalated / n : 0,
      effectiveFalsePass: passVerdicts ? c.falsePass / passVerdicts : 0,
    });
  }
  out.sort((a, b) => a.effectiveFalsePass - b.effectiveFalsePass || a.escalationRate - b.escalationRate || a.model.localeCompare(b.model));
  return out;
}

// Freeze one executor run into a corpus record for decoupled verification
// (docs/superpowers/specs/2026-07-11-decouple-executions-design.md). Stores raw
// ground-truth evidence + the gold label so any candidate verifier can be
// replayed later over the SAME run via buildEvidencePacket. Slims the run record
// to the signals formatRunSignals uses and DROPS finalText — the executor's prose
// must never reach the verifier, exactly as in the live path.
export function corpusRecordFrom({
  task, arm, round = 1, repeat, runId = null, goldPass,
  goal = "", grounding = "", evidence = {}, record = null,
} = {}) {
  const r = record || {};
  const slimRecord = {
    model: r.model ?? null,
    exit: { reason: r.exit?.reason ?? null },
    toolCallCount: typeof r.toolCallCount === "number" ? r.toolCallCount : null,
    toolSequence: Array.isArray(r.toolSequence) ? r.toolSequence : [],
    workdirChange: r.workdirChange ? { changed: r.workdirChange.changed } : null,
    flags: r.flags || {},
  };
  return {
    task, arm, round, repeat, runId,
    goldPass: Boolean(goldPass),
    goal, grounding,
    testCmd: evidence.testCmd ?? null,
    testOutput: evidence.testOutput ?? "",
    testExitCode: evidence.testExitCode ?? null,
    changedFiles: Array.isArray(evidence.changedFiles) ? evidence.changedFiles : [],
    diff: evidence.diff ?? "",
    record: slimRecord,
  };
}
