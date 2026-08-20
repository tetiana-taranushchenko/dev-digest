# Development Plan: Blast Radius — "Prior PRs touching these files"

## Context

The Blast Radius feature from `docs/plans/blast-radius.md` shipped: `GET
/pulls/:id/blast` (`server/src/modules/blast/`), the `BlastRadius` contract
(`*/src/vendor/shared/contracts/brief.ts:103-118`) and the `BLAST RADIUS` card
(`client/src/app/repos/[repoId]/pulls/[number]/_components/BlastRadiusPanel/`).
The reference screenshot on the course's L04 assignment page also shows a
collapsed row at the bottom of that card — **"Prior PRs touching these files"**
with a count badge — which the assignment's prose acceptance-criteria list never
spells out, so it was left out of the original plan. This plan adds it as a
purely additive, read-only side-feature: one Drizzle join over data that is
already imported (`pull_requests` + `pr_files`), one new contract field, one
collapsible client row. No new table, no migration, no new dependency, no LLM
call.

## Requirements

- REQ-1: `GET /pulls/:id/blast` gains one additive response field,
  `prior_prs`, defined identically in **both** vendored contract copies
  (`server/src/vendor/shared/contracts/brief.ts` and
  `client/src/vendor/shared/contracts/brief.ts` — mirrored, not auto-synced).
- REQ-2: `prior_prs` lists **other** pull requests in the same repo that touched
  at least one of the current PR's changed file paths — one entry per PR
  (deduped), newest-first by `pull_requests.updated_at` (`NULLS LAST`,
  tie-broken by `number` desc for determinism), capped at
  `MAX_PRIOR_PRS = 5`.
- REQ-3: **Zero** schema/migration/dependency changes. `pull_requests` and
  `pr_files` (`server/src/db/schema/pulls.ts:5-45`) already carry every column
  needed. If it turns out a schema change is required, stop and re-plan rather
  than hand-editing `server/src/db/migrations/` (`server/INSIGHTS.md:28-29`).
- REQ-4: The query lives in the **repository** layer. No Drizzle `db`/`schema`
  import may appear in `blast/routes.ts`, `blast/service.ts` or
  `blast/assemble.ts`.
- REQ-5: This is reference data, **not** part of the blast-radius graph. It must
  not be merged into `changed_symbols`/`downstream`, must not read the
  repo-intel index, and must never influence `state`, `reason`, `reason_text`,
  `truncated` or `index_status`. Zero prior PRs is a normal outcome (`[]`), not
  a `degraded`/`empty` signal — and the list is still produced when the index
  itself is `degraded`/`missing` or `REPO_INTEL_ENABLED` is off.
