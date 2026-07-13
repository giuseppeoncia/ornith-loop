import { mkdirSync, rmSync, symlinkSync, cpSync, existsSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { defaultConfig, configPath } from "./config.js";

const SKILL_NAME = "ornith-loop";

// Where each harness discovers global/personal skills (env override wins).
export function skillDirs(env, homedir) {
  return {
    claude: env.CLAUDE_SKILLS_DIR || join(homedir, ".claude", "skills"),
    opencode: env.OPENCODE_SKILLS_DIR || join(homedir, ".config", "opencode", "skills"),
  };
}

// Pure detection: `exists` and `pathEntries` are injected so this is unit-testable.
export function detectHarnesses({ env, homedir, exists, pathEntries }) {
  const claude = Boolean(env.CLAUDE_SKILLS_DIR) || exists(join(homedir, ".claude"));
  const opencode =
    Boolean(env.OPENCODE_SKILLS_DIR) ||
    exists(join(homedir, ".config", "opencode")) ||
    pathEntries.some((p) => exists(join(p, "opencode")));
  return { claude, opencode };
}

// Pure: (target + detected) -> install targets. `auto` yields only detected harnesses.
export function resolveTargets({ target, env, homedir, detected }) {
  const dirs = skillDirs(env, homedir);
  if (target === "claude") return [{ name: "claude", dir: dirs.claude }];
  if (target === "opencode") return [{ name: "opencode", dir: dirs.opencode }];
  const out = [];
  if (detected.claude) out.push({ name: "claude", dir: dirs.claude });
  if (detected.opencode) out.push({ name: "opencode", dir: dirs.opencode });
  return out;
}

// Effectful: symlink the skill source into each target dir (copy fallback). Idempotent.
export function installSkill(targets, sourceDir) {
  return targets.map(({ name, dir }) => {
    const dest = join(dir, SKILL_NAME);
    mkdirSync(dir, { recursive: true });
    rmSync(dest, { recursive: true, force: true });
    let method;
    try {
      symlinkSync(sourceDir, dest);
      method = "symlinked";
    } catch {
      cpSync(sourceDir, dest, { recursive: true });
      method = "copied";
    }
    return { name, dest, method };
  });
}

// Write the default config if none exists yet. Idempotent.
export function ensureDefaultConfig(env, home) {
  const path = configPath(env, home);
  if (existsSync(path)) return { created: false, path };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(defaultConfig(), null, 2) + "\n");
  return { created: true, path };
}

// The install-time pointer that makes the optional local verifier discoverable.
export function discoveryMessage(cfg, ollamaModels) {
  const lines = [
    "",
    `Local verifier: ${cfg.verifier.enabled ? `ON (${cfg.verifier.model})` : "OFF (Claude verifies each run)"}.`,
    "Optional: offload the first verification pass to a local model —",
    "  orn config set verifier.enabled true",
    "  orn config set verifier.model <id>",
  ];
  if (Array.isArray(ollamaModels) && ollamaModels.length) {
    lines.push(`Ollama models detected: ${ollamaModels.join(", ")}`);
  }
  lines.push("See docs/VERIFIER.md for how to pick one (the metric is false-pass rate).");
  return lines.join("\n") + "\n";
}
