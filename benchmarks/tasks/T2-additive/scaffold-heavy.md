Do exactly these steps in order:
1. Read `src/mathx.mjs` to see the existing `add` and `sub` exports.
2. Append a new export after `sub`: `export function mul(a, b) { return a * b; }`.
3. Do not touch `add`, `sub`, or `test/mathx.test.mjs`.
4. Run `node --test` with the Bash tool.
5. Confirm all three test groups (add, sub, mul) pass.
