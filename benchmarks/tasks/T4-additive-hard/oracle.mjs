#!/usr/bin/env node
// Oracle for T4-additive-hard. exit 0 = pass. Runs the suite, then asserts the
// change is scoped: only ops.mjs and/or registry.mjs may differ, and the test
// file (and everything else) must be untouched. Ground truth only.
import { spawnSync } from "node:child_process";

const wd = process.env.BENCH_WORKDIR;
if (!wd) { console.error("no BENCH_WORKDIR"); process.exit(2); }

const ALLOWED = new Set(["src/ops.mjs", "src/registry.mjs"]);

const t = spawnSync("node", ["--test"], { cwd: wd, encoding: "utf8" });
if (t.status !== 0) {
  console.error(`FAIL: node --test exited ${t.status}\n${((t.stdout || "") + (t.stderr || "")).slice(0, 800)}`);
  process.exit(1);
}

const st = spawnSync("git", ["status", "--porcelain"], { cwd: wd, encoding: "utf8" }).stdout || "";
const changed = st.split("\n").map((l) => l.slice(3).trim()).filter(Boolean);
const stray = changed.filter((f) => !ALLOWED.has(f));
if (stray.length) { console.error(`FAIL: tests pass but unexpected files changed: ${stray.join(", ")}`); process.exit(1); }
if (!changed.length) { console.error("FAIL: tests pass but nothing changed (suspicious)"); process.exit(1); }

console.log(`PASS: suite green, scope clean (changed: ${changed.join(", ")})`);
process.exit(0);
