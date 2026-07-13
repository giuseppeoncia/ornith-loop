#!/usr/bin/env node
// ornith-loop benchmark pilot driver (docs/BENCHMARK.md).
//
// Mechanical layer only: it restores a task fixture git-clean, assembles the
// per-arm prompt from the fixture files, invokes `orn run`, scores the result
// with the task's oracle, and appends a row to benchmarks/results/. The
// *judgment* — what corrective grounding (arm A) or scaffold (arm B2) to add
// between rounds — stays with the agent (see benchmarks/README.md); pass it in
// via --extra on --round >= 2.
//
// Usage:
//   node benchmarks/bench.mjs run --task T1-scratch --arm B3 --repeats 5
//   node benchmarks/bench.mjs run --task T3-inplace --arm A --round 2 --extra corr.md --repeat 3
//   node benchmarks/bench.mjs report
//
// Needs a working `orn` (this repo) + pi + ollama + the target model, EXCEPT
// under ORN_PI_BIN=<fake> which stubs pi for a mechanics-only dry run.

import { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, cpSync, appendFileSync, readdirSync } from "node:fs";
import { spawnSync, spawn } from "node:child_process";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { ARMS, ARM_IDS, assemblePrompt, aggregate, deltas, caffeinateArgs } from "../src/bench.js";
import { buildEvidencePacket, parseVerdict, scoreVerifier, corpusRecordFrom } from "../src/verifier.js";
import { scoreOrchestrator, orchestratorDeltas, parseRoundDecision, parseGrounding } from "../src/orchestrator.js";
import { gatherEvidence } from "../src/evidence.js";
import { loadConfig } from "../src/config.js";
import { extractRecon, renderFactPool } from "../src/recon.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ORN = resolve(HERE, "..", "bin", "orn.js");
const TASKS_DIR = join(HERE, "tasks");
const RESULTS_DIR = join(HERE, "results");
const RUBRIC_PATH = resolve(HERE, "..", "verifier", "rubric.md");
const ORCH_RUBRIC_PATH = resolve(HERE, "..", "orchestrator", "rubric.md");
const ORCH_RECON_RUBRIC_PATH = resolve(HERE, "..", "orchestrator", "recon-rubric.md");

function die(msg) {
  process.stderr.write(`bench: ${msg}\n`);
  process.exit(2);
}

// Keep the Mac awake for the whole run: an idle sleep mid-sweep truncates the
// in-flight orn call into a spurious timeout/no-change fail (journal 2026-07-11).
// caffeinate holds the assertion until our pid exits (-w), so no cleanup is
// needed; best-effort (missing binary or non-darwin is a silent no-op).
function keepAwake() {
  const args = caffeinateArgs(process.platform, process.pid);
  if (!args) return;
  try {
    const child = spawn("caffeinate", args, { stdio: "ignore", detached: true });
    child.on("error", () => {}); // caffeinate absent -> ignore
    child.unref();
    process.stdout.write(`bench: caffeinate active (${args.join(" ")}) — no idle sleep during this run\n`);
  } catch {
    /* best-effort */
  }
}

function parseFlags(args) {
  const o = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) o[a.slice(2)] = args[i + 1]?.startsWith("--") || args[i + 1] === undefined ? true : args[++i];
    else o._ = (o._ || []).concat(a);
  }
  return o;
}

function readPart(taskDir, name) {
  const p = join(taskDir, name);
  return existsSync(p) ? readFileSync(p, "utf8") : "";
}

function loadTask(task) {
  const dir = join(TASKS_DIR, task);
  if (!existsSync(dir)) die(`unknown task '${task}' (looked in ${TASKS_DIR})`);
  const meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8"));
  return {
    dir,
    meta,
    parts: {
      goal: readPart(dir, "goal.md"),
      grounding: readPart(dir, "grounding.md"),
      scaffold: readPart(dir, "scaffold-heavy.md"),
    },
  };
}

