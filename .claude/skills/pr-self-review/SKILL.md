---
name: pr-self-review
description: Runs every applicable project skill (onion-architecture, react-best-practices, security, etc.) against the current branch's diff before a PR is opened, matching UI skills to changed UI files and backend/architecture skills to changed backend files. Blocks the push locally if any CRITICAL finding is found. Use when the user runs /pr-self-review manually, or automatically via the .githooks/pre-push hook before every `git push`. Does not cover reviewing an already-open GitHub PR (see the built-in code-review skill) — this runs before a PR exists, against local branch changes only.
version: 0.1.0
---

# PR Self Review

Checks local branch changes against `main` through the lens of every project
skill relevant to what changed, before a PR is opened. Two entry points:
manual (`/pr-self-review`) and automatic (`.githooks/pre-push`, via
[scripts/check-gate.sh](scripts/check-gate.sh)).

For the skill → file-path matching table, see [routing.md](routing.md). For
the severity scale, suppression rule, cache format, and the exact blocking
contract, see [gate.md](gate.md). For sample PASS/BLOCK reports, see
[examples.md](examples.md).

**Scope boundary** — this skill does not duplicate:
- the built-in `code-review` skill — that reviews an already-open GitHub PR
  (via `gh pr comment`, posts to GitHub); this skill runs *before* a PR
  exists, purely against local git state, and never calls `gh`.
- any individual skill's own rules — this skill orchestrates and aggregates,
  it doesn't re-implement `security`'s OWASP checklist or
  `onion-architecture`'s layering rules itself.

## Process

**Step 0 — Skip check.** Run [scripts/diff-hash.sh](scripts/diff-hash.sh). If
it prints `ON_BASE`, the current branch *is* the base branch (`main`/`master`)
— there's no PR being opened here. Report `PR_SELF_REVIEW: PASS` immediately,
no further steps. If it prints `NO_BASE`, no base branch could be resolved
(no `origin/main` or local `main`) — report `PR_SELF_REVIEW: PASS` with a
note that the check was skipped, no further steps.

**Step 1 — Diff.** Resolve the base branch the same way
`scripts/diff-hash.sh` does (`origin/main`, falling back to local `main`).
Run:
- `git diff <merge-base>` — full diff (covers committed branch commits AND
  uncommitted working-tree changes in one call)
- `git diff --name-status <merge-base>` — changed files with A/M/D/R status,
  needed for the routing and file-status filters in
  [routing.md](routing.md)

**Step 2 — Cache fast path.** The hash from step 0's `diff-hash.sh` call is
the cache key. Read `.git/pr-self-review-cache.json` (see
[gate.md](gate.md) for its shape). If it has an entry for this exact hash,
skip straight to reporting that cached verdict — do not re-run any skill
sub-agents.

**Step 3 — Skill catalog + routing.** Read the frontmatter (`name`,
`description`) of every `.claude/skills/*/SKILL.md`. Cross-check the folder
list against [routing.md](routing.md)'s mapping table and excluded-skills
list; warn (don't fail) about any skill folder missing from both. Using
`routing.md`'s glob table and file-status filter, build the list of
(skill, files) pairs that actually apply to this diff's `A`/`M`/`R` files.

**Step 4 — Review.** For each (skill, files) pair from step 3, spawn one
sub-agent in parallel (mirrors the built-in `code-review` skill's
multi-agent pattern). Brief each sub-agent with:
- the skill name (load it via the `Skill` tool)
- the relevant changed files and their diff hunks only (not the whole diff)
- the severity criteria from [gate.md](gate.md)
- instruction to return findings as `{skill, file, line, severity, summary,
  failure_scenario}` — same shape as `ReportFindings`, for consistency with
  the rest of this repo's review tooling

If a sub-agent errors or times out, do not treat that as a finding — record
the skill name in the report's "Not verified" section per `gate.md`'s
graceful-degradation rule, and move on.

Separately (not delegated to a sub-agent): if the diff touches
`server/src/vendor/shared/` or `server/src/db/migrations/`, add the
CRITICAL do-not-touch finding directly, per `routing.md`.

**Step 5 — Suppression filter.** For every CRITICAL/HIGH finding, check
whether the diff has a `pr-self-review-ignore: <reason>` comment within 2
lines of that finding's line (per `gate.md`). If so, move it to a
"Suppressed" bucket instead of counting it toward the verdict.

**Step 6 — Aggregate.** Build one report grouped by skill/domain, with four
sections: findings (CRITICAL first, then HIGH, then MEDIUM), Suppressed, Not
verified, and a one-line summary of files/skills covered.

**Step 7 — Verdict, cache, report file.**
- `criticalCount` = count of non-suppressed CRITICAL findings.
- Write `.git/pr-self-review-cache.json` with this diff's hash, verdict
  (`PASS` if `criticalCount == 0` else `BLOCK`), `criticalCount`,
  `suppressedCount`, `unverifiedSkills`, timestamp, and the full findings
  list — schema in [gate.md](gate.md).
- Write the full human-readable report to
  `.git/pr-self-review-last-report.md`.
- Print the report, then end the output with exactly one final line:
  `PR_SELF_REVIEW: PASS` or `PR_SELF_REVIEW: BLOCK` — this exact string is
  what `scripts/check-gate.sh` greps for on a cache miss. Don't rephrase it.

## What this skill does NOT do

- Does not run `git push`, `git commit`, or `gh pr create` itself — it only
  runs read-only inspection commands (`git diff`, `git status`, `git
  merge-base`, `git rev-parse`). Opening the PR remains a manual action by
  the user.
- Does not attempt to configure GitHub branch protection or post a commit
  status check — blocking is local only (the `pre-push` hook refusing to
  push), per the scope agreed for this skill.

## Additional Resources

### Reference Files

- **[routing.md](routing.md)** — skill → path mapping, excluded skills/paths, do-not-touch rule, drift check
- **[gate.md](gate.md)** — base branch resolution, skip condition, severity levels, suppression, graceful degradation, cache/report/marker formats
- **[examples.md](examples.md)** — sample PASS and BLOCK reports
- **[scripts/diff-hash.sh](scripts/diff-hash.sh)** — computes the diff hash used as the cache key
- **[scripts/check-gate.sh](scripts/check-gate.sh)** — pre-push hook entry point (cache check → headless review → exit code)
