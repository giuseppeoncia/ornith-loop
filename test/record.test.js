import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRecord, writeRecord, deriveExitReason } from "../src/record.js";

const opts = { label: "exp1", model: "ornith-1.0-9b-64k", provider: "ollama", thinking: "off", timeoutSec: 900, workdir: null, prompt: "make a file" };
const invocation = { argv: ["--print"], exitCode: 0, signal: null, timedOut: false, durationMs: 1234 };
const summary = { toolSequence: [{ name: "write", args: { path: "x" }, isError: false }], toolCallCount: 1, thinkingBlockCount: 0, finalText: "Done.", stopReason: "stop", errorMessage: null };
const flags = { toolCallAsText: false, stoppedBeforeToolCall: false, claimedDone: true, claimedDoneNoChange: false };

test("deriveExitReason maps invocation state", () => {
  assert.equal(deriveExitReason({ timedOut: true, exitCode: null }), "timeout");
  assert.equal(deriveExitReason({ timedOut: false, exitCode: 2 }), "error");
  assert.equal(deriveExitReason({ timedOut: false, exitCode: 0 }), "completed");
});

test("buildRecord composes a schemaVersion-1 record", () => {
  const r = buildRecord({ options: opts, invocation, summary, flags, workdirChange: null, runId: "RID", timestamp: "2026-07-07T16:50:00.000Z", runsDir: "runs" });
  assert.equal(r.schemaVersion, 1);
  assert.equal(r.runId, "RID");
  assert.equal(r.exit.reason, "completed");
  assert.equal(r.exit.stopReason, "stop");
  assert.equal(r.toolCallCount, 1);
  assert.equal(r.logPath, "runs/RID.jsonl");
  assert.equal(r.flags.claimedDone, true);

  const r2 = buildRecord({ options: opts, invocation, summary, flags, workdirChange: null, runId: "RID", timestamp: "2026-07-07T16:50:00.000Z", runsDir: "/custom/out" });
  assert.equal(r2.logPath, "/custom/out/RID.jsonl");
});

test("writeRecord writes record json and raw log", async () => {
  const dir = await mkdtemp(join(tmpdir(), "orn-runs-"));
  try {
    const r = buildRecord({ options: opts, invocation, summary, flags, workdirChange: null, runId: "RID", timestamp: "2026-07-07T16:50:00.000Z", runsDir: dir });
    const { recordPath, logPath } = writeRecord(r, "{\"type\":\"agent_end\"}\n", { runsDir: dir });
    const written = JSON.parse(await readFile(recordPath, "utf8"));
    assert.equal(written.runId, "RID");
    assert.match(await readFile(logPath, "utf8"), /agent_end/);
    assert.equal(logPath, r.logPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
