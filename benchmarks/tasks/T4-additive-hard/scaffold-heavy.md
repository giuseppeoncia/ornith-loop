Do exactly these steps in order:
1. Read `src/ops.mjs`. Add a new line `export function pow(a, b) { return a ** b; }`.
2. Read `src/registry.mjs`. Add `pow` to the existing import from `./ops.mjs`.
3. In the same file, add `pow,` as an entry inside the `OPS` object (alongside `add`, `sub`, …).
4. Do not change `evaluate` or any existing operator.
5. Run `node --test` with the Bash tool and confirm all tests pass.
