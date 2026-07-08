Grounding:
- The module is `src/mathx.mjs`; it uses ES-module **named exports** (`export function add…`).
- The failing test is `test/mathx.test.mjs`, which imports `{ add, sub, mul }` from
  `../src/mathx.mjs` and asserts `mul(2,3)===6`, `mul(-2,4)===-8`, `mul(7,0)===0`.
- Run the suite with `node --test` from the repository root (Node >= 24).
- `mul` must be a top-level named export with the same style as `add`/`sub`; ordinary
  integer multiplication. Add it to `src/mathx.mjs` — do not modify the existing functions
  or the test file.
