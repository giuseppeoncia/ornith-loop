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
