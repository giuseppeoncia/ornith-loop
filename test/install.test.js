import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { skillDirs, detectHarnesses, resolveTargets, installSkill } from "../src/install.js";

test("skillDirs uses defaults, env overrides win", () => {
  const d = skillDirs({}, "/home/u");
  assert.equal(d.claude, "/home/u/.claude/skills");
  assert.equal(d.opencode, "/home/u/.config/opencode/skills");
  const o = skillDirs({ CLAUDE_SKILLS_DIR: "/x", OPENCODE_SKILLS_DIR: "/y" }, "/home/u");
  assert.equal(o.claude, "/x");
  assert.equal(o.opencode, "/y");
});

test("detectHarnesses: ~/.claude dir, opencode config dir, opencode on PATH, env overrides", () => {
  const homedir = "/home/u";
  const has = (paths) => (p) => paths.includes(p);
  // claude via ~/.claude
  assert.deepEqual(
    detectHarnesses({ env: {}, homedir, exists: has(["/home/u/.claude"]), pathEntries: [] }),
    { claude: true, opencode: false }
  );
  // opencode via ~/.config/opencode
  assert.deepEqual(
    detectHarnesses({ env: {}, homedir, exists: has(["/home/u/.config/opencode"]), pathEntries: [] }),
    { claude: false, opencode: true }
  );
  // opencode via PATH binary
  assert.deepEqual(
    detectHarnesses({ env: {}, homedir, exists: has(["/usr/local/bin/opencode"]), pathEntries: ["/usr/local/bin"] }),
    { claude: false, opencode: true }
  );
  // env overrides mark present without any fs hit
  assert.deepEqual(
    detectHarnesses({ env: { CLAUDE_SKILLS_DIR: "/x", OPENCODE_SKILLS_DIR: "/y" }, homedir, exists: () => false, pathEntries: [] }),
    { claude: true, opencode: true }
  );
});

test("resolveTargets: forced targets ignore detection; auto uses detection", () => {
  const base = { env: {}, homedir: "/home/u" };
  assert.deepEqual(resolveTargets({ ...base, target: "claude", detected: { claude: false, opencode: false } }),
    [{ name: "claude", dir: "/home/u/.claude/skills" }]);
  assert.deepEqual(resolveTargets({ ...base, target: "opencode", detected: { claude: false, opencode: false } }),
    [{ name: "opencode", dir: "/home/u/.config/opencode/skills" }]);
  assert.deepEqual(
    resolveTargets({ ...base, target: "auto", detected: { claude: true, opencode: true } }).map((t) => t.name),
    ["claude", "opencode"]);
  assert.deepEqual(resolveTargets({ ...base, target: "auto", detected: { claude: false, opencode: false } }), []);
});

test("installSkill symlinks the source into each target and is idempotent", async () => {
  const src = await mkdtemp(join(tmpdir(), "orn-src-"));
  const dest = await mkdtemp(join(tmpdir(), "orn-dest-"));
  try {
    await writeFile(join(src, "SKILL.md"), "marker");
    const first = installSkill([{ name: "claude", dir: dest }], src);
    assert.equal(first[0].method, "symlinked");
    assert.equal(first[0].dest, join(dest, "ornith-loop"));
    assert.equal(await readlink(join(dest, "ornith-loop")), src);
    // the source content is reachable through the installed link
    assert.ok(existsSync(join(dest, "ornith-loop", "SKILL.md")));
    // idempotent: second run replaces cleanly, still points at src
    installSkill([{ name: "claude", dir: dest }], src);
    assert.equal(await readlink(join(dest, "ornith-loop")), src);
    assert.ok(existsSync(join(dest, "ornith-loop", "SKILL.md")));
  } finally {
    await rm(src, { recursive: true, force: true });
    await rm(dest, { recursive: true, force: true });
  }
});
