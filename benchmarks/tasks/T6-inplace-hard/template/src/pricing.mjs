// Apply a fixed 20% tax to an amount.
export function withTax(amount) {
  return amount + amount * 0.2;
}

// Round to whole cents. Unrelated helper — must stay byte-exact.
export function roundCents(x) {
  return Math.round(x * 100) / 100;
}
