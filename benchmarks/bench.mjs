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
import { spawnSync } from "node:child_process";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { ARMS, ARM_IDS, assemblePrompt, aggregate, deltas } from "../src/bench.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ORN = resolve(HERE, "..", "bin", "orn.js");
const TASKS_DIR = join(HERE, "tasks");
const RESULTS_DIR = join(HERE, "results");

function die(msg) {
  process.stderr.write(`bench: ${msg}\n`);
  process.exit(2);
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

function runOrn({ prompt, workdir, model, label, runsDir }) {
  const argv = [ORN, "run", prompt, "--workdir", workdir, "--label", label, "--runs-dir", runsDir];
  if (model) argv.push("--model", model);
  const res = spawnSync(process.execPath, argv, { encoding: "utf8", env: process.env });
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

function cmdRun(o) {
  const task = o.task || die("--task required");
  const arm = o.arm || die("--arm required");
  if (!ARM_IDS.includes(arm)) die(`unknown arm '${arm}': one of ${ARM_IDS.join(", ")}`);
  const round = Number(o.round || 1);
  const repeats = o.repeat ? [Number(o.repeat)] : Array.from({ length: Number(o.repeats || 1) }, (_, i) => i + 1);
  const model = typeof o.model === "string" ? o.model : undefined;
  const extra = typeof o.extra === "string" ? readFileSync(o.extra, "utf8") : "";
  if (round > 1 && !ARMS[arm].loop) die(`arm ${arm} is single-shot; --round ${round} is invalid`);

  const t = loadTask(task);
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
    } finally {
      rmSync(wd, { recursive: true, force: true });
      rmSync(runsDir, { recursive: true, force: true });
    }
    appendFileSync(resultsFile, JSON.stringify(row) + "\n");
    process.stdout.write(`${label}: ${row.pass ? "PASS" : "fail"} (exit ${row.exit}, tools ${row.toolSequence.length}, changed ${row.changed})\n`);
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

const argv = process.argv.slice(2);
const cmd = argv[0];
const opts = parseFlags(argv.slice(1));
if (cmd === "run") cmdRun(opts);
else if (cmd === "report") cmdReport();
else {
  process.stdout.write("usage: node benchmarks/bench.mjs run --task <id> --arm <A|B1|B2|B3> [--repeats N] [--model id] [--round N --extra file --repeat K]\n       node benchmarks/bench.mjs report\n");
  process.exit(cmd ? 2 : 0);
}
