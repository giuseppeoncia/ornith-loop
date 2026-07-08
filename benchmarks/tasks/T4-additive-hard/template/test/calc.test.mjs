import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate } from "../src/registry.mjs";

test("existing operators still work", () => {
  assert.equal(evaluate("2 3 add"), 5);
  assert.equal(evaluate("10 4 sub"), 6);
  assert.equal(evaluate("6 7 mul"), 42);
  assert.equal(evaluate("20 5 div"), 4);
});

test("pow operator raises to a power", () => {
  assert.equal(evaluate("2 10 pow"), 1024);
  assert.equal(evaluate("5 0 pow"), 1);
  assert.equal(evaluate("3 2 pow"), 9);
});

test("pow composes with the other operators", () => {
  // (2 3 pow) then + 1  ->  8 + 1 = 9
  assert.equal(evaluate("2 3 pow 1 add"), 9);
});
