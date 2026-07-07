import { execFileSync } from "node:child_process";

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}

export function snapshot(workdir) {
  try {
    const inside = git(["rev-parse", "--is-inside-work-tree"], workdir).trim();
    if (inside !== "true") return { isRepo: false, head: null, dirtyFiles: [] };
  } catch {
    return { isRepo: false, head: null, dirtyFiles: [] };
  }
  let head = null;
  try {
    head = git(["rev-parse", "HEAD"], workdir).trim();
  } catch {
    head = null; // repo with no commits yet
  }
  const porcelain = git(["status", "--porcelain"], workdir);
  const dirtyFiles = porcelain.split("\n").map((l) => l.trim()).filter(Boolean).sort();
  return { isRepo: true, head, dirtyFiles };
}

export function diffSnapshots(before, after) {
  const headChanged = before.head !== after.head;
  const dirtyChanged = JSON.stringify(before.dirtyFiles) !== JSON.stringify(after.dirtyFiles);
  return { changed: headChanged || dirtyChanged };
}
