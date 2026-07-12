#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { parseArgs, HELP } from "../src/args.js";
import { invokePi } from "../src/invoke.js";
import { parseEventStream, summarizeEvents } from "../src/parse.js";
import { detectFlags } from "../src/flags.js";
import { snapshot, diffSnapshots } from "../src/git.js";
import { buildRecord, writeRecord } from "../src/record.js";
import { formatSummary } from "../src/summary.js";
import { detectHarnesses, resolveTargets, installSkill, ensureDefaultConfig, discoveryMessage } from "../src/install.js";
import { loadConfig, configPath, setConfigKey, getConfigKey, KNOWN_KEYS } from "../src/config.js";
import { runVerify } from "../src/verify.js";

const parsed = parseArgs(process.argv.slice(2));
if (parsed.help) {
  process.stdout.write(HELP + "\n");
  process.exit(0);
}
if (parsed.error) {
  process.stderr.write(`orn: ${parsed.error}\n\n${HELP}\n`);
  process.exit(2);
}
const options = parsed.options;

if (options.command === "install-skill") {
  const sourceDir = fileURLToPath(new URL("../skill/ornith-loop", import.meta.url));
  const detected = detectHarnesses({
    env: process.env,
    homedir: homedir(),
    exists: existsSync,
    pathEntries: (process.env.PATH || "").split(":").filter(Boolean),
  });
  const targets = resolveTargets({ target: options.target, env: process.env, homedir: homedir(), detected });
  if (targets.length === 0) {
    process.stderr.write(
      "orn: no coding agent detected (looked for ~/.claude and opencode).\n" +
        "Install one, or force a target: orn install-skill --target claude|opencode\n"
    );
    process.exit(1);
  }
  for (const r of installSkill(targets, sourceDir)) {
    process.stdout.write(`${r.method} ${r.dest} (${r.name})\n`);
  }
  if (options.verifier) {
    setConfigKey("verifier.enabled", "true");
    setConfigKey("verifier.model", options.verifier);
  } else {
    ensureDefaultConfig(process.env, homedir());
  }
  const cfg = loadConfig();
  let ollamaModels = [];
  try {
    const out = spawnSync("ollama", ["list"], { encoding: "utf8" });
    if (out.status === 0) {
      ollamaModels = (out.stdout || "").split("\n").slice(1).map((l) => l.split(/\s+/)[0]).filter(Boolean);
    }
  } catch { /* ollama absent — omit the list */ }
  process.stdout.write(discoveryMessage(cfg, ollamaModels));
  process.exit(0);
}

if (options.command === "config") {
  if (options.action === "path") {
    process.stdout.write(configPath() + "\n");
    process.exit(0);
  }
  if (options.action === "get") {
    const cfg = loadConfig();
    if (options.key) {
      if (!(options.key in KNOWN_KEYS)) {
        process.stderr.write(`orn: unknown key '${options.key}': one of ${Object.keys(KNOWN_KEYS).join(", ")}\n`);
        process.exit(2);
      }
      const v = getConfigKey(cfg, options.key);
      process.stdout.write((v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v)) + "\n");
    } else {
      process.stdout.write(JSON.stringify(cfg, null, 2) + "\n");
    }
    process.exit(0);
  }
  const res = setConfigKey(options.key, options.value);
  if (res.error) {
    process.stderr.write(`orn: ${res.error}\n`);
    process.exit(2);
  }
  process.stdout.write(`set ${options.key} = ${options.value}  (${res.path})\n`);
  process.exit(0);
}

if (options.command === "verify") {
  const result = await runVerify(options);
  if (result.error) {
    process.stderr.write(`orn: ${result.error}\n`);
    process.exit(2);
  }
  if (result.notConfigured) {
    process.stderr.write(
      "orn verify: no local verifier configured — Claude verifies inline.\n" +
        "Enable one: orn config set verifier.enabled true && orn config set verifier.model <id>\n"
    );
    process.exit(3);
  }
  process.stdout.write(`${result.verdict.verdict}\n${result.verdict.reason}\n`);
  process.exit(0);
}

// options.command === "run"
if (options.promptFile) {
  try {
    options.prompt = readFileSync(options.promptFile, "utf8");
  } catch (err) {
    process.stderr.write(`orn: cannot read --prompt-file ${options.promptFile}: ${err.message}\n`);
    process.exit(2);
  }
}

if (!options.modelExplicit) options.model = loadConfig().executor.model;

const timestamp = new Date().toISOString();
const safeLabel = options.label.replace(/[^A-Za-z0-9._-]/g, "-");
const runId = `${timestamp.replace(/[:.]/g, "-")}_${safeLabel}`;

const before = options.workdir ? snapshot(options.workdir) : null;

const invocation = await invokePi(options);

const { events, malformedLines } = parseEventStream(invocation.stdout);
const summary = summarizeEvents(events);
summary.malformedLines = malformedLines;

let workdirChange = null;
if (options.workdir && before) {
  const after = snapshot(options.workdir);
  workdirChange = { before, after, changed: diffSnapshots(before, after).changed };
}

const flags = detectFlags({ summary, workdirChange });
const record = buildRecord({ options, invocation, summary, flags, workdirChange, runId, timestamp, runsDir: options.runsDir });
const { recordPath } = writeRecord(record, invocation.stdout, { runsDir: options.runsDir });

process.stdout.write(formatSummary(record) + `\nrecord: ${recordPath}\n`);
if (invocation.stderr.trim() && record.exit.reason !== "completed") {
  process.stderr.write(`\npi stderr:\n${invocation.stderr}\n`);
}
process.exit(record.exit.reason === "completed" ? 0 : 1);
