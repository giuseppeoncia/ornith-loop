import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { invokePi } from "../src/invoke.js";

const fakePi = fileURLToPath(new URL("./fixtures/fake-pi.js", import.meta.url));
const base = { prompt: "hi", model: "m", provider: "ollama", thinking: "off", label: "t", timeoutSec: 30, piBin: fakePi };

test("invokePi builds the expected argv and captures stdout", async () => {
  const r = await invokePi({ ...base, env: { FAKE_PI_MODE: "success" } });
  assert.deepEqual(r.argv, ["--print", "--provider", "ollama", "--model", "m", "--thinking", "off", "--mode", "json", "--name", "t", "hi"]);
  assert.equal(r.timedOut, false);
  assert.equal(r.exitCode, 0);
  assert.match(r.stdout, /agent_end/);
});

test("invokePi enforces the timeout on a hanging pi", async () => {
  const r = await invokePi({ ...base, timeoutSec: 1, env: { FAKE_PI_MODE: "hang" } });
  assert.equal(r.timedOut, true);
  assert.notEqual(r.signal, null);
});

test("invokePi surfaces a nonzero exit without throwing", async () => {
  const r = await invokePi({ ...base, env: { FAKE_PI_MODE: "crash" } });
  assert.equal(r.exitCode, 2);
  assert.match(r.stderr, /boom/);
});
