import { add, sub, mul, div } from "./ops.mjs";

// Map from RPN operator token to its binary implementation.
export const OPS = {
  add,
  sub,
  mul,
  div,
};

// Evaluate a whitespace-separated RPN expression, e.g. "2 3 add" -> 5.
export function evaluate(expr) {
  const stack = [];
  for (const tok of expr.trim().split(/\s+/)) {
    if (tok in OPS) {
      const b = stack.pop();
      const a = stack.pop();
      if (a === undefined || b === undefined) throw new Error(`stack underflow at '${tok}'`);
      stack.push(OPS[tok](a, b));
    } else {
      const n = Number(tok);
      if (Number.isNaN(n)) throw new Error(`bad token '${tok}'`);
      stack.push(n);
    }
  }
  if (stack.length !== 1) throw new Error(`bad expression: ${expr}`);
  return stack[0];
}
