import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const pexec = promisify(execFile);
const bench = fileURLToPath(new URL("../benchmarks/bench.mjs", import.meta.url));
const fakePi = fileURLToPath(new URL("./fixtures/fake-pi.js", import.meta.url));

test("run --save-corpus writes a slim ground-truth record (no finalText)", async () => {
  const corpus = await mkdtemp(join(tmpdir(), "corpus-"));
  const results = await mkdtemp(join(tmpdir(), "results-"));
  try {
    await pexec(process.execPath, [
      bench, "run", "--task", "T1-scratch", "--arm", "B1", "--repeats", "1",
      "--save-corpus", corpus, "--results-dir", results,
    ], { env: { ...process.env, ORN_PI_BIN: fakePi, FAKE_PI_MODE: "success" } });

    const files = (await readdir(corpus)).filter((f) => f.endsWith(".json"));
    assert.equal(files.length, 1, "one corpus record for one repeat");
    const rec = JSON.parse(await readFile(join(corpus, files[0]), "utf8"));
    assert.equal(rec.task, "T1-scratch");
    assert.equal(rec.arm, "B1");
    assert.equal(typeof rec.goldPass, "boolean");
    assert.ok("diff" in rec && "changedFiles" in rec && "testOutput" in rec);
    assert.ok(!("finalText" in rec.record), "record must not carry ornith prose");
  } finally {
    await rm(corpus, { recursive: true, force: true });
    await rm(results, { recursive: true, force: true });
  }
});
