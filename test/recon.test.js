import { test } from "node:test";
import assert from "node:assert/strict";
import { extractGoalTokens } from "../src/recon.js";

test("extractGoalTokens: pulls camelCase words and backtick spans, drops stopwords", () => {
  const goal =
    "Refactor `withTax` in `src/pricing.mjs` to take the rate as a second argument; " +
    "update its callers lineTotal and cartTotal. Leave roundCents exactly as it is. Run `node --test`.";
  const toks = extractGoalTokens(goal);
  for (const t of ["withTax", "roundCents", "lineTotal", "cartTotal", "src/pricing.mjs"]) {
    assert.ok(toks.includes(t), `expected token ${t} in ${JSON.stringify(toks)}`);
  }
  // stopwords / bare English prose words are not tokens
  assert.ok(!toks.includes("Refactor"));
  assert.ok(!toks.includes("the"));
  // deduped
  assert.equal(new Set(toks).size, toks.length);
});

test("extractGoalTokens: non-string input is safe", () => {
  assert.deepEqual(extractGoalTokens(null), []);
  assert.deepEqual(extractGoalTokens(undefined), []);
});
