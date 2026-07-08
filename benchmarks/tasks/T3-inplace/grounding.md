Grounding:
- The function is `greet(name)` in `src/greet.mjs`; it currently returns
  `"Hello, " + name + "!"` and must instead return `"Hola, " + name + "!"` —
  i.e. only the word `Hello` becomes `Hola`.
- The test `test/greet.test.mjs` asserts `greet("Ada") === "Hola, Ada!"` and also that the
  other export, `shout`, is unchanged. Run with `node --test` (Node >= 24).
- Change only the greeting string inside `greet`. Do not alter spacing, punctuation,
  casing, or any other line — the `shout` function and everything else must stay byte-exact.
