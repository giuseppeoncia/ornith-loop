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
      const ev = verifierModel || saveCorpus ? gatherEvidence(t, wd) : null;
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

const argv = process.argv.slice(2);
const cmd = argv[0];
const opts = parseFlags(argv.slice(1));
if (cmd === "run") cmdRun(opts);
else if (cmd === "report") cmdReport();
else if (cmd === "verify-report") cmdVerifyReport();
else {
  process.stdout.write(
    "usage: node benchmarks/bench.mjs run --task <id> --arm <A|B1|B2|B3> [--repeats N] [--model id] [--verifier-model id] [--round N --extra file --repeat K]\n" +
      "       node benchmarks/bench.mjs report\n" +
      "       node benchmarks/bench.mjs verify-report\n"
  );
  process.exit(cmd ? 2 : 0);
}
