#!/usr/bin/env node
// Stub pi for tests. Echoes a fixture stream, or sleeps forever to force a timeout.
// Controlled by env: FAKE_PI_MODE = "success" | "hang" | "crash" | "utf8".
//
// Verifier dry-run: when the prompt carries the "# EVIDENCE PACKET" sentinel
// (i.e. this is a Layer-1 verifier call, not an executor call), emit a JSON
// verdict instead of the success stream — so `bench.mjs --verifier-model` is
// exercisable end-to-end without ollama. Verdict defaults to "uncertain"
// (the safe escalate value); override with FAKE_PI_VERDICT.
import { readFile } from "node:fs/promises";

const mode = process.env.FAKE_PI_MODE || "success";
const isVerifierCall = process.argv.some((a) => typeof a === "string" && a.includes("# EVIDENCE PACKET"));
const isOrchestratorCall = process.argv.some((a) => typeof a === "string" && a.includes("# ORCHESTRATOR DECISION"));
const isReconCall = process.argv.some((a) => typeof a === "string" && a.includes("# RECON ASSEMBLY"));

if (mode === "crash") {
  process.stderr.write("boom\n");
  process.exit(2);
} else if (mode === "hang") {
  setInterval(() => {}, 1000); // never exits
} else if (mode === "utf8") {
  process.stdout.write("ornith → café ✅ 日本語 🐦\n");
  process.exit(0);
} else if (isReconCall) {
  const text = process.env.FAKE_PI_RECON_EMPTY === "1"
    ? ""
    : JSON.stringify({ grounding: process.env.FAKE_PI_GROUNDING || "- Change only files the tests reference; run `node --test`." });
  const msg = { role: "assistant", stopReason: "stop", content: [{ type: "text", text }] };
  const lines = [
    { type: "session", version: 3, id: "44444444-4444-4444-4444-444444444444", timestamp: "2026-07-07T16:50:00.000Z", cwd: "/tmp/recon" },
    { type: "agent_start" },
    { type: "agent_end", messages: [msg] },
  ];
  process.stdout.write(lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  process.exit(0);
} else if (isOrchestratorCall) {
  const action = process.env.FAKE_PI_ACTION || "done";
  const grounding = process.env.FAKE_PI_GROUNDING || "";
  const text = JSON.stringify({ action, grounding, reason: "stubbed orchestrator decision" });
  const msg = { role: "assistant", stopReason: "stop", content: [{ type: "text", text }] };
  const lines = [
    { type: "session", version: 3, id: "33333333-3333-3333-3333-333333333333", timestamp: "2026-07-07T16:50:00.000Z", cwd: "/tmp/orch" },
    { type: "agent_start" },
    { type: "agent_end", messages: [msg] },
  ];
  process.stdout.write(lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  process.exit(0);
} else if (isVerifierCall) {
  const verdict = process.env.FAKE_PI_VERDICT || "uncertain";
  const text = JSON.stringify({ verdict, evidence: ["fake-pi stub"], reason: "stubbed verifier verdict" });
  const msg = { role: "assistant", stopReason: "stop", content: [{ type: "text", text }] };
  const lines = [
    { type: "session", version: 3, id: "22222222-2222-2222-2222-222222222222", timestamp: "2026-07-07T16:50:00.000Z", cwd: "/tmp/verify" },
    { type: "agent_start" },
    { type: "agent_end", messages: [msg] },
  ];
  process.stdout.write(lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  process.exit(0);
} else {
  const url = new URL("./ornith-success.jsonl", import.meta.url);
  process.stdout.write(await readFile(url, "utf8"));
  process.exit(0);
}
