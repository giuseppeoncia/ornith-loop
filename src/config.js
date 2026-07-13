import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

export function defaultConfig() {
  return {
    executor: { model: "ornith-1.0-9b-64k" },
    verifier: { enabled: false, model: "qwen3.5:4b" },
    correctiveRounds: 3,
  };
}

// The closed set of dotted keys `orn config set` accepts, with each key's kind.
export const KNOWN_KEYS = {
  "executor.model": { kind: "string" },
  "verifier.enabled": { kind: "boolean" },
  "verifier.model": { kind: "string" },
  "correctiveRounds": { kind: "posint" },
};

export function configPath(env = process.env, home = homedir()) {
  const xdg = env.XDG_CONFIG_HOME && env.XDG_CONFIG_HOME.trim() ? env.XDG_CONFIG_HOME : join(home, ".config");
  return join(xdg, "ornith-loop", "config.json");
}

// Merge the persisted file over defaults, key by key (so an unknown/garbage key
// in the file can never poison the config). Malformed JSON -> defaults + warn.
export function loadConfig(env = process.env, home = homedir(), warn = (m) => process.stderr.write(m + "\n")) {
  const path = configPath(env, home);
  const cfg = defaultConfig();
  if (!existsSync(path)) return cfg;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    if (raw && typeof raw === "object") {
      if (raw.executor && typeof raw.executor.model === "string") cfg.executor.model = raw.executor.model;
      if (raw.verifier && typeof raw.verifier === "object") {
        if (typeof raw.verifier.enabled === "boolean") cfg.verifier.enabled = raw.verifier.enabled;
        if (typeof raw.verifier.model === "string") cfg.verifier.model = raw.verifier.model;
      }
      if (Number.isInteger(raw.correctiveRounds) && raw.correctiveRounds > 0) cfg.correctiveRounds = raw.correctiveRounds;
    }
  } catch {
    warn(`orn: ignoring malformed config at ${path} (using defaults)`);
  }
  return cfg;
}

function coerce(key, value) {
  const spec = KNOWN_KEYS[key];
  if (!spec) return { error: `unknown key '${key}': one of ${Object.keys(KNOWN_KEYS).join(", ")}` };
  if (spec.kind === "string") {
    if (value == null || !String(value).trim()) return { error: `${key} must be a non-empty string` };
    return { value: String(value) };
  }
  if (spec.kind === "boolean") {
    if (value === "true") return { value: true };
    if (value === "false") return { value: false };
    return { error: `${key} must be 'true' or 'false'` };
  }
  // posint
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return { error: `${key} must be a positive integer` };
  return { value: n };
}

// Set one known key without clobbering the others: load current (file or
// defaults), apply, write pretty JSON. Returns { config, path } or { error }.
export function setConfigKey(key, rawValue, env = process.env, home = homedir()) {
  const c = coerce(key, rawValue);
  if (c.error) return { error: c.error };
  const path = configPath(env, home);
  const cfg = loadConfig(env, home, () => {});
  const [a, b] = key.split(".");
  if (b) { cfg[a] = cfg[a] || {}; cfg[a][b] = c.value; } else { cfg[a] = c.value; }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(cfg, null, 2) + "\n");
  return { config: cfg, path };
}

export function getConfigKey(cfg, key) {
  const [a, b] = key.split(".");
  return b ? cfg?.[a]?.[b] : cfg?.[a];
}
