// Heuristic failure-mode detectors. These are signals for a human/Claude reviewer,
// NOT ground truth. Kept deliberately simple and documented as heuristics.

const LEAKED_TOOL_CALL = [/<\/?tool_call>/i, /<\|channel\|>\s*commentary/i, /<function[_\s]?call/i];
const DONE_MARKER = /\b(done|completed?|finished|all set|task complete)\b/i;

export function detectFlags({ summary, workdirChange }) {
  const haystack = [...summary.thinkingTexts, ...summary.assistantTexts];
  const toolCallAsText = haystack.some((s) => LEAKED_TOOL_CALL.some((re) => re.test(s)));
  const stoppedBeforeToolCall = summary.toolCallCount === 0;
  const claimedDone =
    DONE_MARKER.test(summary.finalText) || summary.finalText.includes("✅") || summary.finalText.includes("✓");
  const claimedDoneNoChange = Boolean(claimedDone && workdirChange && workdirChange.changed === false);
  return { toolCallAsText, stoppedBeforeToolCall, claimedDone, claimedDoneNoChange };
}
