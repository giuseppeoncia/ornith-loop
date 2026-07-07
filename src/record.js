import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function deriveExitReason({ timedOut, exitCode }) {
  if (timedOut) return "timeout";
  if (exitCode !== 0) return "error";
  return "completed";
}

export function buildRecord({ options, invocation, summary, flags, workdirChange, runId, timestamp, runsDir }) {
  return {
    schemaVersion: 1,
    runId,
    label: options.label,
    timestamp,
    model: options.model,
    provider: options.provider,
    thinking: options.thinking,
    timeoutSec: options.timeoutSec,
    workdir: options.workdir,
    prompt: options.prompt,
    invocation: {
      argv: invocation.argv,
      exitCode: invocation.exitCode,
      signal: invocation.signal,
      timedOut: invocation.timedOut,
      durationMs: invocation.durationMs,
    },
    exit: {
      reason: deriveExitReason(invocation),
      stopReason: summary.stopReason,
      errorMessage: summary.errorMessage,
    },
    toolSequence: summary.toolSequence,
    toolCallCount: summary.toolCallCount,
    thinkingBlockCount: summary.thinkingBlockCount,
    finalText: summary.finalText,
    flags,
    workdirChange,
    malformedLines: summary.malformedLines ?? 0,
    logPath: join(runsDir, `${runId}.jsonl`),
  };
}

export function writeRecord(record, rawStdout, { runsDir }) {
  mkdirSync(runsDir, { recursive: true });
  const recordPath = join(runsDir, `${record.runId}.json`);
  const logPath = join(runsDir, `${record.runId}.jsonl`);
  writeFileSync(recordPath, JSON.stringify(record, null, 2) + "\n");
  writeFileSync(logPath, rawStdout);
  return { recordPath, logPath };
}
