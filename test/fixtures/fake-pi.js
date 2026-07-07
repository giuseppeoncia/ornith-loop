#!/usr/bin/env node
// Stub pi for tests. Echoes a fixture stream, or sleeps forever to force a timeout.
// Controlled by env: FAKE_PI_MODE = "success" | "hang" | "crash".
import { readFile } from "node:fs/promises";

const mode = process.env.FAKE_PI_MODE || "success";
if (mode === "crash") {
  process.stderr.write("boom\n");
  process.exit(2);
} else if (mode === "hang") {
  setInterval(() => {}, 1000); // never exits
} else if (mode === "utf8") {
  process.stdout.write("ornith → café ✅ 日本語 🐦\n");
  process.exit(0);
} else {
  const url = new URL("./ornith-success.jsonl", import.meta.url);
  process.stdout.write(await readFile(url, "utf8"));
  process.exit(0);
}
