#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { parseArgs, HELP } from "../src/args.js";
import { invokePi } from "../src/invoke.js";
import { parseEventStream, summarizeEvents } from "../src/parse.js";
import { detectFlags } from "../src/flags.js";
import { snapshot, diffSnapshots } from "../src/git.js";
import { buildRecord, writeRecord } from "../src/record.js";
import { formatSummary } from "../src/summary.js";

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

if (options.promptFile) {
  try {
    options.prompt = readFileSync(options.promptFile, "utf8");
  } catch (err) {
    process.stderr.write(`orn: cannot read --prompt-file ${options.promptFile}: ${err.message}\n`);
    process.exit(2);
  }
}

const timestamp = new Date().toISOString();
const runId = `${timestamp.replace(/[:.]/g, "-")}_${options.label}`;

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
const record = buildRecord({ options, invocation, summary, flags, workdirChange, runId, timestamp });
const { recordPath } = writeRecord(record, invocation.stdout, { runsDir: options.runsDir });

process.stdout.write(formatSummary(record) + `\nrecord: ${recordPath}\n`);
if (invocation.stderr.trim() && record.exit.reason !== "completed") {
  process.stderr.write(`\npi stderr:\n${invocation.stderr}\n`);
}
process.exit(record.exit.reason === "completed" ? 0 : 1);
