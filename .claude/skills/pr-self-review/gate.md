# Gate — what blocks a push, and how that's communicated

Contract shared between `SKILL.md` (decides the verdict) and
`scripts/check-gate.sh` (enforces it in the `pre-push` hook). Both must agree
on base-branch resolution, the cache format, and the final marker — if you
change one, update the other.

## Base branch resolution

Prefer `origin/main` over a local `main` branch, since local `main` can be
stale (not pulled recently) and produce a wrong merge-base:

```
base=origin/main
git rev-parse --verify origin/main >/dev/null 2>&1 || base=main
merge_base=$(git merge-base "$base" HEAD)
```

If neither `origin/main` nor local `main` resolves, treat it as "no base
branch" and skip (same as the skip condition below) rather than failing —
this is a course-starter repo and not every clone is guaranteed a fetched
`origin/main`.

## Skip condition

If the current branch **is** the base branch (`main` or `master`), there is
no PR being opened — skip entirely. `SKILL.md` reports PASS with no
diagnostics; `check-gate.sh` exits 0 immediately without computing a hash or
calling `claude -p`.

## Severity levels

Reuse the CRITICAL/HIGH/MEDIUM scale already established across this repo's
skills (`onion-architecture`, `react-frontend-architecture`,
`react-best-practices`). Skills whose own SKILL.md doesn't define this scale
(`security`, `zod`, `typescript-expert`, `fastify-best-practices`,
`drizzle-orm-patterns`, `postgresql-table-design`, `next-best-practices`,
`react-testing-library`) still get findings classified against these
criteria by the reviewing sub-agent:

- **CRITICAL** — would break production, a security/data-integrity
  guarantee, or a hard architectural boundary; blocks the merge
- **HIGH** — should be fixed before merge but doesn't block it
- **MEDIUM** — advisory, doesn't block

Only CRITICAL findings affect the verdict. HIGH/MEDIUM are always reported
but never block.

## Suppression

A finding is excluded from the verdict (moved to the report's "Suppressed"
section instead of counting toward `criticalCount`) when the diff contains a
comment matching `pr-self-review-ignore:` within 2 lines of the finding's
line:

```
// pr-self-review-ignore: false positive, guarded by middleware X
```

Suppressed findings are still listed in the report (with the file:line, the
original severity, and the stated reason) so the suppression itself is
visible in code review and `git blame` — this is a targeted override of one
finding, not a way to silence the whole gate.

## Graceful degradation

If a skill's review sub-agent errors or times out, that is **not** treated
as a CRITICAL finding and does not block the push on its own. Record it in
the report's "Not verified" section with the failure reason. The verdict is
determined only by CRITICAL findings actually returned by sub-agents that
completed successfully.

## Cache

File: `.git/pr-self-review-cache.json` (inside `.git/` — never committed,
local to this clone). Written by `SKILL.md` at the end of a full run; read
by both `SKILL.md` (fast path) and `scripts/check-gate.sh`.

```json
{
  "diffHash": "sha256:...",
  "verdict": "PASS",
  "criticalCount": 0,
  "suppressedCount": 0,
  "unverifiedSkills": [],
  "timestamp": "2026-08-08T12:00:00Z",
  "findings": []
}
```

- `verdict` is `"PASS"` or `"BLOCK"`.
- `findings` entries: `{ "skill": "security", "file": "...", "line": 42,
  "severity": "CRITICAL", "summary": "...", "suppressed": false }`.
- A cache entry is only valid for the exact `diffHash` it was written for —
  any diff change invalidates it (see `scripts/diff-hash.sh`).

## Report file

Full human-readable report text is also written to
`.git/pr-self-review-last-report.md` (same directory, same non-committed
guarantee) every time a full review runs — so it can be reopened without
re-running the review.

## Final marker

The last line of `SKILL.md`'s printed output must be exactly one of:

```
PR_SELF_REVIEW: PASS
PR_SELF_REVIEW: BLOCK
```

`scripts/check-gate.sh` greps for this when it has to invoke `claude -p`
directly (cache-miss path) — treat this literal string as a stable contract,
don't rephrase it.
