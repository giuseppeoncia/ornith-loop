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
