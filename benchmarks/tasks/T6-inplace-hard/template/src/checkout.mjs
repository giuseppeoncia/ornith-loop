import { withTax, roundCents } from "./pricing.mjs";

export function lineTotal(price, qty) {
  return roundCents(withTax(price) * qty);
}

export function cartTotal(prices) {
  return roundCents(prices.reduce((sum, p) => sum + withTax(p), 0));
}