// Fresh git-clean workdir seeded from the task template.
function makeWorkdir(task) {
  const wd = mkdtempSync(join(tmpdir(), `bench-${task.meta.id}-`));
  const template = join(task.dir, "template");
  if (existsSync(template)) cpSync(template, wd, { recursive: true });
  const git = (args) => spawnSync("git", ["-c", "user.email=bench@local", "-c", "user.name=bench", ...args], { cwd: wd, encoding: "utf8" });
  git(["init", "-q"]);
  git(["add", "-A"]);
  git(["commit", "-q", "--allow-empty", "-m", "base"]);
  return wd;
}

function runOrn({ prompt, workdir, model, label, runsDir, env, noTools }) {
  const argv = [ORN, "run", prompt, "--label", label, "--runs-dir", runsDir];
  if (workdir) argv.push("--workdir", workdir); // verifier calls run without a workdir
  if (model) argv.push("--model", model);
  if (noTools) argv.push("--no-tools"); // verifier adjudicates read-only: no tools, reply inline only
  const res = spawnSync(process.execPath, argv, { encoding: "utf8", env: env || process.env });
  // Match the record path on its OWN line: orn prints the model's finalText (which may
  // itself contain "record:") before the trailing `record: <path>` line, so an unanchored
  // match can be hijacked by model output.
  const m = (res.stdout || "").match(/^record:\s*(\S+)/m);
  const recordPath = m && existsSync(m[1]) ? m[1] : "";
  const record = recordPath ? JSON.parse(readFileSync(recordPath, "utf8")) : null;
  return { record, recordPath, stdout: res.stdout, stderr: res.stderr, status: res.status };
}

function runOracle(task, workdir, recordPath) {
  const oracle = join(task.dir, "oracle.mjs");
  if (!existsSync(oracle)) die(`task ${task.meta.id} has no oracle.mjs`);
  const res = spawnSync(process.execPath, [oracle], {
    encoding: "utf8",
    env: { ...process.env, BENCH_WORKDIR: workdir, BENCH_RECORD: recordPath || "" },
  });
  return { pass: res.status === 0, output: (res.stdout || "") + (res.stderr || "") };
}

let RUBRIC_CACHE = null;
function loadRubric() {
  if (RUBRIC_CACHE === null) RUBRIC_CACHE = readFileSync(RUBRIC_PATH, "utf8");
  return RUBRIC_CACHE;
}

// Adjudicate a pre-gathered evidence bundle with a verifier model, read-only.
// Shared by the coupled `run --verifier-model` path and `verify-corpus`. The
// verifier reads the packet from the prompt (no --workdir) and MUST reply inline
// (--no-tools): otherwise pi runs in the repo cwd with write tools live and a
// tool-eager model writes its verdict to a file (journal 2026-07-10).
function adjudicate({ goal, grounding, evidence, record, model, label }) {
  const packet = buildEvidencePacket({
    goal, grounding,
    testCmd: evidence.testCmd, testOutput: evidence.testOutput, testExitCode: evidence.testExitCode,
    changedFiles: evidence.changedFiles, diff: evidence.diff, record,
  });
  const prompt = `${loadRubric()}\n\n---\n\n# EVIDENCE PACKET\n\n${packet}`;
  const runsDir = mkdtempSync(join(tmpdir(), "bench-verify-"));
  try {
    const orn = runOrn({ prompt, model, label, runsDir, noTools: true });
    return parseVerdict(orn.record?.finalText || "");
  } finally {
    rmSync(runsDir, { recursive: true, force: true });
  }
}

