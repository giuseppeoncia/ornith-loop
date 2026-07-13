import { test } from "node:test";
import assert from "node:assert/strict";
import { extractGoalTokens } from "../src/recon.js";

test("extractGoalTokens: pulls camelCase words and backtick spans, drops stopwords", () => {
  const goal =
    "Refactor `withTax` in `src/pricing.mjs` to take the rate as a second argument; " +
    "update its callers lineTotal and cartTotal. Leave roundCents exactly as it is. Run `node --test`.";
  const toks = extractGoalTokens(goal);
  for (const t of ["withTax", "roundCents", "lineTotal", "cartTotal", "src/pricing.mjs"]) {
    assert.ok(toks.includes(t), `expected token ${t} in ${JSON.stringify(toks)}`);
  }
  // stopwords / bare English prose words are not tokens
  assert.ok(!toks.includes("Refactor"));
  assert.ok(!toks.includes("the"));
  // deduped
  assert.equal(new Set(toks).size, toks.length);
});

test("extractGoalTokens: non-string input is safe", () => {
  assert.deepEqual(extractGoalTokens(null), []);
  assert.deepEqual(extractGoalTokens(undefined), []);
});

import { extractRecon, renderFactPool } from "../src/recon.js";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

function tempGitRepo(files) {
  const wd = mkdtempSync(join(tmpdir(), "recon-test-"));
  for (const [rel, content] of Object.entries(files)) {
    const p = join(wd, rel);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, content);
  }
  const git = (args) => spawnSync("git", ["-C", wd, "-c", "user.email=t@t", "-c", "user.name=t", ...args]);
  git(["init", "-q"]); git(["add", "-A"]); git(["commit", "-q", "-m", "base"]);
  return wd;
}

test("extractRecon: gathers tree/grep/source, excludes answer-keys", () => {
  const wd = tempGitRepo({
    "package.json": JSON.stringify({ name: "demo", scripts: { test: "node --test" }, engines: { node: ">=24" } }),
    "src/pricing.mjs": "export function withTax(amount){return amount*1.2;}\nexport function roundCents(x){return Math.round(x*100)/100;}\n",
    "test/checkout.test.mjs": "import {withTax} from '../src/pricing.mjs';\n",
    // decoy answer-keys that MUST be ignored even if present in the workdir
    "meta.json": JSON.stringify({ allowedChangedFiles: ["src/pricing.mjs"] }),
    "oracle.mjs": "process.exit(0)",
  });
  try {
    const fp = extractRecon(wd, "Refactor `withTax` in `src/pricing.mjs`; keep roundCents.", { testCmd: ["node", "--test"] });
    assert.equal(fp.testCommand, "node --test");
    assert.ok(fp.fileTree.includes("src/pricing.mjs"));
    assert.ok(!fp.fileTree.some((f) => f.endsWith("meta.json") || f.endsWith("oracle.mjs")), "answer-keys leaked into fileTree");
    assert.equal(fp.packageJson.name, "demo");
    assert.ok(fp.goalTokens.includes("withTax"));
    assert.ok(fp.grepHits.some((h) => h.file === "src/pricing.mjs" && h.token === "withTax"));
    assert.ok(fp.sourceOfHitFiles.some((s) => s.file === "src/pricing.mjs"));
    assert.ok(!fp.sourceOfHitFiles.some((s) => s.file === "oracle.mjs" || s.file === "meta.json"));

    const rendered = renderFactPool(fp);
    assert.match(rendered, /# RECON FACT-POOL/);
    assert.match(rendered, /withTax/);
    assert.doesNotMatch(rendered, /allowedChangedFiles/, "answer-key content leaked into rendered pool");
  } finally {
    rmSync(wd, { recursive: true, force: true });
  }
});

test("extractRecon: per-file cap is byte-accurate for both line count and multi-byte content", () => {
  // Only the first line carries the goal token: keeps this file's grep-hit count low so it
  // doesn't exhaust MAX_GREP_HITS before the wide-content file's token is even reached.
  const longAsciiLines =
    ["LongFileToken marker"].concat(Array.from({ length: 499 }, (_, i) => `filler line ${i}`)).join("\n") + "\n";
  // ~10000 wide chars: char length < 16384 but UTF-8 byte length (3 bytes each for U+2605) >> 16384.
  const wideContent = "WideToken " + "★".repeat(10000) + "\n";
  const wd = tempGitRepo({
    "src/long.txt": longAsciiLines,
    "src/wide.txt": wideContent,
  });
  try {
    const fp = extractRecon(wd, "Find `LongFileToken` and `WideToken`.", { testCmd: "node --test" });

    const longEntry = fp.sourceOfHitFiles.find((s) => s.file === "src/long.txt");
    assert.ok(longEntry, "expected src/long.txt in sourceOfHitFiles");
    assert.equal(longEntry.truncated, true);
    assert.ok(longEntry.content.split("\n").length <= 400, "line-capped content must have <= 400 lines");

    const wideEntry = fp.sourceOfHitFiles.find((s) => s.file === "src/wide.txt");
    assert.ok(wideEntry, "expected src/wide.txt in sourceOfHitFiles");
    assert.ok(wideEntry.content.length < 16384, "sanity: char length is under the byte cap");
    assert.equal(wideEntry.truncated, true, "byte cap must trigger for wide multi-byte content");
    assert.ok(
      Buffer.byteLength(wideEntry.content, "utf8") <= 16 * 1024,
      `byte cap must actually hold: got ${Buffer.byteLength(wideEntry.content, "utf8")} bytes`,
    );
  } finally {
    rmSync(wd, { recursive: true, force: true });
  }
});
