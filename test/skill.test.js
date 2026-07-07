import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const skill = readFileSync(
  fileURLToPath(new URL("../skill/ornith-loop/SKILL.md", import.meta.url)),
  "utf8"
);

function frontmatter(md) {
  const m = md.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(m, "SKILL.md must start with a YAML frontmatter block");
  const fm = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (kv) fm[kv[1]] = kv[2].trim();
  }
  return { fm, body: md.slice(m[0].length) };
}

test("SKILL.md frontmatter has the required, harness-recognized fields", () => {
  const { fm } = frontmatter(skill);
  assert.equal(fm.name, "ornith-loop");
  assert.ok(fm.description && fm.description.length > 20, "non-empty description");
  assert.equal(fm.license, "MIT");
});

test("SKILL.md body is host-neutral (cross-harness framing, no host-locked phrases)", () => {
  const { body } = frontmatter(skill);
  // Positive: an explicit cross-harness framing must be present.
  assert.match(body, /opencode/i, "body should name opencode as a supported host");
  assert.match(body, /any coding agent|whichever .* agent/i, "explicit host-agnostic framing");
  // Negative: no phrases that lock the skill to one host or a host-specific tool API.
  const denylist = [/claude code only/i, /the Read tool/i, /the Write tool/i, /the Bash tool/i];
  for (const re of denylist) assert.ok(!re.test(body), `host-locked phrase present: ${re}`);
});
