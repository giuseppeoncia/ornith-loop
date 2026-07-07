import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseEventStream, summarizeEvents } from "../src/parse.js";

const fixture = () => readFile(new URL("./fixtures/ornith-success.jsonl", import.meta.url), "utf8");

test("parseEventStream splits JSONL, captures header, counts malformed lines", async () => {
  const { header, events, malformedLines } = parseEventStream(await fixture());
  assert.equal(header.type, "session");
  assert.equal(malformedLines, 0);
  assert.ok(events.some((e) => e.type === "agent_end"));
});

test("parseEventStream tolerates blank and malformed lines", () => {
  const { events, malformedLines } = parseEventStream('\n{"type":"agent_start"}\nnot json\n');
  assert.equal(events.length, 1);
  assert.equal(malformedLines, 1);
});

test("summarizeEvents extracts tool sequence, thinking, final text, stopReason", async () => {
  const { events } = parseEventStream(await fixture());
  const s = summarizeEvents(events);
  assert.deepEqual(s.toolSequence.map((t) => t.name), ["read", "write"]);
  assert.equal(s.toolCallCount, 2);
  assert.equal(s.toolSequence[0].isError, false);
  assert.equal(s.thinkingBlockCount, 1);
  assert.equal(s.finalText, "Done. I created hello.txt.");
  assert.equal(s.stopReason, "stop");
  assert.equal(s.errorMessage, null);
});

test("summarizeEvents takes finalText/stopReason from the LAST assistant message, not a stale earlier one", () => {
  const events = [{
    type: "agent_end",
    messages: [
      { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "intermediate answer" }] },
      { role: "assistant", stopReason: "toolUse", content: [{ type: "toolCall", id: "c1", name: "write", arguments: {} }] },
    ],
  }];
  const s = summarizeEvents(events);
  assert.equal(s.finalText, "", "last assistant message has no text -> empty, not the stale earlier text");
  assert.equal(s.stopReason, "toolUse");
});

test("summarizeEvents flags a failed tool (isError true) and an unfinished tool (isError null)", () => {
  const events = [
    { type: "tool_execution_start", toolCallId: "a", toolName: "bash", args: { cmd: "x" } },
    { type: "tool_execution_end", toolCallId: "a", toolName: "bash", result: "err", isError: true },
    { type: "tool_execution_start", toolCallId: "b", toolName: "write", args: { path: "y" } },
    { type: "agent_end", messages: [{ role: "assistant", stopReason: "aborted", content: [] }] },
  ];
  const s = summarizeEvents(events);
  assert.deepEqual(s.toolSequence.map((t) => [t.name, t.isError]), [["bash", true], ["write", null]]);
  assert.equal(s.stopReason, "aborted");
  assert.equal(s.finalText, "");
});
