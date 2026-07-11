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

import { readFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, cpSync, appendFileSync, readdirSync } from "node:fs";
import { spawnSync, spawn } from "node:child_process";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { ARMS, ARM_IDS, assemblePrompt, aggregate, deltas, caffeinateArgs } from "../src/bench.js";
import { buildEvidencePacket, parseVerdict, scoreVerifier } from "../src/verifier.js";
import { scoreOrchestrator, orchestratorDeltas } from "../src/orchestrator.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ORN = resolve(HERE, "..", "bin", "orn.js");
const TASKS_DIR = join(HERE, "tasks");
const RESULTS_DIR = join(HERE, "results");
const RUBRIC_PATH = resolve(HERE, "..", "verifier", "rubric.md");

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

// Gather the MECHANICAL evidence a verifier adjudicates: test output, the diff,
// and the changed-file list — all ground truth, computed by us, never claimed
// by ornith. Runs AFTER the oracle (which owns the gold label), so staging the
// git index here is harmless: the workdir is discarded next.
function gatherEvidence(task, wd) {
  const testCmd = Array.isArray(task.meta.testCmd) && task.meta.testCmd.length ? task.meta.testCmd : ["node", "--test"];
  const t = spawnSync(testCmd[0], testCmd.slice(1), { cwd: wd, encoding: "utf8" });
  const testOutput = ((t.stdout || "") + (t.stderr || "")).slice(0, 4000);
  const git = (args) => spawnSync("git", args, { cwd: wd, encoding: "utf8" });
  git(["add", "-A"]); // stage so the diff includes new (untracked) files too
  const diff = (git(["diff", "--cached"]).stdout || "").slice(0, 8000);
  const status = git(["status", "--porcelain"]).stdout || "";
  const changedFiles = status.split("\n").map((l) => l.slice(3).trim()).filter(Boolean);
  return { testCmd, testOutput, testExitCode: t.status, diff, changedFiles };
}

// Invoke the Layer-1 verifier model on (rubric + evidence packet) and parse its
// structured verdict. No --workdir: the verifier reads the packet, it does not
// touch the repo. The executor's run `record` supplies the observability
// signals (its finalText/prose is intentionally left out of the packet).
function runVerifier({ task, wd, record, model }) {
  const ev = gatherEvidence(task, wd);
  const packet = buildEvidencePacket({
    goal: task.parts.goal,
    grounding: task.parts.grounding,
    testCmd: ev.testCmd,
    testOutput: ev.testOutput,
    testExitCode: ev.testExitCode,
    changedFiles: ev.changedFiles,
    diff: ev.diff,
    record,
  });
  const prompt = `${loadRubric()}\n\n---\n\n# EVIDENCE PACKET\n\n${packet}`;
  const runsDir = mkdtempSync(join(tmpdir(), `bench-verify-${task.meta.id}-`));
  try {
    // --no-tools: the verifier reads the packet from the prompt and MUST reply
    // inline. Without it, pi runs in the repo cwd with write tools live and a
    // tool-eager model writes its verdict to a file (polluting the tree and
    // scoring as unparseable -> silent uncertain). See journal 2026-07-10.
    const orn = runOrn({ prompt, model, label: `verify-${task.meta.id}`, runsDir, noTools: true });
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
  const extra = typeof o.extra === "string" ? readFileSync(o.extra, "utf8") : "";
  if (round > 1 && !ARMS[arm].loop) die(`arm ${arm} is single-shot; --round ${round} is invalid`);

  const t = loadTask(task);
  keepAwake(); // long run: don't let the Mac idle-sleep and truncate orn calls
  const prompt = assemblePrompt(arm, t.parts, { round, extra });
  mkdirSync(RESULTS_DIR, { recursive: true });
  const resultsFile = join(RESULTS_DIR, `${task}__${arm}.jsonl`);

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
      // Optional Layer-1 verifier pass: adjudicate the same run while the
      // workdir still exists. The oracle's `pass` stays the gold label; the
      // verifier's verdict is scored against it by `verify-report`.
      if (verifierModel) {
        const v = runVerifier({ task: t, wd, record: orn.record, model: verifierModel });
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
    process.stdout.write(`${label}: ${row.pass ? "PASS" : "fail"} (exit ${row.exit}, tools ${row.toolSequence.length}, changed ${row.changed}${vtag})\n`);
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

// The agentic execution driver is NOT implemented — driving a local model
// through the full ornith-loop (recon → minimal-scaffold prompt → orn run →
// verify → bounded corrective loop → journal) needs a real agent host, not the
// mechanical layer this file provides. docs/ORCHESTRATOR.md is the spec; this is
// the honest stub (parallels BENCHMARK.md's "orn bench — not built here"). Until
// it exists, populate benchmarks/results/*.jsonl semi-manually with rows shaped:
//   { task, repeat, orchestratorModel, orchestratorOutcome: "done"|"escalate",
//     pass: <oracle gold label>, orchestratorRounds?, orchestratorReason? }
// and read them with `orchestrate-report`. Baseline rows use orchestratorModel
// "claude" (the reference the deltas compare against).
function cmdOrchestrate() {
  process.stderr.write(
    "orchestrate: the local-orchestrator execution driver is not built yet.\n\n" +
      "It would drive a candidate LOCAL model through the whole ornith-loop and record\n" +
      "one row per (task, repeat): its terminal outcome (`done`|`escalate`) + the oracle\n" +
      "gold label on the final workdir. See docs/ORCHESTRATOR.md §7 (protocol).\n\n" +
      "For now, record rows semi-manually into benchmarks/results/*.jsonl (schema in the\n" +
      "source comment above cmdOrchestrate) and score them with:\n" +
      "  node benchmarks/bench.mjs orchestrate-report\n"
  );
  process.exit(2);
}

const argv = process.argv.slice(2);
const cmd = argv[0];
const opts = parseFlags(argv.slice(1));
if (cmd === "run") cmdRun(opts);
else if (cmd === "report") cmdReport();
else if (cmd === "verify-report") cmdVerifyReport();
else if (cmd === "orchestrate") cmdOrchestrate(opts);
else if (cmd === "orchestrate-report") cmdOrchestrateReport(opts);
else {
  process.stdout.write(
    "usage: node benchmarks/bench.mjs run --task <id> --arm <A|B1|B2|B3> [--repeats N] [--model id] [--verifier-model id] [--round N --extra file --repeat K]\n" +
      "       node benchmarks/bench.mjs report\n" +
      "       node benchmarks/bench.mjs verify-report\n" +
      "       node benchmarks/bench.mjs orchestrate            (stub — see docs/ORCHESTRATOR.md)\n" +
      "       node benchmarks/bench.mjs orchestrate-report [--baseline <model>]\n"
  );
  process.exit(cmd ? 2 : 0);
}
