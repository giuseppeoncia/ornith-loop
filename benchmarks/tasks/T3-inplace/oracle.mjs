#!/usr/bin/env node
// Oracle for T3-inplace. exit 0 = pass. The suite (incl. the shout guard) is the
// behavioural check; scope + a byte check on shout catch in-place corruption.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const wd = process.env.BENCH_WORKDIR;
if (!wd) { console.error("no BENCH_WORKDIR"); process.exit(2); }

const ALLOWED = new Set(["src/greet.mjs"]);

const t = spawnSync("node", ["--test"], { cwd: wd, encoding: "utf8" });
if (t.status !== 0) {
  console.error(`FAIL: node --test exited ${t.status}\n${(t.stdout || "") + (t.stderr || "")}`.slice(0, 800));
  process.exit(1);
}

const st = spawnSync("git", ["status", "--porcelain"], { cwd: wd, encoding: "utf8" }).stdout || "";
const changed = st.split("\n").map((l) => l.slice(3).trim()).filter(Boolean);
const stray = changed.filter((f) => !ALLOWED.has(f));
if (stray.length) { console.error(`FAIL: tests pass but unexpected files changed: ${stray.join(", ")}`); process.exit(1); }

// Explicit byte guard: the shout line must be exactly as shipped (belt-and-braces
// vs token corruption that the test happened not to exercise).
const src = readFileSync(join(wd, "src", "greet.mjs"), "utf8");
if (!src.includes('return text.toUpperCase() + "!";')) {
  console.error("FAIL: the shout() body was altered (in-place corruption)");
  process.exit(1);
}

console.log("PASS: suite green, shout intact, only src/greet.mjs changed");
process.exit(0);
