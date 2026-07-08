import { test } from "node:test";
import assert from "node:assert/strict";
import { withTax, roundCents } from "../src/pricing.mjs";
import { lineTotal, cartTotal } from "../src/checkout.mjs";

test("withTax takes an explicit rate", () => {
  assert.equal(withTax(100, 0.2), 120);
  assert.equal(withTax(100, 0.1), 110);
  assert.equal(withTax(50, 0), 50);
});

test("checkout callers pass a 10% rate via the new signature", () => {
  assert.equal(lineTotal(100, 2), 220);    // withTax(100, 0.1) = 110, * 2 = 220
  assert.equal(cartTotal([100, 50]), 165); // 110 + 55 = 165
});

// Guards against token-level corruption elsewhere in the file (ornith's known
// in-place failure mode): roundCents must remain byte-exact behaviour.
test("roundCents is unchanged", () => {
  assert.equal(roundCents(1.239), 1.24);
  assert.equal(roundCents(2.5), 2.5);
});
