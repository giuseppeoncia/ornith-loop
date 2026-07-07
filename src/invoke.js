import { spawn } from "node:child_process";

export function invokePi(opts) {
  const { prompt, model, provider, thinking, label, timeoutSec, piBin, workdir, env, now = Date.now } = opts;
  const argv = ["--print", "--provider", provider, "--model", model, "--thinking", thinking, "--mode", "json", "--name", label, prompt];

  return new Promise((resolve) => {
    const start = now();
    let timedOut = false;
    let child;
    try {
      child = spawn(piBin, argv, {
        cwd: workdir || process.cwd(),
        env: { ...process.env, ...(env || {}) },
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      resolve({ stdout: "", stderr: String(err?.message ?? err), exitCode: null, signal: null, timedOut: false, durationMs: now() - start, argv });
      return;
    }

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));

    const killTimer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2000).unref();
    }, timeoutSec * 1000);

    child.on("error", (err) => {
      clearTimeout(killTimer);
      resolve({ stdout, stderr: stderr || String(err?.message ?? err), exitCode: null, signal: null, timedOut, durationMs: now() - start, argv });
    });
    child.on("close", (code, signal) => {
      clearTimeout(killTimer);
      resolve({ stdout, stderr, exitCode: code, signal, timedOut, durationMs: now() - start, argv });
    });
  });
}
