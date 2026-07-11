import { test } from "node:test";
import assert from "node:assert/strict";
import { VERDICTS, buildEvidencePacket, parseVerdict, scoreVerifier, corpusRecordFrom } from "../src/verifier.js";

test("buildEvidencePacket: includes ground truth, excludes the answer-key and ornith prose", () => {
  const packet = buildEvidencePacket({
    goal: "add pow to the RPN calc",
    grounding: "edit src/ops.mjs and src/registry.mjs",
    testCmd: ["node", "--test"],
    testOutput: "# pass 3\n# fail 0",
    testExitCode: 0,
    changedFiles: ["src/ops.mjs", "src/registry.mjs"],
    diff: "+ export function pow(a, b) { return a ** b; }",
    record: {
      model: "ornith-1.0-9b-64k",
      exit: { reason: "completed" },
      toolCallCount: 4,
      toolSequence: [{ name: "Read" }, { name: "Edit", isError: true }],
      workdirChange: { changed: true },
      finalText: "All done! Tests pass ✅",
      flags: { toolCallAsText: true, claimedDone: true, stoppedBeforeToolCall: false },
    },
  });

  assert.match(packet, /add pow to the RPN calc/);
  assert.match(packet, /src\/registry\.mjs/);
  assert.match(packet, /exit code: 0/);
  assert.match(packet, /Read → Edit!/); // tool error marked with trailing !
  assert.match(packet, /flags on: toolCallAsText/);
  assert.doesNotMatch(packet, /toolCallAsText.*false|stoppedBeforeToolCall/); // only on-flags listed
  // The executor's self-report must never leak into the packet.
  assert.doesNotMatch(packet, /All done/);
});

test("buildEvidencePacket: unchanged workdir and empty diff are stated explicitly", () => {
  const packet = buildEvidencePacket({ goal: "x", changedFiles: [], diff: "" });
  assert.match(packet, /workdir is unchanged/);
  assert.match(packet, /\(empty\)/);
});

test("parseVerdict: clean JSON object", () => {
  const v = parseVerdict('{"verdict":"pass","evidence":["exit 0"],"reason":"green + in scope"}');
  assert.equal(v.verdict, "pass");
  assert.deepEqual(v.evidence, ["exit 0"]);
  assert.equal(v.reason, "green + in scope");
});

test("parseVerdict: JSON wrapped in prose and code fences", () => {
  const v = parseVerdict('Sure — here is my verdict:\n```json\n{"verdict":"FAIL","reason":"tests red"}\n```\nHope that helps.');
  assert.equal(v.verdict, "fail"); // normalized to lowercase
  assert.deepEqual(v.evidence, []);
});

test("parseVerdict: unparseable or missing verdict defaults to uncertain, never pass", () => {
  assert.equal(parseVerdict("").verdict, "uncertain");
  assert.equal(parseVerdict("the model rambled without a verdict").verdict, "uncertain");
  assert.equal(parseVerdict('{"verdict":"looks good to me"}').verdict, "uncertain"); // not a known token
  assert.equal(parseVerdict(null).verdict, "uncertain");
});

test("parseVerdict: a single bare token in prose is accepted; ambiguity escalates", () => {
  assert.equal(parseVerdict("my judgement: fail").verdict, "fail");
  // both 'pass' and 'fail' present -> ambiguous -> uncertain
  assert.equal(parseVerdict("could be pass, could be fail").verdict, "uncertain");
});

test("VERDICTS is the closed set", () => {
  assert.deepEqual(VERDICTS, ["pass", "fail", "uncertain"]);
});

test("scoreVerifier: confusion, false-pass and escalation are computed per model", () => {
  const rows = [
    // model M: 5 runs. oracle labels: pass,pass,fail,fail,pass
    { verifierModel: "M", verifierVerdict: "pass", pass: true }, // truePass
    { verifierModel: "M", verifierVerdict: "uncertain", pass: true }, // uncertainOnPass (escalates)
    { verifierModel: "M", verifierVerdict: "fail", pass: false }, // trueFail (escalates)
    { verifierModel: "M", verifierVerdict: "pass", pass: false }, // falsePass — the fatal case
    { verifierModel: "M", verifierVerdict: "uncertain", pass: true }, // uncertainOnPass
  ];
  const [s] = scoreVerifier(rows);
  assert.equal(s.model, "M");
  assert.equal(s.n, 5);
  assert.equal(s.counts.truePass, 1);
  assert.equal(s.counts.falsePass, 1);
  assert.equal(s.counts.trueFail, 1);
  assert.equal(s.passVerdicts, 2);
  assert.equal(s.falsePassRate, 1 / 5);
  // effectiveFalsePass = falsePass / passVerdicts = 1/2 — half of auto-accepted passes were wrong
  assert.equal(s.effectiveFalsePass, 1 / 2);
  // escalated = fail + uncertain = 1 + 2 = 3
  assert.equal(s.escalated, 3);
  assert.equal(s.escalationRate, 3 / 5);
  // agreement over decided (pass+fail verdicts = 3): truePass+trueFail = 2 -> 2/3
  assert.equal(s.agreementRate, 2 / 3);
});

