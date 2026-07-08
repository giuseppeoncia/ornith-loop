Grounding:
- `withTax` in `src/pricing.mjs` currently hardcodes the rate: `return amount + amount * 0.2;`.
  Its signature must become `withTax(amount, rate)` and its body `return amount + amount * rate;`.
- `withTax` is called in two places in `src/checkout.mjs` — inside `lineTotal` and inside
  `cartTotal`. Both call sites must now pass the rate `0.1`.
- The test `test/checkout.test.mjs` asserts `withTax(100, 0.2) === 120`, `withTax(50, 0) === 50`,
  and `lineTotal(100, 2) === 220` (i.e. callers pass `0.1`).
- The other export in `src/pricing.mjs`, `roundCents`, must stay byte-exact — do not alter its
  spacing, punctuation, or casing. Change nothing outside `withTax` and its two call sites.
- Run `node --test` (Node >= 24). Change only `src/pricing.mjs` and `src/checkout.mjs`.
