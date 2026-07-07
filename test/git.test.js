import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { snapshot, diffSnapshots } from "../src/git.js";

test("snapshot reports non-repo cleanly", async () => {
  const dir = await mkdtemp(join(tmpdir(), "orn-nonrepo-"));
  try {
    const s = snapshot(dir);
    assert.equal(s.isRepo, false);
    assert.equal(s.head, null);
    assert.deepEqual(s.dirtyFiles, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("diffSnapshots detects a new dirty file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "orn-repo-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: dir });
    execFileSync("git", ["config", "user.email", "t@t"], { cwd: dir });
    execFileSync("git", ["config", "user.name", "t"], { cwd: dir });
    await writeFile(join(dir, "seed.txt"), "seed");
    execFileSync("git", ["add", "."], { cwd: dir });
    execFileSync("git", ["commit", "-qm", "seed"], { cwd: dir });
    const before = snapshot(dir);
    assert.equal(before.isRepo, true);
    await writeFile(join(dir, "new.txt"), "hi");
    const after = snapshot(dir);
    assert.equal(diffSnapshots(before, after).changed, true);
    assert.equal(diffSnapshots(before, before).changed, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