function cmdRun(o) {
  const task = o.task || die("--task required");
  const arm = o.arm || die("--arm required");
  if (!ARM_IDS.includes(arm)) die(`unknown arm '${arm}': one of ${ARM_IDS.join(", ")}`);
  const round = Number(o.round || 1);
  const repeats = o.repeat ? [Number(o.repeat)] : Array.from({ length: Number(o.repeats || 1) }, (_, i) => i + 1);
  const model = typeof o.model === "string" ? o.model : undefined;
  const verifierModel = typeof o["verifier-model"] === "string" ? o["verifier-model"] : undefined;
  const saveCorpus = typeof o["save-corpus"] === "string" ? o["save-corpus"] : undefined;
  const resultsDir = typeof o["results-dir"] === "string" ? o["results-dir"] : RESULTS_DIR;
  const extra = typeof o.extra === "string" ? readFileSync(o.extra, "utf8") : "";
  if (round > 1 && !ARMS[arm].loop) die(`arm ${arm} is single-shot; --round ${round} is invalid`);

  const t = loadTask(task);
  keepAwake(); // long run: don't let the Mac idle-sleep and truncate orn calls
  const prompt = assemblePrompt(arm, t.parts, { round, extra });
  mkdirSync(resultsDir, { recursive: true });
  if (saveCorpus) mkdirSync(saveCorpus, { recursive: true });
  const resultsFile = join(resultsDir, `${task}__${arm}.jsonl`);

  for (const repeat of repeats) {
    const wd = makeWorkdir(t);
    // Run records are harness artifacts, NOT task output: keep them OUTSIDE the
    // workdir so the oracle's scope check (git status on wd) never sees them.
    const runsDir = mkdtempSync(join(tmpdir(), `bench-runs-${t.meta.id}-`));
    const label = `${task}-${arm}-r${round}-k${repeat}`;
    let row;
    try {
      const orn = runOrn({ prompt, workdir: wd, model, label, runsDir });
      const recPath = orn.recordPath;
      const oracle = runOracle(t, wd, recPath);
      row = {
        task, arm, repeat, round,
        pass: oracle.pass,
        flags: orn.record?.flags || {},
        exit: orn.record?.exit?.reason || null,
        toolSequence: orn.record?.toolSequence || [],
        changed: orn.record?.workdirChange?.changed ?? null,
        oracle: oracle.output.trim().slice(0, 500),
        runId: orn.record?.runId || null,
        model: orn.record?.model || model || null,
      };
      // Gather the mechanical evidence once if either consumer needs it.
      const ev = verifierModel || saveCorpus ? gatherEvidence(wd, t.meta.testCmd) : null;
      if (saveCorpus && ev) {
        const rec = corpusRecordFrom({
          task, arm, round, repeat, runId: orn.record?.runId || null,
          goldPass: oracle.pass, goal: t.parts.goal, grounding: t.parts.grounding,
          evidence: ev, record: orn.record,
        });
        writeFileSync(join(saveCorpus, `${task}__${arm}__r${round}__k${repeat}.json`), JSON.stringify(rec, null, 2));
      }
      if (verifierModel && ev) {
        const v = adjudicate({
          goal: t.parts.goal, grounding: t.parts.grounding, evidence: ev,
          record: orn.record, model: verifierModel, label: `verify-${t.meta.id}`,
        });
        row.verifierModel = verifierModel;
        row.verifierVerdict = v.verdict;
        row.verifierReason = v.reason;
      }
    } finally {
      rmSync(wd, { recursive: true, force: true });
      rmSync(runsDir, { recursive: true, force: true });
    }
    appendFileSync(resultsFile, JSON.stringify(row) + "\n");
    const vtag = row.verifierVerdict ? `, verifier ${row.verifierVerdict}` : "";
    const ctag = saveCorpus ? ", corpus✓" : "";
    process.stdout.write(`${label}: ${row.pass ? "PASS" : "fail"} (exit ${row.exit}, tools ${row.toolSequence.length}, changed ${row.changed}${vtag}${ctag})\n`);
  }
}

function loadRows() {
  if (!existsSync(RESULTS_DIR)) return [];
  const rows = [];
  for (const f of readdirSync(RESULTS_DIR).filter((f) => f.endsWith(".jsonl"))) {
    for (const line of readFileSync(join(RESULTS_DIR, f), "utf8").split("\n")) {
      const t = line.trim();
      if (t) rows.push(JSON.parse(t));
    }
  }
  return rows;
}

function pct(x) {
  return x == null ? "  —  " : `${(x * 100).toFixed(0).padStart(3)}%`;
}
function signed(x) {
  if (x == null) return "  —  ";
  const p = (x * 100).toFixed(0);
  return `${x > 0 ? "+" : ""}${p}%`.padStart(5);
}

