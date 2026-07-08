import { test } from "node:test";
import assert from "node:assert/strict";
import { ARMS, ARM_IDS, assemblePrompt, aggregate, deltas } from "../src/bench.js";

const PARTS = { goal: "GOAL", grounding: "GROUND", scaffold: "SCAFFOLD" };

test("arms: A and B2 differ only by the scaffold part; A and B3 only by loop", () => {
  assert.deepEqual(ARMS.A.parts, ["goal", "grounding"]);
  assert.deepEqual(ARMS.B2.parts, ["goal", "grounding", "scaffold"]);
  assert.deepEqual(ARMS.A.parts, ARMS.B3.parts);
  assert.equal(ARMS.A.loop, true);
  assert.equal(ARMS.B3.loop, false);
  assert.deepEqual(ARM_IDS, ["A", "B1", "B2", "B3"]);
});

test("assemblePrompt: B1 is goal only, B3 adds grounding, B2 adds scaffold", () => {
  assert.equal(assemblePrompt("B1", PARTS), "GOAL");
  assert.equal(assemblePrompt("B3", PARTS), "GOAL\n\nGROUND");
  assert.equal(assemblePrompt("A", PARTS), "GOAL\n\nGROUND");
  assert.equal(assemblePrompt("B2", PARTS), "GOAL\n\nGROUND\n\nSCAFFOLD");
});

test("assemblePrompt: extra grounding appends only on round >= 2, and only for looped arms", () => {
  assert.equal(assemblePrompt("A", PARTS, { round: 1, extra: "X" }), "GOAL\n\nGROUND");
  assert.equal(assemblePrompt("A", PARTS, { round: 2, extra: "X" }), "GOAL\n\nGROUND\n\nX");
  assert.throws(() => assemblePrompt("B3", PARTS, { round: 2 }), /single-shot/);
});

test("assemblePrompt: unknown arm throws", () => {
  assert.throws(() => assemblePrompt("Z", PARTS), /unknown arm/);
});

test("aggregate: pass@1 vs pass@N and rounds-to-pass", () => {
  const rows = [
    // repeat 1 passes on round 2; repeat 2 fails all the way
    { task: "T", arm: "A", repeat: 1, round: 1, pass: false, flags: { "stopped-before-tool-call": true } },
    { task: "T", arm: "A", repeat: 1, round: 2, pass: true, flags: {} },
    { task: "T", arm: "A", repeat: 2, round: 1, pass: false, flags: {} },
    { task: "T", arm: "A", repeat: 2, round: 2, pass: false, flags: {} },
    { task: "T", arm: "A", repeat: 2, round: 3, pass: false, flags: {} },
  ];
  const [r] = aggregate(rows);
  assert.equal(r.repeats, 2);
  assert.equal(r.pass1Rate, 0); // neither passed on round 1
  assert.equal(r.passNRate, 0.5); // repeat 1 eventually passed
  assert.deepEqual(r.roundsToPass, { 2: 1, never: 1 });
  assert.equal(r.flagRates["stopped-before-tool-call"], 1 / 5); // 1 of 5 attempts
});

test("deltas: H1/H2/H3 use passN for looped arms and pass1 for single-shot", () => {
  const rows = [
    { task: "T", arm: "A", repeat: 1, round: 1, pass: true, flags: {} }, // A passN = 1
    { task: "T", arm: "B1", repeat: 1, round: 1, pass: false, flags: {} }, // B1 pass1 = 0
    { task: "T", arm: "B2", repeat: 1, round: 1, pass: true, flags: {} }, // B2 passN = 1
    { task: "T", arm: "B3", repeat: 1, round: 1, pass: false, flags: {} }, // B3 pass1 = 0
  ];
  const [d] = deltas(aggregate(rows));
  assert.equal(d.A, 1);
  assert.equal(d["H2_A_minus_B1"], 1); // 1 - 0
  assert.equal(d["H1_A_minus_B2"], 0); // 1 - 1
  assert.equal(d["H3_A_minus_B3"], 1); // 1 - 0
});
