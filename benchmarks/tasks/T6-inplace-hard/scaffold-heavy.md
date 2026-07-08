Do exactly these steps in order:
1. Read `src/pricing.mjs`. Change `withTax`'s signature from `(amount)` to `(amount, rate)`.
2. In the same function, change the body from `return amount + amount * 0.2;` to
   `return amount + amount * rate;`.
3. Do not touch the `roundCents` function — leave it exactly as it is.
4. Read `src/checkout.mjs`. In `lineTotal`, change `withTax(price)` to `withTax(price, 0.1)`.
5. In `cartTotal`, change `withTax(p)` to `withTax(p, 0.1)`.
6. Run `node --test` with the Bash tool and confirm all tests pass.