- REQ-6: No new LLM call anywhere on this path. The optional
  one-paragraph-summary path (`docs/plans/blast-radius.md`, "Optional
  one-paragraph LLM summary") is untouched.
- REQ-7: Client renders a row at the **bottom** of the BLAST RADIUS card:
  collapsed by default showing the label + a count badge, expanding on click to
  a list of `#number`, title and a compact relative age (`11d ago`, `2mo ago`).
  When the list is empty or absent, the row is **not rendered at all**.
- REQ-8: The query is scoped by **both** `workspace_id` and `repo_id`, so no PR
  title from another repo or workspace can ever appear in the list.

## Affected Modules & Contracts

- **server** — additive repository query in `modules/reviews/repository/`,
  additive passthrough in `modules/blast/` (`assemble.ts`, `service.ts`, new
  `constants.ts`).
- **client** — new `PriorPrsRow` subcomponent in `BlastRadiusPanel/_components/`,
  one formatter in the panel's co-located `helpers.ts`, two insertion points in
  `BlastRadiusPanel.tsx`, one i18n key.
- **reviewer-core** — untouched.
- **mcp-server** — untouched, deliberately. `BlastRadiusResponse` is declared
  with `.passthrough()` (`mcp-server/src/api/types.ts:193-203`) and
  `get-blast-radius.ts` projects an explicit field whitelist
  (`get-blast-radius.ts:68-79`), so a new server field is silently ignored. No
  task is needed; surfacing it there would be a separate feature.
- **e2e** — follow-up task only (see Phase 3), not for `implementer`.

### Contract changes in `@devdigest/shared` — YES, coordinated and explicit

Both copies are byte-identical today (`diff
server/src/vendor/shared/contracts/brief.ts
client/src/vendor/shared/contracts/brief.ts` → no output, verified this
session). Both packages' `CLAUDE.md` mark `vendor/shared/` do-not-touch
"without coordination" — **this plan is that coordination**; T1 is the only task
allowed to edit those two files, it must edit both identically, and no other
task may touch them.

Add `PriorPr` immediately after `DownstreamImpact` (`brief.ts:90-101`), and
`prior_prs` immediately after `downstream` on `BlastRadius`:

```ts
/**
 * One other PR in the same repo that previously touched at least one of this
 * PR's changed files. Reference data only: never part of the blast-radius
 * graph (`changed_symbols`/`downstream`) and never an input to `state`.
 */
export const PriorPr = z.object({
  number: z.number().int(),
  title: z.string(),
  /** ISO timestamp of that PR's last update. `null` when the imported row has
   *  no `updated_at` — the column is nullable (`db/schema/pulls.ts:28`). */
  updated_at: z.string().nullish(),
});
export type PriorPr = z.infer<typeof PriorPr>;

// …inside BlastRadius, right after `downstream`:
  /** Other PRs in this repo that touched any of the current PR's changed
   *  files, newest-first, capped at `MAX_PRIOR_PRS`. `[]` = the query ran and
   *  found none (a normal outcome, NOT a degraded signal); absent/`null` = a
   *  server that doesn't compute this. Never influences `state`. */
  prior_prs: z.array(PriorPr).nullish(),
```

Two deliberate decisions, both load-bearing:

1. **`.nullish()`, not required.** Per `client/INSIGHTS.md:21-22`, a required
   field forces every existing producer and fixture to set it — which would make
   T1 fail its own `typecheck` acceptance until T3/T4 land, breaking the DAG.
   `.nullish()` keeps T1 independently verifiable, and both `null` and `[]`
   render identically (row hidden, REQ-7), so nothing is lost.
2. **Do not reuse `PrHistoryItem`** (`brief.ts:139-147`). It requires
   `merged_at` (wrong — prior PRs here may be open, and we order by
   `updated_at`), `files_overlap` and `notes` (which we would have to fabricate).
   `PrHistoryItem` belongs to the separate PR-History section of `PrBrief`;
   conflating them would couple two unrelated features.

## Architecture Notes

Onion layers touched (`.claude/skills/onion-architecture/`):

- **Presentation** — `blast/routes.ts` is **not modified**; the response type is
  already `BlastRadius` (`routes.ts:28`), so the new field flows through for
  free.
- **Application** — `blast/service.ts` adds one `container.reviewRepo` call;
  `blast/assemble.ts` gains a pure passthrough mapper. New `blast/constants.ts`
  holds `MAX_PRIOR_PRS`.
- **Infrastructure** — the Drizzle query goes in
  `server/src/modules/reviews/repository/pull.repo.ts`, exposed through
  `ReviewRepository`. **Reuse, not a new repository**: that file is already the
  home for every `pull_requests`/`pr_files` read, `BlastService` already holds a
  `ReviewRepository` (`blast/service.ts:50-54`, using `getPull`/`getPrFiles`),
  and `getPrCommits` there is the existing precedent for a *different* module
  (intent) reading PR data through it rather than importing Drizzle
  (`pull.repo.ts:33-36`). Adding a `blast/repository.ts` for one query would
  duplicate that surface for no gain.
- **Domain** — untouched. `reviewer-core` is not imported by `blast/`.

### Verified facts this plan depends on

- `pull_requests` has `id`, `workspaceId`, `repoId`, `number`, `title`,
  `updatedAt` (nullable, `schema/pulls.ts:28`), unique index
  `pr_repo_number_uq (repo_id, number)` (`pulls.ts:31`) and `pr_ws_idx
  (workspace_id)` (`pulls.ts:32`).
- `pr_files` has `prId` (FK) and `path` (`pulls.ts:36-45`) and **no index on
  either** — see Risks.
- `BlastService.get()` already resolves `pull.repoId` and `paths` before any
  repo-intel call (`blast/service.ts:58-62`) — the prior-PR query needs exactly
  those two, plus `workspaceId` (already a parameter) and `prId`.
- `blast/service.ts:64-77` deliberately skips the repo-intel facade entirely
  when the index is unusable or `repoIntelEnabled` is false, feeding
  `assembleBlastRadius` degraded stand-ins. The prior-PR read must sit
  **outside** that branch so it still runs in the degraded case (REQ-5).
- `assembleBlastRadius(input)` (`blast/assemble.ts:127-133`) is pure — no
  `Container`, no I/O — and its state machine is rule 5 in that file's doc
  block. The new field must be attached without entering that state machine.
- `assemble.ts` currently imports only `@devdigest/shared` and
  `../repo-intel/types.js` — i.e. contracts + another module's *types* file,
  never another module's `repository.ts`. T3 keeps that property by declaring
  the prior-PR input **structurally** (see T3 notes).
- Client: `SymbolRow.tsx:41-45` already documents when a collapse toggle uses
  local `useState` vs. a lifted `expanded`/`onToggle` pair — the prior-PRs row
  is the "narrow, local concern" case, so local state is correct.
- Client: `BlastRadiusPanel.tsx` has three render branches — loading
  (`:87-96`), `state === 'empty'` (`:100-109`), and the main branch
  (`:114-153`). REQ-5/REQ-7 require the row in the **empty** branch too.
- Client: the PR detail route is `/repos/${repoId}/pulls/${number}`
  (`pulls/_components/PRRow/PRRow.tsx:35`); `next/link` is already used
  elsewhere in the app (e.g. `settings/[section]/_components/SettingsView`).
- Client: `pulls/helpers.ts:12-24` has a `relativeTime` formatter, but it
  produces `"3h"` / `"2d"` with **no** month bucket and **no** `"ago"` suffix,
  and it feeds the PR-list UPDATED column. Changing it would change that
  column; T5 therefore adds a separate, co-located formatter (single consumer →
  co-location is correct per `client/INSIGHTS.md:11-12`, which only mandates
  `lib/format.ts` once a formatter has >1 consumer tree).

### Relevant Do-not-touch items

- `server/src/vendor/shared/` + `client/src/vendor/shared/` — T1 only, both
  copies, byte-identical (`server/CLAUDE.md`, `client/CLAUDE.md`).
- `server/src/db/migrations/` — untouched; no migration is needed (REQ-3).
- `client/src/vendor/ui/` — untouched; the row uses existing `Badge`/`Icon`
  primitives.

### Relevant INSIGHTS.md entries

- `client/INSIGHTS.md:21-22` — `.nullable()` is required-but-null; `.nullish()`
  is what makes a shared-contract field optional. Drives T1's field choice.
- `client/INSIGHTS.md:11-12` — formatters used by >1 component tree belong in
  `client/src/lib/format.ts`; single-consumer formatters stay co-located.
  Drives T5's placement.
- `client/INSIGHTS.md:33-34` — `.js`-suffixed relative imports inside
  `vendor/shared` need `extensionAlias` in `next.config.mjs` (already
  configured); T1 must keep the existing `.js` import style in `brief.ts`.
- `server/INSIGHTS.md:9-10` — the precedent for accepting a missing index at
  current data volume and recording it instead of adding one; the same
  reasoning applies to `pr_files` (see Risks).
- `server/INSIGHTS.md:25-26` — in Drizzle, `.select({ key: table })` selects the
  whole table. T2 selects **named columns** deliberately, so the payload can't
  accidentally grow to include `body`/`head_sha`.
- `server/INSIGHTS.md:28-29` — never hand-write migrations (relevant only if
  REQ-3 is ever revisited).

## Phases

### Phase 0: contract + repository + formatter (T1, T2 and T5 run in parallel)

All three own disjoint paths and have no dependency edges between them.

| Task ID | Module | Type | Owned paths | Depends-on | Skills to use | Acceptance |
|---|---|---|---|---|---|---|
| T1 | shared | contract | `server/src/vendor/shared/contracts/brief.ts`, `client/src/vendor/shared/contracts/brief.ts` | — | zod, typescript-expert | `diff server/src/vendor/shared/contracts/brief.ts client/src/vendor/shared/contracts/brief.ts` prints nothing; `cd server && pnpm typecheck` and `cd client && pnpm typecheck` both exit 0; `cd server && pnpm exec vitest run test/contracts.test.ts` green **without editing that test** (proves the field is genuinely optional) |
| T2 | server | backend | `server/src/modules/reviews/repository/pull.repo.ts`, `server/src/modules/reviews/repository.ts`, `server/test/blast-prior-prs.it.test.ts` | — | onion-architecture, drizzle-orm-patterns, typescript-expert | `cd server && pnpm exec vitest run test/blast-prior-prs.it.test.ts` green (Docker required) covering all 6 assertions listed below; `cd server && pnpm typecheck` exits 0 |
| T5 | client | ui | `client/src/app/repos/[repoId]/pulls/[number]/_components/BlastRadiusPanel/helpers.ts`, `.../BlastRadiusPanel/helpers.test.ts` | — | react-frontend-architecture, typescript-expert | `cd client && pnpm test && pnpm typecheck` green; `helpers.test.ts` pins `formatPriorPrAge` against a fixed `now` for all 7 buckets in the table below |

**T1 notes.** Add `PriorPr` and the `prior_prs` field exactly as written in
*Affected Modules & Contracts*, in both files, at the same positions. Touch
nothing else in `brief.ts` — not `DownstreamImpact`, not `PrHistoryItem`, not
`PrBrief`. Do not edit `server/test/contracts.test.ts`; if it fails, the field
was not declared optional.

**T2 notes.** Add to `pull.repo.ts`, next to `getPrCommits`:

```ts
/** One prior PR in the same repo that touched one of the current PR's files. */
export interface PriorPrRow {
  number: number;
  title: string;
  updatedAt: Date | null;
}

export async function getPriorPrsTouchingFiles(
  db: Db,
  params: {
    workspaceId: string;
    repoId: string;
    /** The current PR — always excluded from its own prior-PR list. */
    excludePrId: string;
    paths: string[];
    limit: number;
  },
): Promise<PriorPrRow[]>
```

Implementation constraints:

- **Early-return `[]` when `params.paths.length === 0`** — never build an
  `inArray(..., [])` query. This is a hard requirement, not an optimisation.
- Select **named columns only** (`number`, `title`, `updatedAt`), never
  `.select({ pr: t.pullRequests })` (`server/INSIGHTS.md:25-26`).
- `innerJoin(t.prFiles, eq(t.prFiles.prId, t.pullRequests.id))`, filtered by
  `and(eq(workspaceId), eq(repoId), ne(t.pullRequests.id, excludePrId),
  inArray(t.prFiles.path, params.paths))` — both `workspaceId` **and** `repoId`
  are required (REQ-8).
- `groupBy(t.pullRequests.id)` to dedupe the join fan-out (a prior PR touching
  three of the current PR's files must yield exactly one row). Postgres allows
  selecting the other columns because `id` is the PK.
- `orderBy(sql\`${t.pullRequests.updatedAt} desc nulls last\`,
  desc(t.pullRequests.number))` — plain `desc()` is `NULLS FIRST` in Postgres,
  which would float rows with no `updated_at` to the top. The `number`
  tie-break makes the output deterministic for tests.
- `.limit(params.limit)` — the cap is a **parameter**, exactly like
  `getPrCommits(db, prId, limit)` (`pull.repo.ts:37-48`); the constant itself
  lives in `blast/` (T4), not in the data-access layer.
- Expose it on `ReviewRepository` as a one-line delegate and re-export the
  `PriorPrRow` type from `repository.ts`, mirroring the existing
  `export type { UpsertIntentInput, IntentRow }` line (`repository.ts:24`).

`server/test/blast-prior-prs.it.test.ts` (suffix is mandatory — DB-backed) seeds
one workspace, two repos, and asserts:

1. A prior PR touching **two** of the current PR's paths appears **once**
   (dedupe).
2. A PR whose only file is outside the current PR's paths is **absent**.
3. The current PR itself is **absent**.
4. A PR in a **different repo** that touches the same path is **absent**
   (REQ-8).
5. With `limit: 2` and three matching PRs, exactly the two with the newest
   `updatedAt` are returned, in descending order; a matching PR with
   `updatedAt: null` sorts **last**, not first.
6. `paths: []` returns `[]`.

**T5 notes.** Add to the panel's co-located `helpers.ts`:

```ts
/**
 * Compact elapsed-time label for a prior-PR row ("11d ago", "2mo ago").
 * Deliberately NOT `pulls/helpers.ts:relativeTime` — that one is the PR-list
 * UPDATED column's formatter, has no month/year bucket and no "ago" suffix,
 * and changing it would change that column. `now` is injectable so the unit
 * test is deterministic.
 */
export function formatPriorPrAge(iso: string | null | undefined, now: number = Date.now()): string
```

Buckets, using **floor** (elapsed time, so 11.8 days reads `11d ago`, never
`12d ago`), months = 30 days, years = 365 days:

| Input | Output |
|---|---|
| `null` / `undefined` / unparseable | `—` |
| < 1 minute (incl. future timestamps → clamp at 0) | `now` |
| < 60 minutes | `{n}m ago` |
| < 24 hours | `{n}h ago` |
| < 30 days | `{n}d ago` |
| < 365 days | `{n}mo ago` |
| otherwise | `{n}y ago` |

Do not touch the existing exports in this file (`resolveCallerDestination`,
`reasonMessageKey`, `computeBlastStats`).

### Phase 1: server assembly + wiring

| Task ID | Module | Type | Owned paths | Depends-on | Skills to use | Acceptance |
|---|---|---|---|---|---|---|
| T3 | server | backend | `server/src/modules/blast/assemble.ts`, `server/test/blast-assemble.test.ts` | T1 | onion-architecture, typescript-expert, zod | `cd server && pnpm exec vitest run test/blast-assemble.test.ts && pnpm typecheck` green; the new cases prove `state`/`reason`/`truncated`/`index_status` are **byte-identical** with and without `priorPrs`, and that a `null` `updatedAt` maps to `updated_at: null` |
| T4 | server | backend | `server/src/modules/blast/service.ts`, `server/src/modules/blast/constants.ts`, `server/test/blast.it.test.ts` | T2, T3 | onion-architecture, fastify-best-practices, drizzle-orm-patterns | `cd server && pnpm exec vitest run test/blast.it.test.ts` green (Docker required) with the 3 new assertions below; `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts' && pnpm typecheck` green; `grep -rnE "db/schema\|drizzle-orm\|reviews/repository/" server/src/modules/blast/` returns no matches (REQ-4) |

**T3 notes.** Add to `assemble.ts`:

```ts
/**
 * Prior-PR input shape. Declared structurally rather than imported from
 * `reviews/repository.ts` so this pure assembler keeps its property of never
 * importing another module's data-access layer (today it imports only
 * `@devdigest/shared` and `repo-intel/types.js`). `PriorPrRow` from
 * `reviews/repository.ts` structurally satisfies it; `blast/service.ts`'s
 * typecheck is what pins the two together, and will fail loudly if either
 * side drifts.
 */
export interface PriorPrSource {
  number: number;
  title: string;
  updatedAt: Date | null;
}

/** Pure row → contract mapping. No filtering, no sorting — the repository
 *  already applied REQ-2's ordering and cap. */
export function toPriorPrs(rows: PriorPrSource[]): PriorPr[]
```

`assembleBlastRadius`'s input object gains `priorPrs: PriorPrSource[]`, and its
returned object gains `prior_prs: toPriorPrs(input.priorPrs)`. **Rule-order
constraint (REQ-5):** `priorPrs` must not be read by rules 1-6 of the existing
state machine. Compute `prior_prs` last, after `state`/`reason`/`truncated` are
already decided, and add a comment saying so. Extend the file's doc block with a
short "prior PRs are reference data, outside the state machine" paragraph.

New cases in `server/test/blast-assemble.test.ts` (keep every existing case):

1. Take an existing `ok` fixture and an existing `degraded` fixture; run each
   twice — once with `priorPrs: []`, once with two rows — and assert
   `state`, `reason`, `reason_text`, `truncated`, `index_status`,
   `changed_symbols` and `downstream` are deep-equal across the pair (REQ-5).
2. `toPriorPrs` maps `updatedAt: new Date(...)` → the matching ISO string and
   `updatedAt: null` → `updated_at: null`, preserving input order.
3. `priorPrs: []` → `prior_prs: []` (never `null`, never omitted) — so `[]` is
   unambiguously "computed, found none".

**T4 notes.** New `server/src/modules/blast/constants.ts`:

```ts
/** Read-time cap on the "Prior PRs touching these files" reference list
 *  (REQ-2). Lives in `blast/` because it is this feature's product decision,
 *  and is passed as a parameter into the repository — the same shape as
 *  `getPrCommits(prId, limit)` — so the data-access layer stays policy-free. */
export const MAX_PRIOR_PRS = 5;
```

`BlastService.get()` changes (`service.ts:57-80`), in this order:

- After `paths` is computed (`service.ts:62`) and **before / independent of**
  the `indexUsable` branch, call
  `this.repo.getPriorPrsTouchingFiles({ workspaceId, repoId: pull.repoId,
  excludePrId: prId, paths, limit: MAX_PRIOR_PRS })`. It may be awaited inside
  the same `Promise.all` as the repo-intel reads **only if** it is also awaited
  on the degraded branch — simplest correct form: `const priorPrs = await …`
  before the branch, or a `Promise.all([priorPrsPromise, …])` that spans both
  branches. It must **never** sit inside the `indexUsable ? … : …` ternary.
- Pass `priorPrs` through to `assembleBlastRadius({ …, priorPrs })`.
- Extend the class doc block: prior PRs come from `reviewRepo` (plain PR data),
  are unaffected by index health, and add no LLM call.

New assertions appended to `server/test/blast.it.test.ts` (reuse its existing
`makeApp`/seeding helpers; do not modify existing assertions):

1. **Degraded repo, real prior PR.** Un-indexed repo (the existing "assertion 5"
   fixture style) + a second PR in that repo sharing a changed path → response
   has `state: 'degraded'` and `index_status: 'missing'` **unchanged**, and
   `prior_prs` contains that PR's `number`/`title` (REQ-5: DB data survives a
   dead index).
2. **Healthy repo, no overlap.** The existing `ok` fixture, where no other PR
   touches those paths → `prior_prs` is `[]` **and** `state` is still `'ok'`
   (an empty list is not an `empty`/`degraded` signal).
3. **No LLM.** In at least one of the above, assert
   `llm.calls.length === 0` after the request (REQ-6), using the
   `MockLLMProvider` the file already wires in.

### Phase 2: client UI

| Task ID | Module | Type | Owned paths | Depends-on | Skills to use | Acceptance |
|---|---|---|---|---|---|---|
| T6 | client | ui | `client/src/app/repos/[repoId]/pulls/[number]/_components/BlastRadiusPanel/_components/PriorPrsRow.tsx`, `.../BlastRadiusPanel/BlastRadiusPanel.tsx`, `.../BlastRadiusPanel/styles.ts`, `.../BlastRadiusPanel/BlastRadiusPanel.test.tsx`, `client/messages/en/blast.json` | T1, T5 | react-frontend-architecture, react-best-practices, react-testing-library, next-best-practices | `cd client && pnpm test && pnpm typecheck` green with the 4 new `BlastRadiusPanel.test.tsx` cases below |

T6 runs in parallel with T3/T4 — disjoint paths, and it depends only on the
contract (T1) and the formatter (T5).

**T6 notes.**

`_components/PriorPrsRow.tsx`:

```tsx
export function PriorPrsRow({
  priorPrs,
  repoId,
}: {
  priorPrs: PriorPr[] | null | undefined;
  repoId: string;
})
```

- `"use client"` (the file it lives beside already is; the panel is a client
  tree). Local `useState(false)` for `expanded` — this is the "narrow, local
  concern" case the sibling `SymbolRow.tsx:41-45` documents, so do **not** lift
  it into `BlastRadiusPanel`'s `expandedSymbols` map.
- **Empty state (REQ-7): `if (!priorPrs || priorPrs.length === 0) return null;`**
  Rationale, decided rather than assumed: the reference screenshot only shows
  the populated case (count `3`), and every other optional section in this card
  already hides rather than shows a zero — `SymbolRow.tsx:84` and `:104` gate
  the endpoint/cron badge rows on `length > 0`, and the panel itself swaps to
  `EmptyState` rather than rendering empty lists. A permanently visible
  "Prior PRs 0" row would be the surprising choice here, and it would also make
  a `null` (feature-absent) response indistinguishable from a real zero.
- Header: a `<button type="button" aria-expanded={expanded} onClick={…}>`
  containing `<Icon.ChevronRight size={14} style={s.chevron(expanded)} />` (the
  existing rotating-chevron style helper), `{t("priorPrs.title")}`, and
  `<Badge>{priorPrs.length}</Badge>`. Reuse `s.chevron` — do not add a second
  chevron style.
- Expanded body: one row per PR, keyed by `pr.number` (unique per repo —
  `pr_repo_number_uq`, `schema/pulls.ts:31` — never the array index). Each row
  is a `<Link href={\`/repos/${repoId}/pulls/${pr.number}\`}>` from `next/link`
  containing a mono `#{pr.number}`, the title, and
  `formatPriorPrAge(pr.updated_at)` from T5.
- No `useMemo`/`useCallback` — the list is capped at 5 and nothing here is
  memoized downstream.

`BlastRadiusPanel.tsx` — **two** insertion points, both as the last child of
`<section style={s.card}>`:

1. In the `state === 'empty'` branch (after `<EmptyState … />`, `:106`).
2. In the main branch (after the tree/graph block, `:151`).

Not in the loading branch (`:87-96`) and not before `if (!data) return null;`
(`:98`). The row appearing in the `empty` branch is REQ-5 made visible: prior
PRs exist independently of whether the index found any downstream impact.

`styles.ts` — add only what the row needs (e.g. `priorPrsRow`,
`priorPrsHeader`, `priorPrsList`, `priorPrsItem`, `priorPrsAge`) next to the
existing exports; reuse `s.chevron` and the existing token variables
(`var(--border)`, `var(--text-muted)`, …). No new CSS file, no inline
`style={{…}}` literals in the component (the file's convention is a `satisfies
CSSProperties` object in `styles.ts`).

`client/messages/en/blast.json` — add exactly one key alongside the existing
`blast.*` keys, keeping every existing key and its wording:

```json
"priorPrs": { "title": "Prior PRs touching these files" }
```

The count is rendered as a bare `<Badge>` number, so it needs no message; the
age strings come from T5's formatter (see Risks for the localisation caveat).

New `BlastRadiusPanel.test.tsx` cases (keep every existing case; the existing
`okData` fixture needs no change because `prior_prs` is optional):

1. **Collapsed → expanded flow.** With three `prior_prs`, the toggle button is
   present with `aria-expanded="false"`, the badge shows `3`, and no PR title is
   in the document; after `await user.click(...)` the button is
   `aria-expanded="true"`, all three titles are visible, each inside a link
   whose `href` is `/repos/<repoId>/pulls/<number>`, and one row shows the
   expected age text (fixture timestamps chosen so a `d`-bucket and an
   `mo`-bucket both appear).
2. **`prior_prs: []` → no row.** `queryByRole("button", { name: /prior prs/i })`
   is `null`.
3. **`prior_prs` omitted → no row.** Same assertion (proves the optional field
   is handled).
4. **Present in the empty state.** `state: "empty"` with two `prior_prs` → the
   existing empty-state copy renders **and** the prior-PRs toggle is present.

### Phase 3: follow-ups (not for `implementer`)

| Task ID | Module | Type | Owned paths | Depends-on | Skills to use | Acceptance |
|---|---|---|---|---|---|---|
| T7 | e2e | e2e | `e2e/**` | T4, T6 | — | **Follow-up.** Deterministic locators only (no AI/`chat` locator): open a seeded PR whose repo has an overlapping prior PR, assert the "Prior PRs touching these files" toggle shows a non-zero count, click it, assert ≥1 PR row with a `#number` is visible and links to that PR's detail route |

`e2e/` is out of scope for `implementer` (see the roster in
`.claude/agents/README.md`); this row is here so the coverage is tracked, not
assigned.

## Dependency graph

```
T1 (contract) ─┬─────────────> T3 (assemble) ──> T4 (service + it.test) ──┐
T2 (repo)  ────┴──────────────────────────────────^                       ├─> T7 (e2e follow-up)
T1 (contract) ─┬─> T6 (client UI) ────────────────────────────────────────┘
T5 (formatter) ┘
```

Parallel-safe batches:

- **Batch 1:** T1, T2, T5 — disjoint paths, no edges.
- **Batch 2:** T3 and T6 — disjoint (server vs. client), no edge between them.
- **Batch 3:** T4.
- T7 is a tracked follow-up, not an `implementer` task.

## Testing Strategy

- server unit: `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts' && pnpm typecheck`
- server integration (Docker required): `cd server && pnpm exec vitest run test/blast-prior-prs.it.test.ts test/blast.it.test.ts`
- client: `cd client && pnpm test && pnpm typecheck`
- contract mirror: `diff server/src/vendor/shared/contracts/brief.ts client/src/vendor/shared/contracts/brief.ts` must print nothing
- reviewer-core: `cd reviewer-core && npm test && npm run typecheck` — expected
  untouched; run once as a regression check only.
- mcp-server: `cd mcp-server && npm run test:unit && npm run typecheck` — expected
  untouched; run once to confirm the `.passthrough()` assumption holds.
- Any DB-backed server test **must** carry the `.it.test.ts` suffix or the
  fast/slow CI split breaks (root `README.md`, `TESTING.md`).
- Add a new test only where a task's Acceptance criterion above requires one.

## Requirement → Acceptance map

| Requirement | Proven by |
|---|---|
| REQ-1 additive contract field, both copies identical | T1 `diff` + both typechecks |
| REQ-2 dedupe / ordering / cap / other-PRs-only | T2 assertions 1, 3, 5 |
| REQ-3 no schema, migration or dependency change | `git diff --exit-code server/src/db/ server/package.json client/package.json` after T4/T6 |
| REQ-4 query in the repository layer only | T4's `grep` acceptance over `server/src/modules/blast/` |
| REQ-5 never influences state; survives a degraded index | T3 case 1 + T4 assertions 1 and 2 + T6 case 4 |
| REQ-6 zero LLM calls | T4 assertion 3 (`llm.calls.length === 0`) |
| REQ-7 collapsed-by-default row, hidden when empty | T6 cases 1, 2, 3 |
| REQ-8 workspace + repo scoping | T2 assertion 4 |

## Risks & Mitigations

- **`pr_files` has no index on `path` or `pr_id`** (`schema/pulls.ts:36-45`), so
  the join is a sequential scan. Mitigation: accept and record, exactly as
  `server/INSIGHTS.md:9-10` did for `findings` — the query is repo- and
  workspace-filtered, runs once per Blast Radius request, and current data
  volume is a local dev DB. If it becomes hot, the fix is a composite index on
  `(path, pr_id)` via `schema/pulls.ts` + `pnpm db:generate` (**never** a
  hand-written migration, `server/INSIGHTS.md:28-29`) — a separate,
  deliberately-out-of-scope change since REQ-3 forbids a migration here.
- **A very large PR produces a very large `IN (...)` list.** A 300-file PR sends
  300 path literals. Mitigation: acceptable today; if it bites, the knob is a
  path cap in `blast/constants.ts` next to `MAX_PRIOR_PRS`, applied in
  `service.ts` (policy layer), not in the repository.
- **`inArray(col, [])` on an empty `paths`.** Mitigation: T2's mandatory
  early-return plus its assertion 6.
- **`NULLS FIRST` default on `desc()`.** A PR with `updated_at: null` would sort
  to the top of a "newest first" list. Mitigation: explicit `desc nulls last`
  plus T2 assertion 5.
- **Contract edit touches a do-not-touch tree.** Mitigation: T1 is the sole
  owner of both copies; the byte-identical `diff` is part of its acceptance; no
  other task may edit those files.
- **`prior_prs` could drift into the state machine.** A future edit computing
  `state: 'empty'` from "no downstream **and** no prior PRs" would silently
  break REQ-5. Mitigation: T3 case 1 pins state equality across
  with/without-`priorPrs` runs, and the rule is stated in `assemble.ts`'s doc
  block.
- **Age labels are English-only.** `formatPriorPrAge` returns
  `"11d ago"` directly rather than going through `next-intl` — the same
  shortcut `pulls/helpers.ts:12-24` already takes for the PR-list UPDATED
  column. Recorded rather than silently accepted; revisit when a second locale
  is added, at which point both formatters should move to keyed messages
  together.
- **"Prior PR" includes open PRs, not just merged ones.** The query filters on
  file overlap and `repo_id` only, deliberately — `pull_requests.status`
  (`schema/pulls.ts:25`) is DevDigest's review status (`needs_review`, …), not a
  GitHub merged/closed state, so filtering on it would be wrong. The UI label
  says "Prior PRs touching these files", which is accurate for both. Noted here
  because a reviewer will reasonably ask.
- **`updated_at` is imported data, not a merge timestamp.** Ordering therefore
  reflects last sync/update, which is the same signal the PR list already sorts
  and displays. Consistent with existing UI, but not the same as "most recently
  merged".

## Out of Scope

Architecture review and security review are performed by separate reviewer
agents/skills (the `security` skill, `pr-self-review`, code-review) — not by
`planner` or `implementer`. Also out of scope: any `db/migrations/` or
`db/schema/` change (none is needed — REQ-3); an index on `pr_files` (recorded
under Risks as a deliberate deferral); surfacing `prior_prs` through
`mcp-server`'s `devdigest_get_blast_radius` projection; an overlap count or
overlapping-file list per prior PR (a natural future addition, but the reference
screenshot shows only number/title/age); any change to the PR-History section of
`PrBrief` (`PrHistoryItem`), which is a separate lesson's feature; and the `e2e`
coverage in T7, which is a tracked follow-up rather than an `implementer` task.
