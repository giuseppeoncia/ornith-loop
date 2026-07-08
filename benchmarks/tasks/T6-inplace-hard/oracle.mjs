#!/usr/bin/env node
// Oracle for T6-inplace-hard. exit 0 = pass. Suite is the behavioural check;
// scope + a byte guard on roundCents catch in-place corruption. Ground truth only.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const wd = process.env.BENCH_WORKDIR;
if (!wd) { console.error("no BENCH_WORKDIR"); process.exit(2); }

const ALLOWED = new Set(["src/pricing.mjs", "src/checkout.mjs"]);

const t = spawnSync("node", ["--test"], { cwd: wd, encoding: "utf8" });
if (t.status !== 0) {
  console.error(`FAIL: node --test exited ${t.status}\n${((t.stdout || "") + (t.stderr || "")).slice(0, 800)}`);
  process.exit(1);
}

const st = spawnSync("git", ["status", "--porcelain"], { cwd: wd, encoding: "utf8" }).stdout || "";
const changed = st.split("\n").map((l) => l.slice(3).trim()).filter(Boolean);
const stray = changed.filter((f) => !ALLOWED.has(f));
if (stray.length) { console.error(`FAIL: tests pass but unexpected files changed: ${stray.join(", ")}`); process.exit(1); }

// Explicit byte guard: the roundCents body must be exactly as shipped (belt-and-braces
// vs token corruption the tests happened not to exercise).
const src = readFileSync(join(wd, "src", "pricing.mjs"), "utf8");
if (!src.includes("return Math.round(x * 100) / 100;")) {
  console.error("FAIL: the roundCents() body was altered (in-place corruption)");
  process.exit(1);
}

console.log(`PASS: suite green, roundCents intact, scope clean (changed: ${changed.join(", ")})`);
process.exit(0);
