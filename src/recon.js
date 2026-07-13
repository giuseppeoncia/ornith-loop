// Deterministic recon extractors for orchestrator M2 (docs/ORCHESTRATOR.md §6.2,
// spec docs/superpowers/specs/2026-07-12-orchestrate-driver-m2-design.md).
//
// PURE-ish: no network, no model, no judgment. The only IO is reading files
// inside a provided workdir and spawning `git` in it. NEVER reads a task's
// answer-keys (meta.json / oracle.mjs / grounding.md / scaffold-heavy.md).

// English/domain words that appear in goals but are not code identifiers.
const STOPWORDS = new Set([
  "the", "and", "for", "its", "must", "this", "that", "with", "from", "into", "only",
  "both", "each", "call", "calls", "file", "files", "code", "take", "takes", "pass",
  "passes", "change", "changes", "update", "updates", "run", "leave", "expect",
  "expects", "argument", "second", "current", "refactor", "callers", "suite", "now",
  "test", "tests", "node", "rate", "everything", "exactly", "signature", "function",
  "functions", "parameter", "hardcodes",
]);

// Identifiers worth grepping for: backtick spans (split on whitespace/punct) plus
// camelCase words in prose. Deduped, stop-worded, must contain a letter.
export function extractGoalTokens(goalText) {
  const raw = typeof goalText === "string" ? goalText : "";
  const tokens = new Set();
  for (const m of raw.matchAll(/`([^`]+)`/g)) {
    for (const t of m[1].split(/[\s(),]+/)) {
      const tok = t.trim();
      if (tok.length >= 3 && /[a-zA-Z]/.test(tok)) tokens.add(tok);
    }
  }
  for (const m of raw.matchAll(/\b([a-z][a-zA-Z0-9_$]*[A-Z][a-zA-Z0-9_$]*)\b/g)) {
    tokens.add(m[1]);
  }
  return [...tokens].filter((t) => !STOPWORDS.has(t.toLowerCase()));
}

import { readFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { spawnSync } from "node:child_process";

const ANSWER_KEY_FILES = new Set(["meta.json", "oracle.mjs", "grounding.md", "scaffold-heavy.md", "goal.md"]);
const MAX_GREP_HITS = 40;
const MAX_FILE_LINES = 400;
const MAX_FILE_BYTES = 16 * 1024;

function git(workdir, args) {
  const res = spawnSync("git", ["-C", workdir, ...args], { encoding: "utf8" });
  return res.status === 0 ? res.stdout || "" : ""; // git grep exits 1 on no-match -> ""
}

export function extractRecon(workdir, goalText, { testCmd } = {}) {
  const testCommand = Array.isArray(testCmd) ? testCmd.join(" ") : typeof testCmd === "string" ? testCmd : "";
  const tracked = git(workdir, ["ls-files"]).split("\n").map((s) => s.trim()).filter(Boolean);
  const fileTree = tracked.filter((f) => !ANSWER_KEY_FILES.has(basename(f)));

  let packageJson = null;
  const pkgPath = join(workdir, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      packageJson = { name: pkg.name ?? null, scripts: pkg.scripts ?? null, engines: pkg.engines ?? null };
    } catch {
      packageJson = null;
    }
  }

  const goalTokens = extractGoalTokens(goalText);
  const grepHits = [];
  let grepTruncated = false;
  const hitFiles = new Set();
  outer: for (const token of goalTokens) {
    for (const line of git(workdir, ["grep", "-n", "-F", token]).split("\n")) {
      const m = line.match(/^([^:]+):(\d+):(.*)$/);
      if (!m) continue;
      const file = m[1];
      if (ANSWER_KEY_FILES.has(basename(file))) continue;
      if (grepHits.length >= MAX_GREP_HITS) { grepTruncated = true; break outer; }
      grepHits.push({ token, file, line: Number(m[2]), text: m[3].trim() });
      hitFiles.add(file);
    }
  }

  const sourceOfHitFiles = [];
  for (const file of hitFiles) {
    const p = join(workdir, file);
    if (!existsSync(p)) continue;
    let content = readFileSync(p, "utf8");
    let truncated = false;
    const lines = content.split("\n");
    if (lines.length > MAX_FILE_LINES) { content = lines.slice(0, MAX_FILE_LINES).join("\n"); truncated = true; }
    const fullBytes = Buffer.from(content, "utf8");
    if (fullBytes.length > MAX_FILE_BYTES) {
      // Truncate by BYTES (not UTF-16 code units), then decode and drop any trailing
      // replacement char(s) left by a multi-byte sequence cut mid-character, so the
      // result's UTF-8 byte length is guaranteed <= MAX_FILE_BYTES.
      content = fullBytes.subarray(0, MAX_FILE_BYTES).toString("utf8").replace(/�+$/, "");
      truncated = true;
    }
    sourceOfHitFiles.push({ file, content, truncated });
  }
  sourceOfHitFiles.sort((a, b) => a.file.localeCompare(b.file));

  return { testCommand, fileTree, packageJson, goalTokens, grepHits, grepTruncated, sourceOfHitFiles };
}

export function renderFactPool(fp) {
  const out = ["# RECON FACT-POOL", ""];
  out.push("## Test command", fp.testCommand || "(none provided)", "");
  out.push("## Files (tracked)", ...(fp.fileTree.length ? fp.fileTree.map((f) => `- ${f}`) : ["(none)"]), "");
  if (fp.packageJson) out.push("## package.json", "```json", JSON.stringify(fp.packageJson, null, 2), "```", "");
  out.push("## Goal tokens", fp.goalTokens.length ? fp.goalTokens.join(", ") : "(none)", "");
  out.push(`## Grep hits${fp.grepTruncated ? " (truncated)" : ""}`);
  out.push(...(fp.grepHits.length ? fp.grepHits.map((h) => `- ${h.file}:${h.line}: ${h.text}`) : ["(none)"]), "");
  out.push("## Source of files with hits");
  for (const s of fp.sourceOfHitFiles) out.push(`### ${s.file}${s.truncated ? " (truncated)" : ""}`, "```", s.content, "```", "");
  return out.join("\n");
}
