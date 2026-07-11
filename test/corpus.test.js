import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile, mkdir } from "node:fs/promises";
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

test("verify-corpus replays a candidate over a corpus into source:corpus rows", async () => {
  const corpus = await mkdtemp(join(tmpdir(), "corpus-"));
  const results = await mkdtemp(join(tmpdir(), "results-"));
  try {
    // Hand-crafted corpus record (oracle said fail; a diff exists).
    const rec = {
      task: "T3-inplace", arm: "A", round: 1, repeat: 1, runId: "rid",
      goldPass: false, goal: "spanish greet", grounding: "edit src/greet.mjs",
      testCmd: ["node", "--test"], testOutput: "# fail 1", testExitCode: 1,
      changedFiles: ["src/greet.mjs"], diff: "- Hello\n+ Hola",
      record: { model: "ornith", exit: { reason: "completed" }, toolCallCount: 3, toolSequence: [], workdirChange: { changed: true }, flags: {} },
    };
    await writeFile(join(corpus, "T3-inplace__A__r1__k1.json"), JSON.stringify(rec));

    await pexec(process.execPath, [
      bench, "verify-corpus", "--corpus", corpus, "--verifier-model", "fake", "--results-dir", results,
    ], { env: { ...process.env, ORN_PI_BIN: fakePi, FAKE_PI_VERDICT: "pass" } });

    const out = await readFile(join(results, "T3-inplace__A.jsonl"), "utf8");
    const rows = out.trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].source, "corpus");
    assert.equal(rows[0].verifierModel, "fake");
    assert.equal(rows[0].verifierVerdict, "pass");
    assert.equal(rows[0].pass, false);   // gold label carried through from the corpus
  } finally {
    await rm(corpus, { recursive: true, force: true });
    await rm(results, { recursive: true, force: true });
  }
});
