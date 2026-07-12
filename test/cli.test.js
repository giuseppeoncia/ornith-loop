import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const pexec = promisify(execFile);
const orn = fileURLToPath(new URL("../bin/orn.js", import.meta.url));
const fakePi = fileURLToPath(new URL("./fixtures/fake-pi.js", import.meta.url));

test("orn run: writes a record, prints summary, exits 0", async () => {
  const runs = await mkdtemp(join(tmpdir(), "orn-cli-"));
  try {
    const { stdout } = await pexec(process.execPath, [orn, "run", "make a file", "--label", "it", "--runs-dir", runs], {
      env: { ...process.env, ORN_PI_BIN: fakePi, FAKE_PI_MODE: "success" },
    });
    assert.match(stdout, /exit: completed/);
    assert.match(stdout, /read → write/);
    const files = await readdir(runs);
    assert.ok(files.some((f) => f.endsWith(".json")));
    assert.ok(files.some((f) => f.endsWith(".jsonl")));
  } finally {
    await rm(runs, { recursive: true, force: true });
  }
});

test("orn run: nonzero exit when pi crashes", async () => {
  const runs = await mkdtemp(join(tmpdir(), "orn-cli-"));
  try {
    await assert.rejects(
      pexec(process.execPath, [orn, "run", "hi", "--runs-dir", runs], {
        env: { ...process.env, ORN_PI_BIN: fakePi, FAKE_PI_MODE: "crash" },
      }),
      (err) => err.code === 1
    );
  } finally {
    await rm(runs, { recursive: true, force: true });
  }
});

test("orn run: a slash-bearing --label does not crash; a record is still written", async () => {
  const runs = await mkdtemp(join(tmpdir(), "orn-cli-"));
  try {
    const { stdout } = await pexec(process.execPath, [orn, "run", "hi", "--label", "a/b", "--runs-dir", runs], {
      env: { ...process.env, ORN_PI_BIN: fakePi, FAKE_PI_MODE: "success" },
    });
    assert.match(stdout, /exit: completed/);
    const files = await readdir(runs);
    assert.ok(files.some((f) => f.endsWith(".json")), "a record json was written despite the slash label");
  } finally {
    await rm(runs, { recursive: true, force: true });
  }
});

test("orn --help exits 0 with usage", async () => {
  const { stdout } = await pexec(process.execPath, [orn, "--help"]);
  assert.match(stdout, /orn run/);
});

test("orn config: set then get round-trips via XDG_CONFIG_HOME", async () => {
  const cfgHome = await mkdtemp(join(tmpdir(), "orn-cfg-"));
  try {
    const env = { ...process.env, XDG_CONFIG_HOME: cfgHome };
    await pexec(process.execPath, [orn, "config", "set", "verifier.model", "gemma3:4b"], { env });
    const { stdout } = await pexec(process.execPath, [orn, "config", "get", "verifier.model"], { env });
    assert.match(stdout, /gemma3:4b/);
    const path = await pexec(process.execPath, [orn, "config", "path"], { env });
    assert.match(path.stdout, /ornith-loop\/config\.json/);
  } finally {
    await rm(cfgHome, { recursive: true, force: true });
  }
});

test("orn verify: not configured -> exit 3 with guidance", async () => {
  const cfgHome = await mkdtemp(join(tmpdir(), "orn-cfg-"));
  const wd = await mkdtemp(join(tmpdir(), "orn-wd-"));
  try {
    await assert.rejects(
      pexec(process.execPath, [orn, "verify", "--workdir", wd, "--test-cmd", "node --version"], {
        env: { ...process.env, XDG_CONFIG_HOME: cfgHome, ORN_PI_BIN: fakePi },
      }),
      (err) => err.code === 3 && /enable/i.test(err.stderr)
    );
  } finally {
    await rm(cfgHome, { recursive: true, force: true });
    await rm(wd, { recursive: true, force: true });
  }
});

test("orn verify: dry-run via fake-pi prints the stubbed verdict", async () => {
  const cfgHome = await mkdtemp(join(tmpdir(), "orn-cfg-"));
  const wd = await mkdtemp(join(tmpdir(), "orn-wd-"));
  try {
    const { spawnSync } = await import("node:child_process");
    const git = (a) => spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...a], { cwd: wd });
    git(["init", "-q"]); git(["commit", "-q", "--allow-empty", "-m", "base"]);
    const env = { ...process.env, XDG_CONFIG_HOME: cfgHome, ORN_PI_BIN: fakePi, FAKE_PI_VERDICT: "pass" };
    await pexec(process.execPath, [orn, "config", "set", "verifier.enabled", "true"], { env });
    const { stdout } = await pexec(process.execPath, [orn, "verify", "--workdir", wd, "--test-cmd", "node --version"], { env });
    assert.match(stdout, /^pass/);
  } finally {
    await rm(cfgHome, { recursive: true, force: true });
    await rm(wd, { recursive: true, force: true });
  }
});

test("orn install-skill --target claude: symlinks into CLAUDE_SKILLS_DIR", async () => {
  const skills = await mkdtemp(join(tmpdir(), "orn-skills-"));
  try {
    const { stdout } = await pexec(process.execPath, [orn, "install-skill", "--target", "claude"], {
      env: { ...process.env, CLAUDE_SKILLS_DIR: skills },
    });
    assert.match(stdout, /symlinked|copied/);
    const files = await readdir(skills);
    assert.ok(files.includes("ornith-loop"), "skill installed at target dir");
  } finally {
    await rm(skills, { recursive: true, force: true });
  }
});