test("scoreVerifier: a model that never false-passes sorts first", () => {
  const rows = [
    { verifierModel: "risky", verifierVerdict: "pass", pass: false }, // false pass
    { verifierModel: "safe", verifierVerdict: "uncertain", pass: false }, // escalates instead
    { verifierModel: "safe", verifierVerdict: "pass", pass: true },
  ];
  const scored = scoreVerifier(rows);
  assert.equal(scored[0].model, "safe"); // effectiveFalsePass 0 beats risky's 1
  assert.equal(scored[0].effectiveFalsePass, 0);
});

test("scoreVerifier: rows with no verdict are ignored", () => {
  const scored = scoreVerifier([{ verifierModel: "M", verifierVerdict: null, pass: true }]);
  assert.equal(scored.length, 0);
});

test("corpusRecordFrom: freezes ground-truth evidence + gold label, drops ornith prose", () => {
  const rec = corpusRecordFrom({
    task: "T3-inplace", arm: "A", round: 1, repeat: 2, runId: "rid-1",
    goldPass: false, goal: "spanish greet", grounding: "edit src/greet.mjs",
    evidence: { testCmd: ["node", "--test"], testOutput: "# fail 1", testExitCode: 1, changedFiles: ["src/greet.mjs"], diff: "- Hello\n+ Hola" },
    record: { model: "ornith-1.0-9b-64k", exit: { reason: "completed" }, toolCallCount: 4, toolSequence: [{ name: "Edit" }], workdirChange: { changed: true }, finalText: "All done ✅", flags: { claimedDone: true } },
  });
  assert.equal(rec.goldPass, false);
  assert.equal(rec.diff, "- Hello\n+ Hola");
  assert.deepEqual(rec.changedFiles, ["src/greet.mjs"]);
  assert.equal(rec.record.model, "ornith-1.0-9b-64k");
  assert.equal(rec.record.workdirChange.changed, true);
  assert.ok(!("finalText" in rec.record), "slim record must not carry ornith prose");
  assert.equal(JSON.stringify(rec).includes("All done"), false, "no finalText anywhere in the record");
});

test("corpusRecordFrom round-trips through buildEvidencePacket (same ground truth, no prose)", () => {
  const rec = corpusRecordFrom({
    task: "T3-inplace", arm: "A", repeat: 1, goldPass: true, goal: "spanish greet", grounding: "edit src/greet.mjs",
    evidence: { testCmd: ["node", "--test"], testOutput: "# pass 2", testExitCode: 0, changedFiles: ["src/greet.mjs"], diff: "+ Hola" },
    record: { model: "ornith", exit: { reason: "completed" }, toolCallCount: 3, toolSequence: [{ name: "Edit" }], workdirChange: { changed: true }, finalText: "SHIP IT", flags: {} },
  });
  const packet = buildEvidencePacket({
    goal: rec.goal, grounding: rec.grounding, testCmd: rec.testCmd, testOutput: rec.testOutput,
    testExitCode: rec.testExitCode, changedFiles: rec.changedFiles, diff: rec.diff, record: rec.record,
  });
  assert.match(packet, /spanish greet/);
  assert.match(packet, /exit code: 0/);
  assert.doesNotMatch(packet, /SHIP IT/);
});

test("corpusRecordFrom: slims toolSequence to name/isError, dropping model-authored args", () => {
  const rec = corpusRecordFrom({
    task: "T", arm: "A", repeat: 1, goldPass: true,
    evidence: { testCmd: ["node", "--test"], testOutput: "ok", testExitCode: 0, changedFiles: [], diff: "" },
    record: {
      model: "ornith", exit: { reason: "completed" }, toolCallCount: 1,
      toolSequence: [{ name: "Write", args: { path: "x.js", content: "SECRET FILE BODY" }, isError: false }],
      workdirChange: { changed: true }, flags: {},
    },
  });
  assert.deepEqual(rec.record.toolSequence, [{ name: "Write", isError: false }]);
  assert.equal(JSON.stringify(rec).includes("SECRET FILE BODY"), false, "model-authored args must not reach the corpus");
});
