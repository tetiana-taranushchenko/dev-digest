#!/usr/bin/env bash
# Stop hook: nudge Claude to run the engineering-insights skill when this
# session has non-trivial uncommitted work in a package it hasn't been
# reminded about yet. Fires at most once per session (marker in /tmp).
set -euo pipefail

payload="$(cat)"
sid="$(printf '%s' "$payload" | jq -r '.session_id // "nosid"' 2>/dev/null || echo nosid)"
marker="/tmp/claude-insights-nudge-${sid}"

if [ -f "$marker" ]; then
  echo '{"continue": true}'
  exit 0
fi

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$repo_root" ]; then
  echo '{"continue": true}'
  exit 0
fi
cd "$repo_root"

changed="$(git status --porcelain -- server client reviewer-core e2e 2>/dev/null | grep -v 'INSIGHTS\.md' | wc -l | tr -d ' ')"

if [ "$changed" -gt 0 ]; then
  touch "$marker"
  cat <<'EOF'
{"decision":"block","reason":"This session has uncommitted changes in server/client/reviewer-core/e2e. Before finishing, run the engineering-insights skill (or explicitly decide nothing new qualifies) so any non-obvious finding gets captured in that package's INSIGHTS.md."}
EOF
else
  echo '{"continue": true}'
fi
