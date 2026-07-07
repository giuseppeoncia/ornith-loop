import { test } from "node:test";
import assert from "node:assert/strict";
import { formatSummary } from "../src/summary.js";

test("formatSummary renders reason, tool sequence, flags", () => {
  const record = {
    runId: "RID", model: "ornith-1.0-9b-64k", exit: { reason: "completed", stopReason: "stop" },
    invocation: { durationMs: 1234, timedOut: false }, toolSequence: [{ name: "read" }, { name: "write" }],
    toolCallCount: 2, thinkingBlockCount: 0, finalText: "Done.",
    flags: { toolCallAsText: false, stoppedBeforeToolCall: false, claimedDone: true, claimedDoneNoChange: false },
    logPath: "runs/RID.jsonl",
  };
  const out = formatSummary(record);
  assert.match(out, /completed/);
  assert.match(out, /read → write/);
  assert.match(out, /claimed-done/);
});
