import { test } from "node:test";
import assert from "node:assert/strict";
import { OUTCOMES, parseOrchestratorOutcome, scoreOrchestrator, orchestratorDeltas, ROUND_ACTIONS, parseRoundDecision } from "../src/orchestrator.js";

test("OUTCOMES is the closed set", () => {
  assert.deepEqual(OUTCOMES, ["done", "escalate"]);
});

test("parseOrchestratorOutcome: clean JSON object", () => {
  const o = parseOrchestratorOutcome('{"outcome":"done","roundsUsed":2,"reason":"tests green, diff in scope"}');
  assert.equal(o.outcome, "done");
  assert.equal(o.roundsUsed, 2);
  assert.equal(o.reason, "tests green, diff in scope");
});

test("parseOrchestratorOutcome: JSON wrapped in prose and code fences, normalized", () => {
  const o = parseOrchestratorOutcome('Here is my call:\n```json\n{"outcome":"ESCALATE","reason":"can\'t diagnose"}\n```\n');
  assert.equal(o.outcome, "escalate");
  assert.equal(o.roundsUsed, null);
});

test("parseOrchestratorOutcome: unparseable or missing outcome defaults to escalate, never done", () => {
  assert.equal(parseOrchestratorOutcome("").outcome, "escalate");
  assert.equal(parseOrchestratorOutcome("the model rambled without a decision").outcome, "escalate");
  assert.equal(parseOrchestratorOutcome('{"outcome":"looks finished"}').outcome, "escalate"); // not a known token
  assert.equal(parseOrchestratorOutcome(null).outcome, "escalate");
});

test("parseOrchestratorOutcome: a lone 'done' in prose is accepted; any ambiguity escalates", () => {
  assert.equal(parseOrchestratorOutcome("all done").outcome, "done");
  // both tokens present -> ambiguous -> escalate (bias against a stray 'done')
  assert.equal(parseOrchestratorOutcome("done, but maybe escalate").outcome, "escalate");
});

test("scoreOrchestrator: confusion, false-success and escalation are computed per model", () => {
  const rows = [
    // model M: 5 loops. oracle labels: pass,pass,fail,fail,pass
    { orchestratorModel: "M", orchestratorOutcome: "done", pass: true }, // trueSuccess
    { orchestratorModel: "M", orchestratorOutcome: "escalate", pass: true }, // escalatedOnPass
    { orchestratorModel: "M", orchestratorOutcome: "escalate", pass: false }, // escalatedOnFail
    { orchestratorModel: "M", orchestratorOutcome: "done", pass: false }, // falseSuccess — the fatal case
    { orchestratorModel: "M", orchestratorOutcome: "done", pass: true }, // trueSuccess
  ];
  const [s] = scoreOrchestrator(rows);
  assert.equal(s.model, "M");
  assert.equal(s.n, 5);
  assert.equal(s.counts.trueSuccess, 2);
  assert.equal(s.counts.falseSuccess, 1);
  assert.equal(s.doneVerdicts, 3);
  assert.equal(s.autonomousPassRate, 2 / 5);
  assert.equal(s.falseSuccessRate, 1 / 5);
  // effectiveFalseSuccess = falseSuccess / doneVerdicts = 1/3 of "done" calls were broken
  assert.equal(s.effectiveFalseSuccess, 1 / 3);
  // escalated = escalatedOnPass + escalatedOnFail = 2
  assert.equal(s.escalated, 2);
  assert.equal(s.escalationRate, 2 / 5);
});

test("scoreOrchestrator: a model that never false-succeeds sorts first", () => {
  const rows = [
    { orchestratorModel: "risky", orchestratorOutcome: "done", pass: false }, // false success
    { orchestratorModel: "safe", orchestratorOutcome: "escalate", pass: false }, // escalates instead
    { orchestratorModel: "safe", orchestratorOutcome: "done", pass: true },
  ];
  const scored = scoreOrchestrator(rows);
  assert.equal(scored[0].model, "safe"); // effectiveFalseSuccess 0 beats risky's 1
  assert.equal(scored[0].effectiveFalseSuccess, 0);
});

