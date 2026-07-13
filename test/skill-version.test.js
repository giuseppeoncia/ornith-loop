import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseSkillVersion, formatSkillVersionReport } from "../src/skill-version.js";

test("parseSkillVersion: reads version from frontmatter", () => {
  const md = "---\nname: ornith-loop\nversion: 0.4.1\nlicense: Apache-2.0\n---\n\n# ornith-loop\n";
  assert.equal(parseSkillVersion(md), "0.4.1");
});

test("parseSkillVersion: no version field -> null", () => {
  assert.equal(parseSkillVersion("---\nname: ornith-loop\n---\nbody"), null);
});

test("parseSkillVersion: no frontmatter block -> null", () => {
  assert.equal(parseSkillVersion("# ornith-loop\nversion: 9.9.9 (in body, not frontmatter)"), null);
});

test("parseSkillVersion: non-string -> null", () => {
  assert.equal(parseSkillVersion(null), null);
  assert.equal(parseSkillVersion(undefined), null);
});

test("formatSkillVersionReport: bundled + matching install + not-installed", () => {
  const out = formatSkillVersionReport({
    bundled: "0.3.0",
    installed: [{ name: "claude", version: "0.3.0" }, { name: "opencode", version: null }],
  });
  assert.match(out, /bundled:\s+0\.3\.0/);
  assert.match(out, /claude:\s+0\.3\.0/);
  assert.match(out, /opencode:\s+not installed/);
  assert.doesNotMatch(out, /bundled 0\.3\.0\)/); // no mismatch marker when equal
});

test("formatSkillVersionReport: mismatch is flagged with the bundled version", () => {
  const out = formatSkillVersionReport({
    bundled: "0.4.1",
    installed: [{ name: "claude", version: "0.4.0" }],
  });
  assert.match(out, /claude:\s+0\.4\.0\s+\(bundled 0\.4\.1\)/);
});

test("SKILL.md frontmatter version stays in sync with package.json", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const skill = parseSkillVersion(readFileSync(join(root, "skill", "ornith-loop", "SKILL.md"), "utf8"));
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
  assert.equal(skill, pkg, "SKILL.md frontmatter version must equal package.json version (bump both on release)");
});

test("orn skill-version: reports bundled + installed, flags not-installed", () => {
  const orn = fileURLToPath(new URL("../bin/orn.js", import.meta.url));
  const root = fileURLToPath(new URL("..", import.meta.url));
  const bundled = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
  const base = mkdtempSync(join(tmpdir(), "orn-skillver-"));
  const claudeDir = join(base, "claude-skills");
  const ocDir = join(base, "oc-skills");
  mkdirSync(join(claudeDir, "ornith-loop"), { recursive: true });
  mkdirSync(ocDir, { recursive: true });
  writeFileSync(join(claudeDir, "ornith-loop", "SKILL.md"), `---\nname: ornith-loop\nversion: ${bundled}\n---\nx`);
  try {
    const out = execFileSync(process.execPath, [orn, "skill-version"], {
      encoding: "utf8",
      env: { ...process.env, CLAUDE_SKILLS_DIR: claudeDir, OPENCODE_SKILLS_DIR: ocDir },
    });
    assert.match(out, new RegExp(`bundled:\\s+${bundled.replace(/\./g, "\\.")}`));
    assert.match(out, new RegExp(`claude:\\s+${bundled.replace(/\./g, "\\.")}`));
    assert.match(out, /opencode:\s+not installed/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
