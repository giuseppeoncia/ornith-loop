#!/usr/bin/env bash
# Install the ornith-loop skill into ~/.claude/skills via symlink (copy fallback).
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
src="$repo_root/skill/ornith-loop"
dest_dir="${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}"
dest="$dest_dir/ornith-loop"

[ -d "$src" ] || { echo "error: $src not found" >&2; exit 1; }
mkdir -p "$dest_dir"
rm -rf "$dest"
if ln -s "$src" "$dest" 2>/dev/null; then
  echo "symlinked $dest -> $src"
else
  cp -R "$src" "$dest"
  echo "copied $src -> $dest"
fi
