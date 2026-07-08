This repository's `withTax` function hardcodes a 20% tax rate. The test suite now expects
`withTax` to take the rate as an explicit second argument, and expects its callers to pass
a 10% rate — so the tests currently fail. Refactor `withTax` to take the rate as a
parameter and update its call sites accordingly, so the tests pass. Leave everything else
exactly as it is.
