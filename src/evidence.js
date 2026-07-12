import { spawnSync } from "node:child_process";

// Gather the MECHANICAL evidence a verifier adjudicates: test output, the diff,
// and the changed-file list — all ground truth, never the model's prose. Stages
// the index (git add -A) so the diff includes untracked files; consequently
// callers/oracles must read the change set from `git status --porcelain`, not an
// unstaged `git diff`.
export function gatherEvidence(workdir, testCmdArgv) {
  const argv = Array.isArray(testCmdArgv) && testCmdArgv.length ? testCmdArgv : ["node", "--test"];
  const t = spawnSync(argv[0], argv.slice(1), { cwd: workdir, encoding: "utf8" });
  const testOutput = ((t.stdout || "") + (t.stderr || "")).slice(0, 4000);
  const git = (args) => spawnSync("git", args, { cwd: workdir, encoding: "utf8" });
  git(["add", "-A"]);
  const diff = (git(["diff", "--cached"]).stdout || "").slice(0, 8000);
  const status = git(["status", "--porcelain"]).stdout || "";
  const changedFiles = status.split("\n").map((l) => l.slice(3).trim()).filter(Boolean);
  return { testCmd: argv, testOutput, testExitCode: t.status, diff, changedFiles };
}
