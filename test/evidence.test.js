import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gatherEvidence } from "../src/evidence.js";

test("gatherEvidence: runs the test cmd and captures diff + changed files", async () => {
  const wd = await mkdtemp(join(tmpdir(), "orn-ev-"));
  try {
    const git = (a) => spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...a], { cwd: wd });
    git(["init", "-q"]); git(["commit", "-q", "--allow-empty", "-m", "base"]);
    await writeFile(join(wd, "note.txt"), "hi");
    const ev = gatherEvidence(wd, ["node", "--version"]);
    assert.equal(ev.testExitCode, 0);
    assert.match(ev.testOutput, /v\d+\./);
    assert.deepEqual(ev.testCmd, ["node", "--version"]);
    assert.ok(ev.changedFiles.includes("note.txt"));
    assert.match(ev.diff, /note\.txt/);
  } finally {
    await rm(wd, { recursive: true, force: true });
  }
});

test("gatherEvidence: empty argv falls back to node --test", async () => {
  const wd = await mkdtemp(join(tmpdir(), "orn-ev-"));
  try {
    const git = (a) => spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...a], { cwd: wd });
    git(["init", "-q"]); git(["commit", "-q", "--allow-empty", "-m", "base"]);
    const ev = gatherEvidence(wd, null);
    assert.deepEqual(ev.testCmd, ["node", "--test"]);
  } finally {
    await rm(wd, { recursive: true, force: true });
  }
});
