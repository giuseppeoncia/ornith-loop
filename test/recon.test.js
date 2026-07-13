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
