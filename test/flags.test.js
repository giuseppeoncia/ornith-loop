import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseEventStream, summarizeEvents } from "../src/parse.js";
import { detectFlags } from "../src/flags.js";

const summaryOf = async (name) => {
  const jsonl = await readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
  return summarizeEvents(parseEventStream(jsonl).events);
};

test("clean run: no failure flags, claimedDone true", async () => {
  const summary = await summaryOf("ornith-success.jsonl");
  const f = detectFlags({ summary, workdirChange: { changed: true } });
  assert.equal(f.toolCallAsText, false);
  assert.equal(f.stoppedBeforeToolCall, false);
  assert.equal(f.claimedDone, true);
  assert.equal(f.claimedDoneNoChange, false);
});

test("leaked tool call: toolCallAsText and stoppedBeforeToolCall true", async () => {
  const summary = await summaryOf("ornith-toolcall-as-text.jsonl");
  const f = detectFlags({ summary, workdirChange: null });
  assert.equal(f.toolCallAsText, true);
  assert.equal(f.stoppedBeforeToolCall, true);
});

test("claimedDoneNoChange fires only when done claimed but workdir unchanged", async () => {
  const summary = await summaryOf("ornith-success.jsonl");
  assert.equal(detectFlags({ summary, workdirChange: { changed: false } }).claimedDoneNoChange, true);
  assert.equal(detectFlags({ summary, workdirChange: { changed: true } }).claimedDoneNoChange, false);
  assert.equal(detectFlags({ summary, workdirChange: null }).claimedDoneNoChange, false);
});
