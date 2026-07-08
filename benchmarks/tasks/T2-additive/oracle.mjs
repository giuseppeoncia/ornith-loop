#!/usr/bin/env node
// Oracle for T2-additive. exit 0 = pass. Runs the suite, then asserts only the
// module changed (test file and everything else must be untouched).
import { spawnSync } from "node:child_process";

const wd = process.env.BENCH_WORKDIR;
if (!wd) { console.error("no BENCH_WORKDIR"); process.exit(2); }

const ALLOWED = new Set(["src/mathx.mjs"]);

const t = spawnSync("node", ["--test"], { cwd: wd, encoding: "utf8" });
if (t.status !== 0) {
  console.error(`FAIL: node --test exited ${t.status}\n${(t.stdout || "") + (t.stderr || "")}`.slice(0, 800));
  process.exit(1);
}

const st = spawnSync("git", ["status", "--porcelain"], { cwd: wd, encoding: "utf8" }).stdout || "";
const changed = st.split("\n").map((l) => l.slice(3).trim()).filter(Boolean);
const stray = changed.filter((f) => !ALLOWED.has(f));
if (stray.length) { console.error(`FAIL: tests pass but unexpected files changed: ${stray.join(", ")}`); process.exit(1); }
if (!changed.includes("src/mathx.mjs")) { console.error("FAIL: tests pass but src/mathx.mjs unchanged (suspicious)"); process.exit(1); }

console.log("PASS: suite green, only src/mathx.mjs changed");
process.exit(0);
