// Pure helpers for the benchmark pilot (docs/BENCHMARK.md).
// No IO here — the driver (benchmarks/bench.mjs) owns fixture restore, orn
// invocation, and oracle scoring; this module is what the tests exercise.

// The four arms. `parts` = which fixture files compose the prompt (in order);
// `loop` = whether corrective rounds are allowed (agent-driven, see runbook).
// A vs B2 differ ONLY by the `scaffold` part; A vs B3 differ ONLY by `loop`.
export const ARMS = {
  A: { parts: ["goal", "grounding"], loop: true, label: "full method (grounding + minimal, loop)" },
  B1: { parts: ["goal"], loop: false, label: "bare ornith (goal only, single-shot)" },
  B2: { parts: ["goal", "grounding", "scaffold"], loop: true, label: "heavy scaffold (loop adds scaffold)" },
  B3: { parts: ["goal", "grounding"], loop: false, label: "single-shot (minimal, no loop)" },
};

export const ARM_IDS = Object.keys(ARMS);

// Assemble the prompt an arm sends, mechanically, from the fixture parts.
// `parts` is { goal, grounding, scaffold } (strings; missing = ""). `extra` is
// agent-authored corrective grounding (arm A) or extra scaffold (arm B2),
// appended on rounds >= 2 — never on round 1.
export function assemblePrompt(arm, parts, { round = 1, extra = "" } = {}) {
  const spec = ARMS[arm];
  if (!spec) throw new Error(`unknown arm '${arm}': one of ${ARM_IDS.join(", ")}`);
  const sections = [];
  for (const key of spec.parts) {
    const text = (parts[key] || "").trim();
    if (text) sections.push(text);
  }
  if (round > 1) {
    if (!spec.loop) throw new Error(`arm '${arm}' is single-shot; no round ${round}`);
    const e = (extra || "").trim();
    if (e) sections.push(e);
  }
  return sections.join("\n\n");
}

// Roll raw attempt rows into the per-(task,arm) report. Each row:
//   { task, arm, repeat, round, pass, flags: {tool-call-as-text, ...} }
// pass@1 = fraction of repeats whose round-1 attempt passed.
// pass@N = fraction of repeats that passed on ANY round within budget.
// roundsToPass = distribution over repeats: which round first passed (or null).
export function aggregate(rows) {
  const byKey = new Map();
  for (const r of rows) {
    if (r && r.source === "corpus") continue; // verifier-replay rows are not executor attempts
    const key = `${r.task} ${r.arm}`;
    if (!byKey.has(key)) byKey.set(key, { task: r.task, arm: r.arm, attempts: [] });
    byKey.get(key).attempts.push(r);
  }

  const report = [];
  for (const { task, arm, attempts } of byKey.values()) {
    const repeats = new Map();
    for (const a of attempts) {
      if (!repeats.has(a.repeat)) repeats.set(a.repeat, []);
      repeats.get(a.repeat).push(a);
    }
    const n = repeats.size;
    let pass1 = 0;
    let passN = 0;
    const roundsToPass = {}; // round -> count; "never" -> count
    const flagTotals = {};
    let attemptCount = 0;

    for (const attemptsForRepeat of repeats.values()) {
      const sorted = [...attemptsForRepeat].sort((a, b) => a.round - b.round);
      const r1 = sorted.find((a) => a.round === 1);
      if (r1?.pass) pass1++;
      const firstPass = sorted.find((a) => a.pass);
      if (firstPass) {
        passN++;
        roundsToPass[firstPass.round] = (roundsToPass[firstPass.round] || 0) + 1;
      } else {
        roundsToPass.never = (roundsToPass.never || 0) + 1;
      }
      for (const a of sorted) {
        attemptCount++;
        for (const [flag, on] of Object.entries(a.flags || {})) {
          if (on) flagTotals[flag] = (flagTotals[flag] || 0) + 1;
        }
      }
    }

    const flagRates = {};
    for (const [flag, count] of Object.entries(flagTotals)) {
      flagRates[flag] = attemptCount ? count / attemptCount : 0;
    }

    report.push({
      task,
      arm,
      repeats: n,
      attempts: attemptCount,
      pass1Rate: n ? pass1 / n : 0,
      passNRate: n ? passN / n : 0,
      roundsToPass,
      flagRates,
    });
  }
  report.sort((a, b) => (a.task === b.task ? a.arm.localeCompare(b.arm) : a.task.localeCompare(b.task)));
  return report;
}

// caffeinate argv to keep a Mac awake for a long run, or null off darwin.
// A sweep spans hours; if the Mac idle-sleeps mid-run it truncates the in-flight
// orn call into a spurious timeout / no-change "fail" (observed 2026-07-11 — four
// K=20 rows contaminated). `-i` prevents idle system sleep, `-m` disk idle sleep,
// `-s` system sleep on AC; `-w <pid>` releases the assertion when our process
// exits, so no cleanup is needed. caffeinate is macOS-only → null elsewhere.
export function caffeinateArgs(platform, pid) {
  if (platform !== "darwin") return null;
  return ["-i", "-m", "-s", "-w", String(pid)];
}

// The three headline deltas from DESIGN.md's hypotheses, per task.
//   H2 = A - B1 (wrapper vs nothing); H1 = A - B2 (don't-steal-the-nest);
//   H3 = A - B3 (loop value). Uses passNRate for looped arms, pass1Rate for B1/B3.
export function deltas(report) {
  const byTask = new Map();
  for (const row of report) {
    if (!byTask.has(row.task)) byTask.set(row.task, {});
    byTask.get(row.task)[row.arm] = row;
  }
  const out = [];
  for (const [task, arms] of byTask) {
    const rate = (r, looped) => (r ? (looped ? r.passNRate : r.pass1Rate) : null);
    const a = rate(arms.A, true);
    const b1 = rate(arms.B1, false);
    const b2 = rate(arms.B2, true);
    const b3 = rate(arms.B3, false);
    out.push({
      task,
      A: a,
      "H2_A_minus_B1": a != null && b1 != null ? a - b1 : null,
      "H1_A_minus_B2": a != null && b2 != null ? a - b2 : null,
      "H3_A_minus_B3": a != null && b3 != null ? a - b3 : null,
    });
  }
  out.sort((x, y) => x.task.localeCompare(y.task));
  return out;
}
