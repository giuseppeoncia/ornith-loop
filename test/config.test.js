import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig, KNOWN_KEYS, configPath, loadConfig, setConfigKey, getConfigKey } from "../src/config.js";

test("defaultConfig: verifier off by default, expected shape", () => {
  const c = defaultConfig();
  assert.equal(c.executor.model, "ornith-1.0-9b-64k");
  assert.equal(c.verifier.enabled, false);
  assert.equal(c.verifier.model, "qwen3.5:4b");
  assert.equal(c.correctiveRounds, 3);
});

test("KNOWN_KEYS is the closed set", () => {
  assert.deepEqual(Object.keys(KNOWN_KEYS).sort(), ["correctiveRounds", "executor.model", "verifier.enabled", "verifier.model"]);
});

test("configPath honors XDG_CONFIG_HOME, else ~/.config", () => {
  assert.equal(configPath({ XDG_CONFIG_HOME: "/x" }, "/home/u"), "/x/ornith-loop/config.json");
  assert.equal(configPath({}, "/home/u"), "/home/u/.config/ornith-loop/config.json");
});

test("loadConfig: missing file -> defaults", () => {
  const c = loadConfig({ XDG_CONFIG_HOME: "/nonexistent-xdg-abc" }, "/home/u");
  assert.deepEqual(c, defaultConfig());
});

test("setConfigKey then loadConfig round-trips known keys; unknown key errors", async () => {
  const dir = await mkdtemp(join(tmpdir(), "orn-cfg-"));
  try {
    const env = { XDG_CONFIG_HOME: dir };
    assert.equal(setConfigKey("verifier.enabled", "true", env, "/home/u").config.verifier.enabled, true);
    setConfigKey("verifier.model", "gemma3:4b", env, "/home/u");
    setConfigKey("correctiveRounds", "5", env, "/home/u");
    const c = loadConfig(env, "/home/u");
    assert.equal(c.verifier.enabled, true);
    assert.equal(c.verifier.model, "gemma3:4b");
    assert.equal(c.correctiveRounds, 5);
    assert.equal(c.executor.model, "ornith-1.0-9b-64k"); // untouched key preserved
    assert.match(setConfigKey("bogus.key", "x", env, "/home/u").error, /unknown key/);
    assert.match(setConfigKey("verifier.enabled", "yes", env, "/home/u").error, /true.*false/);
    assert.match(setConfigKey("correctiveRounds", "0", env, "/home/u").error, /positive integer/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadConfig: malformed file -> defaults + warning", async () => {
  const dir = await mkdtemp(join(tmpdir(), "orn-cfg-"));
  try {
    await mkdir(join(dir, "ornith-loop"), { recursive: true });
    await writeFile(join(dir, "ornith-loop", "config.json"), "{not json");
    let warned = "";
    const c = loadConfig({ XDG_CONFIG_HOME: dir }, "/home/u", (m) => (warned = m));
    assert.deepEqual(c, defaultConfig());
    assert.match(warned, /malformed/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("getConfigKey reads dotted and top-level keys", () => {
  const c = defaultConfig();
  assert.equal(getConfigKey(c, "verifier.model"), "qwen3.5:4b");
  assert.equal(getConfigKey(c, "correctiveRounds"), 3);
});
