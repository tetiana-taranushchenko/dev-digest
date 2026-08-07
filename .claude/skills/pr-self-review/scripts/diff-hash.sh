#!/usr/bin/env bash
# Prints a stable sha256 hash of the current diff against the base branch.
# Used by both SKILL.md (fast-path cache check) and check-gate.sh, so the
# hash must be computed identically in both places — change this file, not
# the logic inline elsewhere.
#
# Special outputs (instead of a hash):
#   NO_BASE  - neither origin/main nor a local main branch could be resolved
#   ON_BASE  - current branch IS the base branch (nothing to review)
set -euo pipefail

base="origin/main"
if ! git rev-parse --verify origin/main >/dev/null 2>&1; then
  base="main"
fi

if ! git rev-parse --verify "$base" >/dev/null 2>&1; then
  echo "NO_BASE"
  exit 0
fi

current_branch="$(git rev-parse --abbrev-ref HEAD)"

if [ "$current_branch" = "main" ] || [ "$current_branch" = "master" ]; then
  echo "ON_BASE"
  exit 0
fi

merge_base="$(git merge-base "$base" HEAD)"
git diff "$merge_base" | shasum -a 256 | awk '{print $1}'
