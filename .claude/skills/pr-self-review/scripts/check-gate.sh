#!/usr/bin/env bash
# Entry point for the pre-push hook (.githooks/pre-push).
# Fast path: if the current diff's hash matches the cached verdict, decide
# without calling claude at all. Otherwise, run a full /pr-self-review pass
# headlessly and act on its result. See gate.md for the contract this
# implements (cache format, marker string, skip condition).
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(git rev-parse --show-toplevel)"
cache_file="$repo_root/.git/pr-self-review-cache.json"
report_file="$repo_root/.git/pr-self-review-last-report.md"

hash_output="$("$script_dir/diff-hash.sh")"

if [ "$hash_output" = "ON_BASE" ]; then
  exit 0
fi

if [ "$hash_output" = "NO_BASE" ]; then
  echo "pr-self-review: no base branch (origin/main or main) found, skipping check."
  exit 0
fi

diff_hash="$hash_output"

if [ -f "$cache_file" ] && command -v jq >/dev/null 2>&1; then
  cached_hash="$(jq -r '.diffHash // empty' "$cache_file" 2>/dev/null || true)"
  cached_verdict="$(jq -r '.verdict // empty' "$cache_file" 2>/dev/null || true)"
  cached_critical="$(jq -r '.criticalCount // 0' "$cache_file" 2>/dev/null || echo 0)"

  if [ "$cached_hash" = "sha256:$diff_hash" ] && [ -n "$cached_verdict" ]; then
    if [ "$cached_verdict" = "PASS" ]; then
      echo "pr-self-review: cached PASS for this diff (no changes since last review), skipping re-review."
      exit 0
    else
      echo "pr-self-review: cached BLOCK for this diff — $cached_critical critical finding(s)."
      [ -f "$report_file" ] && cat "$report_file"
      exit 1
    fi
  fi
fi

echo "pr-self-review: no cached result for this diff, running full review..."
output="$(claude -p "/pr-self-review" \
  --allowedTools "Read,Grep,Glob,Bash(git diff:*),Bash(git status:*),Bash(git merge-base:*),Bash(git rev-parse:*)" \
  2>&1)" || true
echo "$output"

if echo "$output" | grep -q "PR_SELF_REVIEW: BLOCK"; then
  echo "pr-self-review: push blocked. Full report: $report_file"
  exit 1
fi

if echo "$output" | grep -q "PR_SELF_REVIEW: PASS"; then
  exit 0
fi

echo "pr-self-review: could not determine a verdict (no PR_SELF_REVIEW marker in output) — allowing push, but check output above."
exit 0
