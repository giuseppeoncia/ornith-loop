import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const BENCH = join(REPO, "benchmarks", "bench.mjs");
const FAKE_PI = join(REPO, "test", "fixtures", "fake-pi.js");

test("orchestrate: dry-run via fake-pi emits one schema-correct row (no ollama)", () => {
  const resultsDir = mkdtempSync(join(tmpdir(), "orch-it-"));
  try {
    const res = spawnSync(process.execPath, [
      BENCH, "orchestrate",
      "--task", "T4-additive-hard",
      "--orchestrator-model", "fake-cand",
      "--verifier-model", "fake-verifier",
      "--repeats", "1",
      "--results-dir", resultsDir,
    ], {
      encoding: "utf8",
      env: { ...process.env, ORN_PI_BIN: FAKE_PI, FAKE_PI_ACTION: "done", FAKE_PI_VERDICT: "pass" },
    });
    assert.equal(res.status, 0, res.stderr);

    const file = join(resultsDir, "T4-additive-hard__orch-fake-cand.jsonl");
    assert.ok(existsSync(file), "results file written");
    const rows = readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(rows.length, 1);
    const r = rows[0];
    assert.equal(r.task, "T4-additive-hard");
    assert.equal(r.repeat, 1);
    assert.equal(r.orchestratorModel, "fake-cand");
    assert.equal(r.orchestratorOutcome, "done");     // FAKE_PI_ACTION=done
    assert.equal(r.orchestratorRounds, 1);           // done on round 1
    assert.equal(r.verifierModel, "fake-verifier");
    assert.equal(typeof r.pass, "boolean");          // oracle ran (false: fake-pi doesn't solve)
  } finally {
    rmSync(resultsDir, { recursive: true, force: true });
  }
});
