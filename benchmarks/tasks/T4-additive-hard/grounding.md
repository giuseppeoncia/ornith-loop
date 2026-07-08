Grounding:
- `evaluate(expr)` lives in `src/registry.mjs` and dispatches each RPN token through the
  `OPS` map (token string -> binary function).
- The operator implementations are plain binary functions in `src/ops.mjs` (e.g. `add`, `mul`).
- Adding an operator requires TWO coordinated edits: implement the function in `src/ops.mjs`,
  AND register it under its token in the `OPS` map in `src/registry.mjs`. The token is the
  word used in the RPN string — here it is `pow`.
- `pow(a, b)` is `a ** b`. The test suite `test/calc.test.mjs` calls `evaluate("2 10 pow")`
  and expects `1024`, and `evaluate("5 0 pow")` and expects `1`.
- Run `node --test` (Node >= 24). Change only `src/ops.mjs` and `src/registry.mjs`; leave the
  test file and everything else exactly as it is.
