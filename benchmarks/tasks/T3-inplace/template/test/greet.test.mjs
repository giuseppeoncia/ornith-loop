import { test } from "node:test";
import assert from "node:assert/strict";
import { greet, shout } from "../src/greet.mjs";

test("greet uses the Spanish greeting", () => {
  assert.equal(greet("Ada"), "Hola, Ada!");
  assert.equal(greet("Bjarne"), "Hola, Bjarne!");
});

// Guards against token-level corruption elsewhere in the file (ornith's known
// in-place failure mode): shout must remain byte-exact behaviour.
test("shout is unchanged", () => {
  assert.equal(shout("hi"), "HI!");
  assert.equal(shout("Ada"), "ADA!");
});
