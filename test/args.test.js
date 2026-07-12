import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "../src/args.js";

test("defaults are applied for a bare run with inline prompt", () => {
  const { options, error } = parseArgs(["run", "make a file"]);
  assert.equal(error, undefined);
  assert.equal(options.command, "run");
  assert.equal(options.prompt, "make a file");
  assert.equal(options.model, "ornith-1.0-9b-64k");
  assert.equal(options.provider, "ollama");
  assert.equal(options.thinking, "off");
  assert.equal(options.timeoutSec, 900);
  assert.equal(options.runsDir, "runs");
  assert.ok(options.label.length > 0);
});

test("flags override defaults", () => {
  const { options } = parseArgs([
    "run", "hi", "--model", "qwen3.6-35b-a3b-64k", "--thinking", "off",
    "--timeout", "120", "--label", "exp1", "--workdir", "/tmp/t",
  ]);
  assert.equal(options.model, "qwen3.6-35b-a3b-64k");
  assert.equal(options.timeoutSec, 120);
  assert.equal(options.label, "exp1");
  assert.equal(options.workdir, "/tmp/t");
});

test("--prompt-file sets promptFile and leaves prompt empty", () => {
  const { options } = parseArgs(["run", "--prompt-file", "p.md"]);
  assert.equal(options.promptFile, "p.md");
  assert.equal(options.prompt, "");
});

test("--no-tools sets noTools; default is false", () => {
  assert.equal(parseArgs(["run", "hi"]).options.noTools, false);
  assert.equal(parseArgs(["run", "hi", "--no-tools"]).options.noTools, true);
});

test("errors: no prompt, both prompt sources, bad thinking, bad timeout, missing command", () => {
  assert.match(parseArgs(["run"]).error, /prompt/i);
  assert.match(parseArgs(["run", "hi", "--prompt-file", "p.md"]).error, /both/i);
  assert.match(parseArgs(["run", "hi", "--thinking", "on"]).error, /thinking/i);
  assert.match(parseArgs(["run", "hi", "--timeout", "-3"]).error, /timeout/i);
  assert.match(parseArgs(["bogus"]).error, /command/i);
});

test("--help returns help", () => {
  assert.equal(parseArgs(["--help"]).help, true);
});

test("install-skill: defaults to target auto", () => {
  const { options } = parseArgs(["install-skill"]);
  assert.equal(options.command, "install-skill");
  assert.equal(options.target, "auto");
});

test("install-skill: --target is honored and validated", () => {
  assert.equal(parseArgs(["install-skill", "--target", "opencode"]).options.target, "opencode");
  assert.equal(parseArgs(["install-skill", "--target", "claude"]).options.target, "claude");
  assert.match(parseArgs(["install-skill", "--target", "both"]).error, /target/i);
  assert.match(parseArgs(["install-skill", "--nope"]).error, /unexpected|unknown/i);
});

test("run parsing still works after dispatch refactor", () => {
  const { options } = parseArgs(["run", "make a file", "--label", "x"]);
  assert.equal(options.command, "run");
  assert.equal(options.prompt, "make a file");
  assert.equal(options.label, "x");
});

test("verify: required workdir + test-cmd, optional model/goal/grounding", () => {
  const { options } = parseArgs(["verify", "--workdir", "/r", "--test-cmd", "node --test", "--model", "qwen3.5:4b"]);
  assert.equal(options.command, "verify");
  assert.equal(options.workdir, "/r");
  assert.equal(options.testCmd, "node --test");
  assert.equal(options.model, "qwen3.5:4b");
  assert.match(parseArgs(["verify", "--test-cmd", "node --test"]).error, /workdir/);
  assert.match(parseArgs(["verify", "--workdir", "/r"]).error, /test-cmd/);
});

test("config: get/set/path parse", () => {
  assert.deepEqual(parseArgs(["config", "path"]).options, { command: "config", action: "path" });
  assert.deepEqual(parseArgs(["config", "get", "verifier.model"]).options, { command: "config", action: "get", key: "verifier.model" });
  assert.deepEqual(parseArgs(["config", "get"]).options, { command: "config", action: "get", key: null });
  assert.deepEqual(parseArgs(["config", "set", "verifier.enabled", "true"]).options, { command: "config", action: "set", key: "verifier.enabled", value: "true" });
  assert.match(parseArgs(["config", "set", "onlykey"]).error, /needs <key> <value>/);
  assert.match(parseArgs(["config", "bogus"]).error, /get.*set.*path/);
});

test("run: modelExplicit is false by default, true when --model given", () => {
  assert.equal(parseArgs(["run", "hi"]).options.modelExplicit, false);
  assert.equal(parseArgs(["run", "hi", "--model", "x"]).options.modelExplicit, true);
});