function cmdReport() {
  const rows = loadRows();
  if (!rows.length) return process.stdout.write(`no results yet (run some arms first; results in ${RESULTS_DIR})\n`);
  const report = aggregate(rows);

  process.stdout.write("\nPer task × arm\n");
  process.stdout.write("task            arm  reps  pass@1  pass@N  rounds→pass\n");
  for (const r of report) {
    const rtp = Object.entries(r.roundsToPass).map(([k, v]) => `${k}:${v}`).join(" ") || "—";
    process.stdout.write(
      `${r.task.padEnd(15)} ${r.arm.padEnd(3)} ${String(r.repeats).padStart(4)}  ${pct(r.pass1Rate)}   ${pct(r.passNRate)}   ${rtp}\n`
    );
  }

  process.stdout.write("\nHypothesis deltas (positive favours the method)\n");
  process.stdout.write("task            A(passN)  H2:A−B1  H1:A−B2  H3:A−B3\n");
  for (const d of deltas(report)) {
    process.stdout.write(
      `${d.task.padEnd(15)}  ${pct(d.A)}    ${signed(d["H2_A_minus_B1"])}    ${signed(d["H1_A_minus_B2"])}    ${signed(d["H3_A_minus_B3"])}\n`
    );
  }
  process.stdout.write("\nH1 = don't-steal-the-nest · H2 = wrapper vs nothing · H3 = loop value\n");
}

// Score the Layer-1 verifier against the oracle's gold labels (docs/VERIFIER.md).
// The selection metric is effFP (effectiveFalsePass) = P(oracle fail | verdict
// pass): how often an auto-accepted `pass` was actually wrong. Pick the lightest
// model with effFP ≈ 0 at an acceptable escalation rate.
function cmdVerifyReport() {
  const rows = loadRows().filter((r) => r.verifierVerdict);
  if (!rows.length) return process.stdout.write("no verifier results yet (run some arms with --verifier-model <id>)\n");
  const scored = scoreVerifier(rows);

  process.stdout.write("\nVerifier vs oracle (sorted safest-first)\n");
  process.stdout.write("model                          n  agree  falsePass  effFP  escalate\n");
  for (const s of scored) {
    process.stdout.write(
      `${String(s.model).padEnd(28)} ${String(s.n).padStart(3)}  ${pct(s.agreementRate)}   ${pct(s.falsePassRate)}   ${pct(s.effectiveFalsePass)}   ${pct(s.escalationRate)}\n`
    );
  }
  process.stdout.write(
    "\neffFP = false-pass among auto-accepted passes (the safety metric; want ≈0)\n" +
      "escalate = share routed to the Claude audit tier (fail + uncertain)\n"
  );
}

// Score a candidate LOCAL orchestrator against the oracle + the Claude baseline
// (docs/ORCHESTRATOR.md). Rows carry `orchestratorModel` / `orchestratorOutcome`
// (`done`|`escalate`) alongside the oracle `pass`. The safety metric is effFS
// (effectiveFalseSuccess) = P(oracle fail | outcome done): how often a loop the
// orchestrator declared finished was actually broken — want ≈0. The capability
// metric is the per-task pass@N delta vs the Claude baseline rows.
//
// Rows are recorded the same way as verifier rows — appended to
// benchmarks/results/*.jsonl — so a semi-manual pilot (Phase 1, like the
// verifier campaign) can populate them without the execution driver below.
function cmdOrchestrateReport(o) {
  const rows = loadRows().filter((r) => r.orchestratorOutcome);
  if (!rows.length) return process.stdout.write("no orchestrator results yet (see `orchestrate` and docs/ORCHESTRATOR.md)\n");
  const baselineModel = typeof o.baseline === "string" ? o.baseline : "claude";
  const scored = scoreOrchestrator(rows);

  process.stdout.write("\nOrchestrator vs oracle (sorted safest-first)\n");
  process.stdout.write("model                          n  autoPass  falseSucc  effFS  escalate\n");
  for (const s of scored) {
    process.stdout.write(
      `${String(s.model).padEnd(28)} ${String(s.n).padStart(3)}  ${pct(s.autonomousPassRate)}    ${pct(s.falseSuccessRate)}   ${pct(s.effectiveFalseSuccess)}   ${pct(s.escalationRate)}\n`
    );
  }

  const dl = orchestratorDeltas(rows, { baselineModel });
  if (dl.length) {
    process.stdout.write(`\nPer-task pass@N delta vs baseline '${baselineModel}' (positive = candidate matches/beats Claude)\n`);
    process.stdout.write("task            model                    passN  baseN   delta\n");
    for (const d of dl) {
      process.stdout.write(
        `${d.task.padEnd(15)} ${String(d.model).padEnd(24)} ${pct(d.autonomousPassN)}  ${pct(d.baselinePassN)}  ${signed(d.delta)}\n`
      );
    }
  }
  process.stdout.write(
    "\neffFS = false-success among 'done' calls (the safety metric; want ≈0)\n" +
      "autoPass = loops the orchestrator finished itself and the oracle confirmed\n" +
      "escalate = share routed to the Claude audit tier\n"
  );
}

