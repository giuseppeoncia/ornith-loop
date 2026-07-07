// Parse pi's `--mode json` output (JSONL) into events and an observability summary.
// Schema verified against @earendil-works/pi-coding-agent v0.80.3 docs/json.md.

export function parseEventStream(jsonl) {
  let header = null;
  const events = [];
  let malformedLines = 0;
  for (const line of jsonl.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      malformedLines++;
      continue;
    }
    if (obj.type === "session" && header === null) header = obj;
    else events.push(obj);
  }
  return { header, events, malformedLines };
}

function assistantContent(message) {
  if (!message || message.role !== "assistant" || !Array.isArray(message.content)) return [];
  return message.content;
}

// The most complete list of final assistant messages: prefer agent_end.messages,
// else all message_end assistant messages in order.
function finalAssistantMessages(events) {
  const end = events.find((e) => e.type === "agent_end");
  if (end && Array.isArray(end.messages)) return end.messages.filter((m) => m.role === "assistant");
  return events.filter((e) => e.type === "message_end").map((e) => e.message).filter((m) => m && m.role === "assistant");
}

export function summarizeEvents(events) {
  const errorById = new Map();
  for (const e of events) {
    if (e.type === "tool_execution_end") errorById.set(e.toolCallId, Boolean(e.isError));
  }
  const toolSequence = events
    .filter((e) => e.type === "tool_execution_start")
    .map((e) => ({
      name: e.toolName,
      args: e.args ?? null,
      isError: errorById.has(e.toolCallId) ? errorById.get(e.toolCallId) : null,
    }));

  const messages = finalAssistantMessages(events);
  const thinkingTexts = [];
  const assistantTexts = [];
  for (const m of messages) {
    for (const b of assistantContent(m)) {
      if (b.type === "thinking" && typeof b.thinking === "string") thinkingTexts.push(b.thinking);
      if (b.type === "text" && typeof b.text === "string") assistantTexts.push(b.text);
    }
  }

  // finalText / stopReason / errorMessage reflect the LAST assistant message specifically,
  // even if empty — an empty final text is itself signal (ornith stalled before its last step).
  const last = messages.length ? messages[messages.length - 1] : null;
  const lastTextBlocks = last
    ? assistantContent(last).filter((b) => b.type === "text" && typeof b.text === "string").map((b) => b.text)
    : [];
  const stopReason = last && typeof last.stopReason === "string" ? last.stopReason : null;
  const errorMessage = last && typeof last.errorMessage === "string" ? last.errorMessage : null;

  return {
    toolSequence,
    toolCallCount: toolSequence.length,
    thinkingBlockCount: thinkingTexts.length,
    thinkingTexts,
    assistantTexts,
    finalText: lastTextBlocks.join("").trim(),
    stopReason,
    errorMessage,
  };
}
