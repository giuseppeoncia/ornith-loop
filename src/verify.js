import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { gatherEvidence } from "./evidence.js";
import { buildEvidencePacket, parseVerdict } from "./verifier.js";
import { invokePi } from "./invoke.js";
import { parseEventStream, summarizeEvents } from "./parse.js";

const RUBRIC_PATH = fileURLToPath(new URL("../verifier/rubric.md", import.meta.url));

// Run the Layer-1 verifier over a workdir, read-only. Resolves the model from
// --model or (when enabled) config.verifier.model; returns { notConfigured:true }
// when neither is available (the caller prints guidance). Never sees a gold label.
export async function runVerify(options, { config = loadConfig(), env = process.env } = {}) {
  const model = options.model || (config.verifier.enabled ? config.verifier.model : null);
  if (!model) return { notConfigured: true };

  const testArgv = options.testCmd.trim().split(/\s+/);
  const ev = gatherEvidence(options.workdir, testArgv);
  let goal = "";
  if (options.goalFile) {
    try {
      goal = readFileSync(options.goalFile, "utf8");
    } catch (err) {
      return { error: `verify: cannot read --goal-file ${options.goalFile}: ${err.message}` };
    }
  }
  let grounding = "";
  if (options.groundingFile) {
    try {
      grounding = readFileSync(options.groundingFile, "utf8");
    } catch (err) {
      return { error: `verify: cannot read --grounding-file ${options.groundingFile}: ${err.message}` };
    }
  }
  const packet = buildEvidencePacket({
    goal, grounding,
    testCmd: ev.testCmd, testOutput: ev.testOutput, testExitCode: ev.testExitCode,
    changedFiles: ev.changedFiles, diff: ev.diff,
  });
  const prompt = `${readFileSync(RUBRIC_PATH, "utf8")}\n\n---\n\n# EVIDENCE PACKET\n\n${packet}`;

  const inv = await invokePi({
    prompt, model, provider: "ollama", thinking: "off",
    label: "verify", timeoutSec: 900, piBin: env.ORN_PI_BIN || "pi", noTools: true,
  });
  const { events } = parseEventStream(inv.stdout);
  const { finalText } = summarizeEvents(events);
  return { verdict: parseVerdict(finalText) };
}