// Drive a candidate LOCAL model as the orchestrator through the ornith-loop
// (docs/ORCHESTRATOR.md; spec docs/superpowers/specs/2026-07-12-orchestrate-driver-m1-design.md).
// M1: recon is FIXED (round-1 grounding = frozen grounding.md); the candidate owns
// only the per-round decision (done/retry/escalate) + the corrective grounding fact.
// Presidia: Layer-0 oracle scores post-hoc and is never shown to the candidate; the
// Layer-1 verifier is a separate model. One row per (task, repeat).
// M2: the candidate assembles round-1 grounding from the deterministic fact-pool.
// Read-only, inline (--no-tools). Returns { grounding, empty } (parseGrounding).
function assembleRecon({ task, goal, factPoolText, model }) {
  const rubric = readFileSync(ORCH_RECON_RUBRIC_PATH, "utf8");
  const prompt = `${rubric}\n\n---\n\n# RECON ASSEMBLY\n\n## GOAL\n${(goal || "").trim()}\n\n${factPoolText}`;
  const runsDir = mkdtempSync(join(tmpdir(), "bench-orch-recon-"));
  try {
    const dec = runOrn({ prompt, model, label: `${task}-orch-recon`, runsDir, noTools: true });
    return parseGrounding(dec.record?.finalText || "");
  } finally {
    rmSync(runsDir, { recursive: true, force: true });
  }
}

