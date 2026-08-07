# Routing — which skills apply to which files

Static skill → path mapping used by `SKILL.md` step 3. Keep this table in
sync with `.claude/skills/*/` — if a folder exists there with no row below
(and it isn't in the excluded list), `SKILL.md` must warn about it instead of
silently skipping it.

## Skill → glob mapping

| Skill | Applies when diff touches |
|---|---|
| `onion-architecture` | `server/**`, `reviewer-core/**` |
| `fastify-best-practices` | `server/**`, `reviewer-core/**` |
| `drizzle-orm-patterns` | `server/src/db/**` |
| `postgresql-table-design` | `server/src/db/**` |
| `next-best-practices` | `client/**` |
| `react-best-practices` | `client/**` |
| `react-frontend-architecture` | `client/**` |
| `react-testing-library` | `client/**/*.test.ts`, `client/**/*.test.tsx` |
| `zod` | any changed `*.ts`/`*.tsx` |
| `typescript-expert` | any changed `*.ts`/`*.tsx` |
| `security` | any changed `*.ts`/`*.tsx` |

`zod`, `typescript-expert`, `security` are cross-cutting per their own
descriptions in `.claude/skills/README.md` — they apply repo-wide, not to one
package.

## Excluded skills (not diff-critique skills)

- `engineering-insights` — writes retrospective notes, doesn't critique a diff
- `mermaid-diagram` — diagram authoring reference, not a review lens

Do not spawn a review sub-agent for these even if the diff touches related
files.

## Excluded paths (noise, never sent to a skill sub-agent)

- Lockfiles: `**/package-lock.json`, `**/pnpm-lock.yaml`, `**/yarn.lock`
- Anything under `server/src/db/migrations/` (see do-not-touch rule below —
  flagged separately, content not critiqued)
- Binary/generated diffs (no meaningful text hunks — e.g. images, `.svg`
  under a skill's own reference folder, lockfile-style generated output)

## File status filter

Use `git diff --name-status <merge-base>` to classify each changed path:

- `A` (added), `M` (modified) → eligible for skill review (subject to the
  excluded-paths rule above)
- `D` (deleted) → never sent to a skill sub-agent, nothing to critique
- `R` (renamed) → treat the new path as `M`

## Do-not-touch rule (from root `CLAUDE.md`)

If the diff touches `server/src/vendor/shared/` or
`server/src/db/migrations/`:

- Always add a CRITICAL finding: "Diff touches a do-not-touch path
  (`<path>`) per CLAUDE.md — verify this was coordinated before merging."
- Do **not** send the content of these files to any skill sub-agent for
  line-level critique — only the fact that they were touched matters here.

## Drift check

Before matching, `SKILL.md` lists `.claude/skills/*/` and diffs it against
the skill names in this file's mapping table plus the excluded-skills list
above. Any folder missing from both → print a warning in the report ("skill
`<name>` has no routing entry in routing.md — add one") but continue the
review with the skills that *are* mapped.
