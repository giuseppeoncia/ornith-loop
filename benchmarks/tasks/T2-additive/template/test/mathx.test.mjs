import { test } from "node:test";
import assert from "node:assert/strict";
import { add, sub, mul } from "../src/mathx.mjs";

test("add", () => {
  assert.equal(add(2, 3), 5);
  assert.equal(add(-1, 1), 0);
});

test("sub", () => {
  assert.equal(sub(5, 3), 2);
  assert.equal(sub(0, 4), -4);
});

test("mul", () => {
  assert.equal(mul(2, 3), 6);
  assert.equal(mul(-2, 4), -8);
  assert.equal(mul(7, 0), 0);
});
