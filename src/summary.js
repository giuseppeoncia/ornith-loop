const YES = "⚠", NO = "·";
const flag = (v) => (v ? YES : NO);

export function formatSummary(record) {
  const { exit, invocation, toolSequence, flags } = record;
  const seq = toolSequence.length ? toolSequence.map((t) => t.name).join(" → ") : "(none)";
  const secs = (invocation.durationMs / 1000).toFixed(1);
  const lines = [
    `run ${record.runId}  [${record.model}]`,
    `exit: ${exit.reason}  stopReason: ${exit.stopReason ?? "?"}  ${secs}s${invocation.timedOut ? "  (timed out)" : ""}`,
    `tool sequence (${record.toolCallCount}): ${seq}`,
    `thinking blocks: ${record.thinkingBlockCount}`,
    `flags: ${flag(flags.toolCallAsText)} tool-call-as-text  ${flag(flags.stoppedBeforeToolCall)} stopped-before-tool-call  ${flag(flags.claimedDone)} claimed-done  ${flag(flags.claimedDoneNoChange)} claimed-done-no-change`,
    `final text: ${record.finalText ? record.finalText.slice(0, 200) : "(empty)"}`,
    `raw log: ${record.logPath}`,
  ];
  return lines.join("\n");
}
