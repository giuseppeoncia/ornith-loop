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