function cmdOrchestrate(o) {
  const task = o.task || die("--task required");
  const orchestratorModel = typeof o["orchestrator-model"] === "string" ? o["orchestrator-model"] : die("--orchestrator-model <id> required");
  const verifierModel = typeof o["verifier-model"] === "string" ? o["verifier-model"] : "qwen3.5:4b";
  const maxRounds = o.rounds !== undefined && o.rounds !== true ? Number(o.rounds) : loadConfig().correctiveRounds;
  if (!Number.isInteger(maxRounds) || maxRounds < 1) die("--rounds must be an integer >= 1");
  const repeats = o.repeat ? [Number(o.repeat)] : Array.from({ length: Number(o.repeats || 1) }, (_, i) => i + 1);
  const resultsDir = typeof o["results-dir"] === "string" ? o["results-dir"] : RESULTS_DIR;
  if (orchestratorModel === verifierModel) process.stderr.write(`warning: --orchestrator-model and --verifier-model are the same ('${orchestratorModel}') — the verifier and orchestrator then run on one model, collapsing the independent check ORCHESTRATOR.md §4 keeps separate.\n`);

  const t = loadTask(task);
  keepAwake();
  mkdirSync(resultsDir, { recursive: true });
  const reconMode = o.recon === "candidate" ? "candidate" : "fixed";
  const slug = orchestratorModel.replace(/[^a-zA-Z0-9]+/g, "-");
  const resultsFile = join(resultsDir, `${task}__orch-${slug}${reconMode === "candidate" ? "-recon" : ""}.jsonl`);
  const rubric = readFileSync(ORCH_RUBRIC_PATH, "utf8");

  for (const repeat of repeats) {
    let reconGrounding = null;
    let reconEmpty = false;
    let grounding;
    if (reconMode === "candidate") {
      const reconWd = makeWorkdir(t);
      let factPoolText;
      try { factPoolText = renderFactPool(extractRecon(reconWd, t.parts.goal, { testCmd: t.meta.testCmd })); }
      finally { rmSync(reconWd, { recursive: true, force: true }); }
      const r = assembleRecon({ task, goal: t.parts.goal, factPoolText, model: orchestratorModel });
      reconGrounding = r.grounding;
      reconEmpty = r.empty;
      grounding = r.grounding || "";
    } else {
      grounding = (t.parts.grounding || "").trim(); // recon FIXED in M1
    }
    let outcome = "escalate";
    let reason = "";
    let roundsUsed = 0;
    let finalWd = null;
    let finalRunsDir = null;

    try {
      for (let round = 1; round <= maxRounds; round++) {
        roundsUsed = round;
        // discard a prior round's workdir (rounds are fresh attempts, not continuations)
        if (finalWd) rmSync(finalWd, { recursive: true, force: true });
        if (finalRunsDir) rmSync(finalRunsDir, { recursive: true, force: true });
        const wd = makeWorkdir(t);
        const runsDir = mkdtempSync(join(tmpdir(), `bench-runs-${t.meta.id}-`));
        finalWd = wd;
        finalRunsDir = runsDir;

        const prompt = `${(t.parts.goal || "").trim()}\n\n${grounding}`.trim();
        const orn = runOrn({ prompt, workdir: wd, label: `${task}-orch-k${repeat}-r${round}`, runsDir });
        const ev = gatherEvidence(wd, t.meta.testCmd);
        const verdict = adjudicate({
          goal: t.parts.goal, grounding, evidence: ev,
          record: orn.record, model: verifierModel, label: `verify-${t.meta.id}`,
        });

        const decisionPrompt =
          `${rubric}\n\n---\n\n# ORCHESTRATOR DECISION\n\n` +
          `## GOAL\n${(t.parts.goal || "").trim()}\n\n` +
          `## GROUNDING ALREADY SENT\n${grounding}\n\n` +
          `## LAST ROUND EVIDENCE\n` +
          `test exit: ${ev.testExitCode}\nchanged files: ${ev.changedFiles.join(", ") || "(none)"}\n\n` +
          `test output:\n${ev.testOutput}\n\ndiff:\n${ev.diff}\n\n` +
          `## LAYER-1 VERIFIER VERDICT\nverdict: ${verdict.verdict}\nreason: ${verdict.reason}\n\n` +
          `Rounds used: ${round} of ${maxRounds}.`;
        const decRunsDir = mkdtempSync(join(tmpdir(), "bench-orch-"));
        let decision;
        try {
          const dec = runOrn({ prompt: decisionPrompt, model: orchestratorModel, label: `${task}-orch-decide-k${repeat}-r${round}`, runsDir: decRunsDir, noTools: true });
          decision = parseRoundDecision(dec.record?.finalText || "");
        } finally {
          rmSync(decRunsDir, { recursive: true, force: true });
        }
        reason = decision.reason;

        if (decision.action === "done") { outcome = "done"; break; }
        if (decision.action === "retry" && round < maxRounds) { grounding = `${grounding}\n\n${decision.grounding}`.trim(); continue; }
        outcome = "escalate"; break; // escalate, or retry with the round budget spent
      }

      // Layer-0 gold oracle on the FINAL workdir — the anchor, never shown to the candidate.
      const oracle = runOracle(t, finalWd, "");

      const row = {
        task, repeat, orchestratorModel, orchestratorOutcome: outcome,
        pass: oracle.pass, orchestratorRounds: roundsUsed, orchestratorReason: reason, verifierModel,
        reconMode,
        ...(reconMode === "candidate" ? { reconGrounding, reconEmpty } : {}),
      };
      appendFileSync(resultsFile, JSON.stringify(row) + "\n");
      process.stdout.write(`${task}-orch-k${repeat}: ${outcome} (rounds ${roundsUsed}, oracle ${oracle.pass ? "PASS" : "fail"})\n`);
    } finally {
      if (finalWd) rmSync(finalWd, { recursive: true, force: true });
      if (finalRunsDir) rmSync(finalRunsDir, { recursive: true, force: true });
    }
  }
}

