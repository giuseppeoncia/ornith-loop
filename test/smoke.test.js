import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("package.json is ESM with an orn bin and a test script", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.type, "module");
  assert.equal(pkg.bin.orn, "bin/orn.js");
  assert.ok(pkg.scripts.test.includes("node --test"));
  assert.equal(pkg.dependencies ?? undefined, undefined, "no runtime deps");
});