test("scoreOrchestrator: ties on safety break by capability, then escalation cost", () => {
  const rows = [
    // both never false-succeed (effFS=0); 'capable' finishes more autonomously
    { orchestratorModel: "capable", orchestratorOutcome: "done", pass: true },
    { orchestratorModel: "capable", orchestratorOutcome: "done", pass: true },
    { orchestratorModel: "timid", orchestratorOutcome: "done", pass: true },
    { orchestratorModel: "timid", orchestratorOutcome: "escalate", pass: true },
  ];
  const scored = scoreOrchestrator(rows);
  assert.equal(scored[0].model, "capable"); // higher autonomousPassRate wins the tie
});

test("scoreOrchestrator: rows with no outcome are ignored", () => {
  const scored = scoreOrchestrator([{ orchestratorModel: "M", orchestratorOutcome: null, pass: true }]);
  assert.equal(scored.length, 0);
});

test("orchestratorDeltas: per-task pass@N delta of a candidate vs the Claude baseline", () => {
  const rows = [
    // T6: claude 2/2, candidate 1/2 (one false-success does NOT count toward passN)
    { task: "T6", repeat: 1, orchestratorModel: "claude", orchestratorOutcome: "done", pass: true },
    { task: "T6", repeat: 2, orchestratorModel: "claude", orchestratorOutcome: "done", pass: true },
    { task: "T6", repeat: 1, orchestratorModel: "cand", orchestratorOutcome: "done", pass: true },
    { task: "T6", repeat: 2, orchestratorModel: "cand", orchestratorOutcome: "done", pass: false }, // false success: not a pass
  ];
  const [d] = orchestratorDeltas(rows, { baselineModel: "claude" });
  assert.equal(d.task, "T6");
  assert.equal(d.model, "cand");
  assert.equal(d.autonomousPassN, 1 / 2);
  assert.equal(d.baselinePassN, 1);
  assert.equal(d.delta, -1 / 2);
});

test("orchestratorDeltas: escalations do not count as autonomous passes; missing baseline -> null delta", () => {
  const rows = [
    { task: "T4", repeat: 1, orchestratorModel: "cand", orchestratorOutcome: "escalate", pass: true }, // Claude would finish it, but not autonomous
    { task: "T4", repeat: 2, orchestratorModel: "cand", orchestratorOutcome: "done", pass: true },
  ];
  const [d] = orchestratorDeltas(rows, { baselineModel: "claude" });
  assert.equal(d.autonomousPassN, 1 / 2); // 1 of 2 repeats finished autonomously
  assert.equal(d.baselinePassN, null); // no claude rows for T4
  assert.equal(d.delta, null);
});

test("ROUND_ACTIONS is the closed set", () => {
  assert.deepEqual(ROUND_ACTIONS, ["done", "retry", "escalate"]);
});

test("parseRoundDecision: clean done", () => {
  const d = parseRoundDecision('{"action":"done","reason":"tests green, in scope"}');
  assert.equal(d.action, "done");
  assert.equal(d.grounding, null);
  assert.equal(d.reason, "tests green, in scope");
});

test("parseRoundDecision: retry carries its corrective grounding fact", () => {
  const d = parseRoundDecision('{"action":"retry","grounding":"node --test needs no npm install","reason":"stray lockfile"}');
  assert.equal(d.action, "retry");
  assert.equal(d.grounding, "node --test needs no npm install");
});

test("parseRoundDecision: retry with no grounding fact degrades to escalate", () => {
  assert.equal(parseRoundDecision('{"action":"retry"}').action, "escalate");
  assert.equal(parseRoundDecision('{"action":"retry","grounding":"   "}').action, "escalate");
});

test("parseRoundDecision: explicit escalate, unknown action, and empty all escalate", () => {
  assert.equal(parseRoundDecision('{"action":"escalate","reason":"can\'t diagnose"}').action, "escalate");
  assert.equal(parseRoundDecision('{"action":"finish"}').action, "escalate");
  assert.equal(parseRoundDecision("").action, "escalate");
  assert.equal(parseRoundDecision(null).action, "escalate");
});

test("parseRoundDecision: JSON in prose/fences parses; a lone done in prose is accepted; ambiguity escalates", () => {
  assert.equal(parseRoundDecision('ok:\n```json\n{"action":"DONE"}\n```').action, "done");
  assert.equal(parseRoundDecision("I think we are done").action, "done");
  assert.equal(parseRoundDecision("done, or maybe retry").action, "escalate");
});
