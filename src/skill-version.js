// Read + report the ornith-loop skill's version (bin: `orn skill-version`).
// The version lives in the SKILL.md YAML frontmatter and is kept in sync with
// package.json (a test enforces it; the release flow bumps both). Pure — the
// CLI does the file IO and passes the parsed strings in.

// Extract `version:` from a SKILL.md's leading `---` frontmatter block. Returns
// null when there is no frontmatter block or no version field (never throws).
export function parseSkillVersion(text) {
  if (typeof text !== "string") return null;
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return null;
  const v = fm[1].match(/^version:\s*(.+?)\s*$/m);
  return v ? v[1].trim() : null;
}

// Render the bundled version and each install location, flagging a mismatch
// against the bundled version and "not installed" where absent.
// installed: [{ name, version: string|null }]
export function formatSkillVersionReport({ bundled, installed }) {
  const b = bundled ?? "unknown";
  const rows = [["bundled:", b]];
  for (const { name, version } of installed) {
    if (version == null) rows.push([`${name}:`, "not installed"]);
    else rows.push([`${name}:`, version === bundled ? version : `${version}  (bundled ${b})`]);
  }
  const w = Math.max(...rows.map((r) => r[0].length)) + 1;
  return rows.map(([k, v]) => `${k.padEnd(w)}${v}`).join("\n");
}