// Replay one candidate verifier over a frozen corpus (docs/VERIFIER.md §5). Runs
// ornith ZERO times: each record's ground-truth evidence is rebuilt into a packet
// and adjudicated read-only. Rows are tagged source:"corpus" so verify-report
// includes them but `report` (executor aggregate) skips them.
function cmdVerifyCorpus(o) {
  const corpus = typeof o.corpus === "string" ? o.corpus : die("--corpus <dir> required");
  const model = typeof o["verifier-model"] === "string" ? o["verifier-model"] : die("--verifier-model <id> required");
  const resultsDir = typeof o["results-dir"] === "string" ? o["results-dir"] : RESULTS_DIR;
  if (!existsSync(corpus)) die(`corpus dir not found: ${corpus}`);
  const files = readdirSync(corpus).filter((f) => f.endsWith(".json")).sort();
  if (!files.length) die(`no corpus records (*.json) in ${corpus}`);
  keepAwake();
  mkdirSync(resultsDir, { recursive: true });

  for (const f of files) {
    let rec;
    try {
      rec = JSON.parse(readFileSync(join(corpus, f), "utf8"));
    } catch {
      process.stderr.write(`bench: skipping malformed corpus record ${f}\n`);
      continue;
    }
    const v = adjudicate({
      goal: rec.goal, grounding: rec.grounding,
      evidence: { testCmd: rec.testCmd, testOutput: rec.testOutput, testExitCode: rec.testExitCode, changedFiles: rec.changedFiles, diff: rec.diff },
      record: rec.record, model, label: `verify-${rec.task}`,
    });
    const row = {
      task: rec.task, arm: rec.arm, repeat: rec.repeat, round: rec.round,
      pass: rec.goldPass, verifierModel: model, verifierVerdict: v.verdict, verifierReason: v.reason,
      source: "corpus",
    };
    appendFileSync(join(resultsDir, `${rec.task}__${rec.arm}.jsonl`), JSON.stringify(row) + "\n");
    process.stdout.write(`${rec.task}-${rec.arm}-r${rec.round}-k${rec.repeat}: gold ${rec.goldPass ? "PASS" : "fail"}, verifier ${v.verdict}\n`);
  }
}

// Print the deterministic recon fact-pool for a task (docs/ORCHESTRATOR.md §6.2).
// Read-only; used for transparency and to feed the semi-manual Claude-M2 ceiling.
function cmdRecon(o) {
  const task = o.task || die("--task required");
  const t = loadTask(task);
  const wd = makeWorkdir(t);
  try {
    process.stdout.write(renderFactPool(extractRecon(wd, t.parts.goal, { testCmd: t.meta.testCmd })) + "\n");
  } finally {
    rmSync(wd, { recursive: true, force: true });
  }
}

const argv = process.argv.slice(2);
const cmd = argv[0];
const opts = parseFlags(argv.slice(1));
if (cmd === "run") cmdRun(opts);
else if (cmd === "report") cmdReport();
else if (cmd === "verify-report") cmdVerifyReport();
else if (cmd === "orchestrate") cmdOrchestrate(opts);
else if (cmd === "orchestrate-report") cmdOrchestrateReport(opts);
else if (cmd === "verify-corpus") cmdVerifyCorpus(opts);
else if (cmd === "recon") cmdRecon(opts);
else {
  process.stdout.write(
    "usage: node benchmarks/bench.mjs run --task <id> --arm <A|B1|B2|B3> [--repeats N] [--model id] [--verifier-model id] [--save-corpus dir] [--results-dir path] [--round N --extra file --repeat K]\n" +
      "       node benchmarks/bench.mjs verify-corpus --corpus <dir> --verifier-model <id> [--results-dir path]\n" +
      "       node benchmarks/bench.mjs report\n" +
      "       node benchmarks/bench.mjs verify-report\n" +
      "       node benchmarks/bench.mjs orchestrate --task <id> --orchestrator-model <id> [--recon fixed|candidate] [--verifier-model <id>] [--repeats N] [--rounds N] [--results-dir path]\n" +
      "       node benchmarks/bench.mjs orchestrate-report [--baseline <model>]\n" +
      "       node benchmarks/bench.mjs recon --task <id>\n"
  );
  process.exit(cmd ? 2 : 0);
}
