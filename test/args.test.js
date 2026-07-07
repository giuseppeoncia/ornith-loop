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
