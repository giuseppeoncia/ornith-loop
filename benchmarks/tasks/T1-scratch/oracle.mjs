#!/usr/bin/env node
// Oracle for T1-scratch. exit 0 = pass. Ground truth only: runs the produced
// file and byte-compares stdout, then asserts the change scope via git.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const wd = process.env.BENCH_WORKDIR;
if (!wd) { console.error("no BENCH_WORKDIR"); process.exit(2); }

const EXPECTED = ["1", "2", "Fizz", "4", "Buzz", "Fizz", "7", "8", "Fizz", "Buzz", "11", "Fizz", "13", "14", "FizzBuzz"].join("\n") + "\n";
const ALLOWED = new Set(["fizzbuzz.mjs"]);

const file = join(wd, "fizzbuzz.mjs");
if (!existsSync(file)) { console.error("FAIL: fizzbuzz.mjs was not created"); process.exit(1); }

const run = spawnSync("node", ["fizzbuzz.mjs"], { cwd: wd, encoding: "utf8" });
if (run.status !== 0) { console.error(`FAIL: node fizzbuzz.mjs exited ${run.status}\n${run.stderr}`); process.exit(1); }
if (run.stdout !== EXPECTED) {
  console.error(`FAIL: output mismatch.\n--- expected ---\n${EXPECTED}--- got ---\n${run.stdout}`);
  process.exit(1);
}

// scope: only allowed files may have changed
const st = spawnSync("git", ["status", "--porcelain"], { cwd: wd, encoding: "utf8" }).stdout || "";
const changed = st.split("\n").map((l) => l.slice(3).trim()).filter(Boolean);
const stray = changed.filter((f) => !ALLOWED.has(f));
if (stray.length) { console.error(`FAIL: unexpected files changed: ${stray.join(", ")}`); process.exit(1); }

console.log("PASS: exact FizzBuzz output, scope clean");
process.exit(0);
