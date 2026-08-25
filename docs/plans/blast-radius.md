# Development Plan: Blast Radius (L04)

## Context

`repo-intel` already indexes symbols, resolved references, the import graph
(`file_edges`), per-file rank and per-file facts (endpoints/crons) into Postgres,
and exposes them through the `RepoIntel` facade — but nothing in the product
reads the blast-radius part of it. `mcp-server` ships `devdigest_get_blast_radius`
as a deliberate stub because "no HTTP endpoint exposes blast radius today"
(`mcp-server/src/tools/get-blast-radius.ts:10-16`). This plan adds the missing
thin server module, the PR-Overview UI block, and swaps the MCP stub body for a
real call — with **zero** LLM calls on the main path and **no** AST/import-graph
recomputation at request time. An optional pre-push CLI (`devdigest review
--mode working`) is planned as a clearly separate bonus phase at the end.

## Requirements

- REQ-1: `GET /pulls/:id/blast` in a new `server/src/modules/blast/` module. The
  module is a thin wrapper: it calls `container.repoIntel.getBlastRadius(repoId,
  changedFiles)` and must not reimplement symbol/caller/endpoint resolution.
- REQ-2: Handler steps, in order: (a) resolve the PR's changed files, (b) call
  `getBlastRadius`, (c) per changed symbol collect importers/callers — excluding
  the declaring file itself, capped at `MAX_CALLERS_PER_SYMBOL` (20), sorted by
  file rank, (d) walk the **reverse** import graph from each changed file outward
  to HTTP routes / cron jobs, capped at `BFS_DEPTH` (2).
- REQ-3: Reuse the existing constants `MAX_CALLERS_PER_SYMBOL = 20`
  (`server/src/modules/repo-intel/constants.ts:30`) and `BFS_DEPTH = 2`
  (`constants.ts:49`). Do not redefine either in `blast/`.
- REQ-4: An incomplete/unusable index returns an explicit `partial` or `degraded`
  state with a machine `reason` **and** a human `reason_text` — never an empty
  array masquerading as "nothing found". This state is distinct from `empty`
  (index fine, genuinely no callers/endpoints).
- REQ-5: No AST parsing and no import-graph recomputation on the request path —
  reads come from the persisted index tables only.
- REQ-6: Client renders a **BLAST RADIUS** card inside the existing
  `OverviewTab.tsx` (no new tab), with a Tree/Graph toggle, collapsible symbol
  rows showing a caller count, clickable `file:line` caller rows, HTTP endpoint
  badges and cron/job badges.
- REQ-7: A `file:line` click navigates to that exact line: in-app to the diff
  viewer when the file is part of the PR's diff, otherwise to the GitHub blob at
  that line (existing `githubBlobUrl` pattern).
- REQ-8: `devdigest_get_blast_radius` calls the real route. Its input schema
  (`mcp-server/src/schemas.ts:88-91`) is **frozen** — only the handler body,
  description, API client and tests change.
- REQ-9: Main flow makes **zero** LLM calls. The optional one-paragraph summary,
  if implemented, makes **exactly one** and never invents nodes or edges.
- REQ-10 (bonus, optional): `devdigest review --mode working` CLI in
  `mcp-server/`, reusing the same Structured Reviewer path as the web UI.

## Affected Modules & Contracts

- **server** — new `modules/blast/`; additive read methods + one cap fix in
  `modules/repo-intel/`.
- **client** — new `BlastRadiusPanel` in the PR-detail feature folder; edits to
  `OverviewTab.tsx`, `page.tsx`, `DiffTab.tsx`, `messages/en/blast.json`.
- **mcp-server** — real handler body + one new API-client method.
- **reviewer-core** — untouched in Phases 0-5. Only the optional bonus phase
  reuses it, through the server, without modification.

### Contract changes in `@devdigest/shared` — YES, coordinated and explicit

`BlastRadius` / `DownstreamImpact` already exist
(`server/src/vendor/shared/contracts/brief.ts:60-88`) and are currently consumed
by **nothing** except the (also unconsumed) `PrBrief` composite at
`brief.ts:175-181` — verified by grep across `server/src`, `client/src`,
`reviewer-core/src`, `mcp-server/src`, `e2e/`. Both vendored copies are
byte-identical today (`diff server/src/vendor/shared/contracts/brief.ts
client/src/vendor/shared/contracts/brief.ts` → no output).

`server/CLAUDE.md` and `client/CLAUDE.md` mark `vendor/shared/` do-not-touch
"without coordination". **This plan is that coordination** — T1 is the single
task allowed to edit it, it must edit *both* copies identically, and no other
task may touch those files.

Changes (T1):

```ts
export const BlastState = z.enum(['ok', 'empty', 'partial', 'degraded']);
export const BlastIndexStatus = z.enum(['full','partial','degraded','failed','missing']);

export const DownstreamImpact = z.object({
  symbol: z.string(),
  file: z.string(),                 // NEW — declaring file, so a row is self-contained
  caller_count: z.number().int(),   // NEW — TRUE count before the 20-cap
  callers: z.array(BlastCaller),    // capped at MAX_CALLERS_PER_SYMBOL
  endpoints_affected: z.array(z.string()),
  crons_affected: z.array(z.string()),
});

export const BlastRadius = z.object({
  changed_symbols: z.array(ChangedSymbol),
  downstream: z.array(DownstreamImpact),
  summary: z.string(),              // "" unless the optional LLM summary ran
  state: BlastState,                // NEW — REQ-4
  reason: z.string().nullish(),     // NEW — machine code ('index_partial', 'no_data', …)
  reason_text: z.string().nullish(),// NEW — human sentence; non-null whenever state !== 'ok'
  truncated: z.boolean(),           // NEW — some symbol hit the 20-caller cap
  index_status: BlastIndexStatus,   // NEW
  generated_at: z.string(),         // NEW — ISO timestamp
});
```

`ChangedSymbol` and `BlastCaller` are **unchanged**. Per
`client/INSIGHTS.md:21-22`, `.nullish()` is the low-blast-radius choice for the
two optional string fields; `state`/`truncated`/`index_status`/`generated_at` are
required because they are the contract's whole point and have zero existing
producers.

## Architecture Notes

Onion layers touched (see `.claude/skills/onion-architecture/`):

- **Presentation** — `blast/routes.ts` (Zod params via `IdParams`, calls the
  service, serializes). Mirrors `smart-diff/routes.ts:23-30` exactly.
- **Application** — `blast/service.ts` (coordinates two facades + one repo read)
  and `blast/assemble.ts` (pure mapping, no I/O — mirrors
  `smart-diff/assemble.ts`). `blast/` gets the full split because it *does*
  coordinate multiple sources → it passes the graduated-layering test.
- **Infrastructure** — additive queries in `repo-intel/repository.ts` only.
  `blast/service.ts` must **not** import `repo-intel/repository.ts`, `db`, or
  `schema` — it goes through `container.repoIntel` (the facade) and
  `container.reviewRepo`.
- **Domain** — untouched; `reviewer-core` is not imported by `blast/` at all.

Verified facts the plan depends on (do not re-derive; re-check only if a file
changed):

- `RepoIntel.getBlastRadius(repoId: string, changedFiles: string[]):
  Promise<BlastResult>` — `server/src/modules/repo-intel/types.ts:147`,
  implementation `service.ts:220-304`.
- `BlastResult = { changedSymbols, callers: BlastCallerRow[], impactedEndpoints:
  string[], factsByFile?, degraded?, reason? }` — `types.ts:74-87`.
  `BlastCallerRow` carries `{ file, symbol, viaSymbol, line, rank }`
  (`types.ts:63-72`) — the flat caller list is grouped by `viaSymbol`, not
  pre-nested per symbol.
- **Degraded contract** (`types.ts:15-22`): object-returning facade methods carry
  inline `degraded?` + `reason?`; the authoritative status/reason is always
  `getIndexState()`. `DegradedReason` = `flag_off | index_failed | index_partial
  | repo_too_large | no_data` (`types.ts:27-32`).
- **Gotcha 1 — the "always degraded" fallback.** `getBlastRadius` returns
  `degraded: true, reason: 'no_data'` on the ripgrep fallback path *even when it
  found real data* (`service.ts:301-302`), while a genuinely empty persistent
  result returns `degraded: false` (`service.ts:338`). So `blast/` **cannot**
  infer state from `BlastResult.degraded` alone — it must also read
  `container.repoIntel.getIndexState(repoId)` (`service.ts:189-205`, always
  works, synthesises `degraded/no_data` when the row is missing).
- **Gotcha 2 — the caller cap is currently global, not per symbol.**
  `constants.ts:29` documents `MAX_CALLERS_PER_SYMBOL` as "Caller fan-out cap
  **per changed symbol**", but `tryPersistentBlast` applies
  `callers.slice(0, MAX_CALLERS_PER_SYMBOL)` to the *whole flat list*
  (`service.ts:386`). With that in place a PR touching 5 symbols can never show
  20 callers for any one of them. T2 fixes this inside `repo-intel` (where the
  constant lives), not in `blast/`.
- **Gotcha 3 — the persistent path does not exclude the declaring file.** The
  ripgrep path skips `r.fromPath === sym.file` (`service.ts:273`); the persistent
  path (`getResolvedCallers`, `repository.ts:503-531`) has no such filter, so a
  same-file reference can appear as its own caller. REQ-2(c) makes this
  exclusion the blast handler's job — T4 implements it there.
- **No reverse-graph read exists yet.** `repository.ts:432-437` (`getEdges`) is a
  full-table forward read used by `getCriticalPaths`. The reverse-lookup index
  `file_edges_repo_to_idx (repo_id, to_file)` exists and its schema comment
  states it is "what blast uses to walk 'who depends on this file?' in
  O(degree)" (`server/src/db/schema/repo-intel.ts:50-68`) — T3 adds the query
  that finally uses it. Keeping the walk in `repo-intel` is what preserves
  REQ-1: resolution logic stays in the facade, `blast/` only consumes.
- `pull_requests.repoId` (`schema/pulls.ts:12`) and `pr_files.path`
  (`schema/pulls.ts:41`) supply repo id + changed files;
  `container.reviewRepo.getPull(workspaceId, prId)` / `.getPrFiles(prId)`
  (`reviews/repository.ts:37,45`) are the existing accessors `smart-diff` uses.
- `ContainerOverrides` supports `repoIntel`, `codeIndex` and `llm`
  (`platform/container.ts:41-55`) — that is how T6 proves "index only" and "zero
  LLM calls" mechanically. `MockLLMProvider.calls` (`adapters/mocks.ts:60`) is a
  public call log.
- Client: `messages/en/blast.json` **already exists** with `view.tree` /
  `view.graph` / `callerCount` / `stat.*` / `graph.*` keys and is imported by
  nothing — pre-seeded scaffolding for this lesson. Reuse those keys; add the
  missing ones.
- Client: `CodeLine` already emits `data-diff-line="{path}:{newLineNo}"`
  (`components/diff-viewer/CodeLine/CodeLine.tsx:53`) and **no app code consumes
  it** (only tests) — that is the in-app jump-to-line seam for REQ-7. The
  out-of-diff fallback is `githubBlobUrl(repoFullName, sha, file, line)`
  (`lib/github-urls.ts:24-41`), already used by `FindingCard.tsx:55`.
- Client: there is **no "Risk Areas" card** in the starter (that is L05). Match
  `IntentPanel`'s `<section>` + `SectionLabel` + co-located `styles.ts` pattern
  (`IntentPanel/IntentPanel.tsx:77-118`) instead, and place the new panel
  between `IntentPanel` and the Description block.
- MCP: `mcp-server/src/tools/get-conventions.ts` is the exact template for the
  new handler (resolve → single client call → compact projection → explicit
  `status: 'empty'` object instead of a bare empty list).

Relevant INSIGHTS entries:

- `client/INSIGHTS.md:21-22` — `.nullable()` is required-but-null; `.nullish()`
  is what makes a shared-contract field optional. Drives the T1 field choice.
- `client/INSIGHTS.md:33-34` — `.js`-suffixed relative imports in
  `vendor/shared` need `extensionAlias` in `next.config.mjs`; already configured,
  so T1 must keep the existing `.js` import style in `brief.ts`.
- `server/INSIGHTS.md:28-29` — never hand-write migrations. **No schema change is
  needed for this feature**; if that turns out wrong, stop and re-plan rather
  than editing `db/migrations/`.
- `mcp-server/INSIGHTS.md:26-27` — an MCP caller has no way to discover `pr_id`,
  which is why `get_blast_radius` keeps its `repo` + `pr` schema and resolves
  internally via `resolveRepo` + `resolvePull` (`src/api/resolve.ts:39-86`).

## Phases

### Phase 0: Contract

| Task ID | Module | Type | Owned paths | Depends-on | Skills to use | Acceptance |
|---|---|---|---|---|---|---|
| T1 | shared | contract | `server/src/vendor/shared/contracts/brief.ts`, `client/src/vendor/shared/contracts/brief.ts` | — | zod, typescript-expert | `diff server/src/vendor/shared/contracts/brief.ts client/src/vendor/shared/contracts/brief.ts` prints nothing; `cd server && pnpm typecheck` and `cd client && pnpm typecheck` both exit 0; `cd server && pnpm exec vitest run test/contracts.test.ts` green |

T1 notes: add `BlastState`, `BlastIndexStatus`, the two new `DownstreamImpact`
fields and the six new `BlastRadius` fields exactly as specified in *Affected
Modules & Contracts*. Do not touch `ChangedSymbol`, `BlastCaller`, `PrBrief`, or
any other contract file. Both copies must stay byte-identical.

### Phase 1: repo-intel read model (server)

| Task ID | Module | Type | Owned paths | Depends-on | Skills to use | Acceptance |
|---|---|---|---|---|---|---|
| T2 | server | backend | `server/src/modules/repo-intel/service.ts`, `server/test/repo-intel-blast-cap.it.test.ts` | — | onion-architecture, typescript-expert | New `.it.test.ts` seeds 2 changed symbols × 25 resolved callers each and asserts `getBlastRadius` returns exactly 20 callers **per `viaSymbol`** (40 rows), rank-descending within each group; `cd server && pnpm exec vitest run test/repo-intel-blast-cap.it.test.ts` green |
| T3 | server | backend | `server/src/modules/repo-intel/repository.ts`, `server/src/modules/repo-intel/types.ts`, `server/src/modules/repo-intel/service.ts`, `server/test/repo-intel-reverse-impact.it.test.ts` | T2 | onion-architecture, drizzle-orm-patterns, typescript-expert | New `.it.test.ts` seeds `a.ts → b.ts → c.ts → d.ts` edges plus `file_facts` on `c.ts` and `d.ts`, and asserts `getReverseImpact(repoId, ['d.ts'])` returns `c.ts` and `b.ts` (depth 2) but **not** `a.ts`, with `depthLimited: true`; `cd server && pnpm exec vitest run test/repo-intel-reverse-impact.it.test.ts` green |

T2 notes: replace the global `callers.slice(0, MAX_CALLERS_PER_SYMBOL)`
(`service.ts:386`) with a group-by-`viaSymbol` cap that keeps the top
`MAX_CALLERS_PER_SYMBOL` rows per symbol by `rank` desc, tie-broken by `file`
asc then `line` asc (deterministic ordering is required by T4's tests). The
constant and its import stay where they are. Do not change the ripgrep fallback
path's semantics.

T3 notes: add (a) `RepoIntelRepository.getImporters(repoId, toFiles): Promise<{
fromFile: string; toFile: string }[]>` — a `WHERE repo_id = ? AND to_file IN
(...)` select that uses the existing `file_edges_repo_to_idx`; (b) a
`ReverseImpactResult` type in `types.ts` (`{ files: string[]; endpoints:
string[]; crons: string[]; byFile: Record<string, { endpoints: string[]; crons:
string[] }>; depthLimited: boolean; degraded?: boolean; reason?: DegradedReason
}`); (c) `getReverseImpact(repoId, changedFiles)` on the `RepoIntel` interface
and `RepoIntelService`, doing at most `BFS_DEPTH` `getImporters` rounds
(imported from `constants.ts`, never re-declared), deduping visited files,
excluding the changed files themselves, then one `getFileFacts` call over the
visited set. Gate on `container.config.repoIntelEnabled` and return a degraded
empty result when off, matching the facade's existing degraded contract. **No
astgrep/dependency-cruiser import may appear in this code path.**

### Phase 2: `blast/` module (server)

| Task ID | Module | Type | Owned paths | Depends-on | Skills to use | Acceptance |
|---|---|---|---|---|---|---|
| T4 | server | backend | `server/src/modules/blast/assemble.ts`, `server/test/blast-assemble.test.ts` | T1, T3 | onion-architecture, typescript-expert, zod | `cd server && pnpm exec vitest run test/blast-assemble.test.ts` green with ≥6 cases: ok / empty / partial-by-index / partial-by-truncation / degraded-with-data / degraded-no-index; each asserts the exact `state`, `reason`, non-null `reason_text`, and that the declaring file is absent from its own symbol's `callers` |
| T5 | server | backend | `server/src/modules/blast/service.ts`, `server/src/modules/blast/routes.ts`, `server/src/modules/index.ts` | T4 | onion-architecture, fastify-best-practices, zod | `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts' && pnpm typecheck` green; `grep -rE "adapters/(astgrep\|codeindex\|depgraph)\|db/schema\|repo-intel/repository" server/src/modules/blast/` returns no matches (REQ-5 + layering) |
| T6 | server | test | `server/test/blast.it.test.ts` | T5 | fastify-best-practices, drizzle-orm-patterns | `cd server && pnpm exec vitest run test/blast.it.test.ts` green (Docker required), covering all 5 assertions listed below |

T4 notes — `assemble.ts` is a **pure** function, no `Container`, no I/O:

```
assembleBlastRadius(input: {
  blast: BlastResult;
  index: IndexState;
  reverse: ReverseImpactResult;
  changedFiles: string[];
  now: Date;
}): BlastRadius
```

Rules, in this exact order:

1. `index_status` = `'missing'` when `index.lastIndexedSha === ''` and
   `index.degradedReason === 'no_data'`; otherwise `index.status`.
2. Group `blast.callers` by `viaSymbol`. Drop any caller whose `file` equals the
   declaring file of that symbol (REQ-2(c); see Gotcha 3). Sort each group by
   `rank` desc, then `file` asc, then `line` asc. `caller_count` = group size
   **before** capping; `callers` = first `MAX_CALLERS_PER_SYMBOL` entries
   (imported from `repo-intel/constants.ts` — REQ-3). Set `truncated: true` if
   any group was cut.
3. `DownstreamImpact.file` = the lexicographically smallest changed file that
   declares that symbol name (names are the only key `BlastCallerRow.viaSymbol`
   provides; document this tie-break in the file's doc comment).
4. `endpoints_affected` / `crons_affected` per symbol = union of (a)
   `blast.factsByFile[callerFile]` for each of that symbol's caller files, and
   (b) `reverse.byFile[f]` for every file reachable from that symbol's declaring
   file — deduped, sorted asc for deterministic output.
5. State, first match wins: `degraded` if `blast.degraded === true` **or**
   `index_status ∈ {degraded, failed, missing}` (`reason` =
   `blast.reason ?? index.degradedReason ?? 'no_data'`); else `partial` if
   `index_status === 'partial'` **or** `truncated` **or** `reverse.depthLimited`
   (`reason` = `'index_partial'` / `'caller_cap'` / `'depth_cap'`); else `empty`
   if there are no changed symbols, or every group has zero callers, endpoints
   and crons (`reason` = `'no_impact'`); else `ok` with `reason: null`.
6. `reason_text` comes from a module-level `Record<string, string>` map and is
   non-null whenever `state !== 'ok'`. `summary` is `''` (Phase 6 fills it).
   `generated_at` = `now.toISOString()`.

T5 notes — `service.ts` mirrors `SmartDiffService` (`smart-diff/service.ts:44-58`):
`getPull(workspaceId, prId)` → `NotFoundError` when missing → `getPrFiles(prId)`
→ `map(f => f.path)` → `Promise.all([repoIntel.getBlastRadius(pull.repoId,
paths), repoIntel.getIndexState(pull.repoId), repoIntel.getReverseImpact(pull.repoId,
paths)])` → `assembleBlastRadius(...)`. `routes.ts` registers
`GET /pulls/:id/blast` with `{ schema: { params: IdParams } }` and `getContext`,
returns `BlastRadius`, and is added to the registry in `modules/index.ts` as
`blast` (one import + one entry — the file's documented "ADD A MODULE" recipe).
No caching, no persistence, no LLM.

T6 notes — the integration test must assert all five:
1. Indexed fixture repo + PR touching a shared helper → `state: 'ok'`, ≥2
   callers in one `downstream` group and ≥1 `endpoints_affected`.
2. Same request with `ContainerOverrides.codeIndex` set to a stub whose every
   method throws → identical payload (proves index-only reads, REQ-5).
3. `ContainerOverrides.llm` set to a `MockLLMProvider`; after the request
   `provider.calls.length === 0` (REQ-9).
4. Indexed repo, PR touching a file with no external callers → `state: 'empty'`,
   `reason: 'no_impact'`, `reason_text` non-null.
5. Un-indexed repo (no `repo_index_state` row) → `state: 'degraded'`,
   `index_status: 'missing'`, `reason_text` non-null — and **not** `'empty'`
   (REQ-4's distinctness requirement).

### Phase 3: client UI

| Task ID | Module | Type | Owned paths | Depends-on | Skills to use | Acceptance |
|---|---|---|---|---|---|---|
| T7 | client | ui | `client/src/lib/hooks/blast.ts`, `client/src/lib/hooks/index.ts` | T1 | react-frontend-architecture, react-best-practices | `cd client && pnpm typecheck` exits 0 and `usePrBlastRadius` is exported from `@/lib/hooks`; hook mirrors `useSmartDiff` (`hooks/smart-diff.ts`): `queryKey: ["pr-blast", prId]`, `enabled: !!prId`, `retry: false` |
| T8 | client | ui | `client/src/app/repos/[repoId]/pulls/[number]/_components/DiffTab/DiffTab.tsx`, `.../DiffTab/helpers.ts`, `.../DiffTab/helpers.test.ts`, `.../DiffTab/DiffTab.test.tsx` | — | react-best-practices, react-testing-library, next-best-practices | `cd client && pnpm test` green; new test renders `DiffTab` with `targetFile`/`targetLine` and asserts `scrollIntoView` was called on the element matching `[data-diff-line="<path>:<line>"]` |
| T9 | client | ui | `client/src/app/repos/[repoId]/pulls/[number]/_components/BlastRadiusPanel/**`, `client/messages/en/blast.json` | T1, T7, T8 | react-frontend-architecture, react-best-practices, react-testing-library | `cd client && pnpm test` green; `BlastRadiusPanel.test.tsx` covers: loaded tree (symbol row shows `t("callerCount")`, expands to show `file:line` rows + endpoint badges), `state: 'empty'`, `state: 'degraded'` (distinct message, asserts the empty-state copy is **not** shown), and graph-toggle switch |
| T10 | client | ui | `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/OverviewTab.tsx`, `client/src/app/repos/[repoId]/pulls/[number]/page.tsx` | T8, T9 | react-frontend-architecture, next-best-practices | `cd client && pnpm test && pnpm typecheck` green; `OverviewTab` renders `<BlastRadiusPanel />` between `IntentPanel` and the Description block, and `page.tsx` forwards `file`/`line` search params into `DiffTab` |

T8 notes: add `buildDiffLineRoute(repoId, prNumber, file, line)` to
`DiffTab/helpers.ts` (same style as the existing `buildFindingRoute`) producing
`?tab=diff&file=<enc>&line=<n>`. Add optional `targetFile` / `targetLine` props
to `DiffTab`; in a `useEffect` keyed on them, `document.querySelector(
'[data-diff-line="…"]')?.scrollIntoView({ behavior: "smooth", block: "center" })`
— the same one-shot-target pattern `FindingsPanel.tsx:51-59` already uses. Do
not modify `CodeLine`/`FileCard` (the attribute already exists).

T9 notes — folder shape follows `IntentPanel/`:
`BlastRadiusPanel/{BlastRadiusPanel.tsx,index.ts,styles.ts,helpers.ts,
helpers.test.ts,BlastRadiusPanel.test.tsx}` plus
`_components/{SymbolRow.tsx,CallerRow.tsx,BlastGraph.tsx}`. Constraints:

- `"use client"` (it uses `useQuery` + local expand/toggle state).
- Header: `<SectionLabel icon="Zap">{t("title")}</SectionLabel>` with the
  Tree/Graph toggle in `right=` — copy the `aria-pressed` two-button pattern
  from `DiffTab.tsx:70-90` (`t("view.tree")` / `t("view.graph")` keys already
  exist).
- One `<SymbolRow>` per `downstream[]` entry: monospace `symbol()` + declaring
  `file`, a caller count via the existing `t("callerCount", { count })` key, and
  a collapsible caller list (`aria-expanded` on the toggle button).
- Caller rows render `file:line`. `helpers.ts` decides the destination: if the
  file is in the PR's `files` prop → in-app `buildDiffLineRoute(...)` via
  `router.push`; else `githubBlobUrl(repoFullName, headSha, file, line)` in a
  `MonoLink` with `target="_blank"`. Both branches must be unit-tested in
  `helpers.test.ts`.
- Endpoints render as `Badge`s (e.g. `GET /api/public/items`), crons as a second
  badge row using `t("stat.crons")`.
- States: loading → `Skeleton`; `state === 'empty'` → `EmptyState` with
  `t("empty.*")`; `state === 'partial' | 'degraded'` → a **distinct** inline
  notice using `t("state.<state>")` plus `t("reason.<reason>")` with the
  server's `reason_text` as fallback — never the empty state (REQ-4).
- `BlastGraph` is a dependency-free SVG/flex rendering of symbol → callers →
  endpoints, using the existing `graph.empty` / `graph.ariaLabel` keys. No new
  npm dependency.
- Add the missing keys (`title`, `empty.*`, `state.*`, `reason.*`,
  `symbolFile`, `endpointsLabel`) to `messages/en/blast.json`; keep every
  existing key and its wording.

T10 notes: `OverviewTab` gains `repoId`, `prNumber`, `repoFullName`, `headSha`,
`files` props (all already available in `page.tsx` from `pr` / `activeRepo`).
`page.tsx` reads `search.get("file")` / `search.get("line")` and passes them to
`DiffTab` as `targetFile` / `targetLine`. Keep the existing tab-state
`setParam` mechanism; do not introduce a second router pattern.

### Phase 4: MCP tool

| Task ID | Module | Type | Owned paths | Depends-on | Skills to use | Acceptance |
|---|---|---|---|---|---|---|
| T11 | mcp-server | backend | `mcp-server/src/tools/get-blast-radius.ts`, `mcp-server/src/tools/shared-context.ts`, `mcp-server/src/api/client.ts`, `mcp-server/src/api/types.ts`, `mcp-server/src/server.ts`, `mcp-server/test/get-blast-radius.test.ts`, `mcp-server/test/tools.it.test.ts`, `mcp-server/README.md` | T5 | typescript-expert, zod | `cd mcp-server && npm run test:unit && npm run typecheck` exit 0; `git diff --exit-code mcp-server/src/schemas.ts` shows no change (REQ-8); the rewritten unit test asserts the handler calls `GET /pulls/:id/blast` exactly once and returns `status: 'ok' \| 'empty' \| 'partial' \| 'degraded'` with the same `caller_count` values the route returned |

T11 notes: model the handler on `tools/get-conventions.ts` — `resolveRepo` →
`resolvePull` (both from `api/resolve.ts`, already imported by sibling tools) →
new `DevDigestApiClient.getBlastRadius(prId)` → compact projection:
`{ status, message?, repo, pr, index_status, truncated, changed_symbols,
downstream: [{ symbol, file, caller_count, callers: [{ file, line, name }],
endpoints_affected, crons_affected }] }`. Do **not** trim the caller list further
than the server did — the whole point is that MCP output and the UI can be
compared 1:1. Map `state: 'empty'` to an explicit `status: 'empty'` object with an
actionable `message` (never a bare empty array), and `'partial'`/`'degraded'` to
the same status string plus the server's `reason_text` as `message`. Replace the
`GET_BLAST_RADIUS_DESCRIPTION` stub warning with a real description. Update the
tool table row in `README.md:36` and the "makes no HTTP call" note at
`README.md:25-26`. `src/schemas.ts` is **frozen** — any need to change it means
stop and re-plan.

### Phase 5: docs & follow-ups

| Task ID | Module | Type | Owned paths | Depends-on | Skills to use | Acceptance |
|---|---|---|---|---|---|---|
| T12 | docs | docs | `server/README.md`, `server/src/modules/repo-intel/README.md`, `client/README.md` | T5, T10, T11 | mermaid-diagram | `GET /pulls/:id/blast` appears in the server API map; `repo-intel/README.md`'s facade list gains `getReverseImpact` and stops describing Blast Radius as future work; every added claim cites a real file:line |
| T13 | e2e | e2e | `e2e/**` | T10 | — | **Follow-up, not for `implementer`.** Deterministic locators only (no AI/`chat` locator): open a seeded PR's Overview tab, assert the BLAST RADIUS card renders ≥1 symbol row with a caller count, expand it, click a `file:line` row, assert the diff viewer scrolled to that line |

T12 should be handed to the `doc-writer` agent, not `implementer`.

### Phase 6 (OPTIONAL / BONUS — lower priority; start only after Phases 0-5 are green): pre-push CLI

Ship only if time allows. Nothing in Phases 0-5 depends on this phase.

| Task ID | Module | Type | Owned paths | Depends-on | Skills to use | Acceptance |
|---|---|---|---|---|---|---|
| T14 | server | backend | `server/src/modules/local-review/routes.ts`, `server/src/modules/local-review/service.ts`, `server/src/modules/index.ts`, `server/test/local-review.it.test.ts` | T5 | onion-architecture, fastify-best-practices, zod, security | `POST /reviews/working` with a raw unified diff + `agentId` returns grounded findings; the `.it.test.ts` asserts the findings equal what `reviewPullRequest` produced from a `MockLLMProvider` fixture, that exactly one `completeStructured` call happened, and that **no** `reviews` / `findings` / `agent_runs` row was written |
| T15 | mcp-server | backend | `mcp-server/src/cli/index.ts`, `mcp-server/src/cli/git.ts`, `mcp-server/src/cli/render.ts`, `mcp-server/package.json` | T14 | typescript-expert, zod | `cd mcp-server && npm run build && node dist/cli.js review --help` prints both the untracked-files limitation and the exit-code contract; running it in a dirty repo prints one `SEVERITY  path:line  title` line per finding |
| T16 | mcp-server | test | `mcp-server/test/cli-git.test.ts`, `mcp-server/test/cli-render.test.ts`, `mcp-server/test/cli-exit.test.ts` | T15 | typescript-expert | `cd mcp-server && npm run test:unit` green; tests assert exit 0 with no blocking findings, non-zero with ≥1 blocking finding, and non-zero when the review call itself fails |

Bonus-phase design constraints (binding if the phase is built):

- **One reviewer, not two.** T14's `LocalReviewService` must call
  `reviewPullRequest` from `@devdigest/reviewer-core` (the same entry point
  `reviews/run-executor.ts:267` uses), parse the incoming diff with the existing
  `parseUnifiedDiff` (`server/src/adapters/git/diff-parser.ts:14`), resolve the
  LLM through `container.llm(agent.provider)` and read the agent row from the
  DB. It must **not** re-implement prompt assembly, grounding, or scoring, and
  must not loosen `groundFindings()`. Difference from the PR path: no
  persistence, no `agent_runs` row, no SSE — findings are returned inline. Keep
  `runOneAgent` untouched; do not refactor it "to share code" in this phase.
- **API keys stay server-side.** The CLI is an HTTP client of `:3001`, exactly
  like every existing MCP tool (`mcp-server/README.md:22-26`); it must never
  read `process.env` for provider keys or instantiate an `LLMProvider`.
  `SecretsProvider` remains the only key path.
- **T15 scope**: find the git root (`git rev-parse --show-toplevel`), collect
  `git diff HEAD` (staged + unstaged, **tracked files only**), POST it, render
  findings with severity + path + line.
- **`--help` must document**, verbatim in its output: (a) untracked files are
  not reviewed, (b) exit `0` = no blocking findings, non-zero = blocking
  findings **or** the review failed to run.
- **Future modes**: parse `--mode` as an enum whose only accepted value today is
  `working`; `staged` and `branch` are listed as "not implemented yet" and
  rejected with a clear message. The diff-collection function takes the mode as
  a parameter, so adding a mode later is a new branch, not a rewrite.
- `mcp-server/src/index.ts` is the only file allowed to read `process.env`
  (`mcp-server/CLAUDE.md`) — the CLI entry gets its own equivalent seam and must
  not print to stdout from any module the stdio MCP server also loads.

## Testing Strategy

- server unit: `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts' && pnpm typecheck`
- server integration (Docker): `cd server && pnpm exec vitest run .it.test`
- client: `cd client && pnpm test && pnpm typecheck`
- mcp-server: `cd mcp-server && npm run test:unit && npm run typecheck`
- reviewer-core: `cd reviewer-core && npm test && npm run typecheck` (expected
  untouched; run it as a regression check in the bonus phase only)
- Any DB-backed server test **must** use the `.it.test.ts` suffix or the
  fast/slow CI split breaks (`TESTING.md`, root `README.md:167-169`).
- Add a new test only where a task's Acceptance criterion above requires one.

## Requirement → Acceptance map

| Requirement / assignment criterion | Proven by |
|---|---|
| Demo PR on a shared helper shows ≥2 real callers + ≥1 HTTP endpoint | T6 assertion 1 |
| Clicking `file:line` opens the correct line | T8 test (in-diff) + T9 `helpers.test.ts` (GitHub fallback) + T13 e2e |
| Server does not rebuild AST/import graph per request | T5 grep check + T6 assertion 2 |
| Clear empty state | T6 assertion 4 + T9 empty-state test |
| Separate partial/degraded state | T4 state cases + T6 assertion 5 + T9 degraded test |
| Zero LLM calls on the main flow | T6 assertion 3 |
| Exactly one LLM call if the optional summary ships | Optional-summary task below |
| MCP tool returns a compact structured result matching the UI | T11 |
| Open PR with description + 1-3 min demo video | **Submission requirement — not implemented by any task.** Record after T13. |

### Optional one-paragraph LLM summary (only if wanted; sequence after T11)

Add `?summary=1` to `GET /pulls/:id/blast`. When present *and only then*, the
service makes exactly one call via `resolveFeatureModel(container, workspaceId,
'review_intent')` (`settings/feature-models.ts:50-57` — the designated cheap
classifier model; reusing it avoids a second `@devdigest/shared` `FEATURE_MODELS`
change) and fills `summary`. The prompt receives the **already-assembled**
`BlastRadius` object as untrusted input and may only describe it; nodes and edges
are never taken from the model's output. Owned paths: `server/src/modules/blast/
summary.ts`, `server/src/modules/blast/service.ts`, `server/src/modules/blast/
routes.ts`, `server/test/blast-summary.it.test.ts`. Depends-on: T5. Acceptance: the
`.it.test.ts` asserts `MockLLMProvider.calls.length === 0` without the flag and
`=== 1` with it, and that `changed_symbols` / `downstream` are byte-identical
across both responses.

## Risks & Mitigations

- **Contract edit touches a do-not-touch tree.** Mitigation: exactly one task
  (T1) owns both `vendor/shared` copies; the byte-identical `diff` check is part
  of its acceptance; no other task may edit those files.
- **The per-symbol cap fix changes existing behaviour.** `getBlastRadius` is read
  by nothing today except the new module (grep-verified), so T2's blast radius is
  limited to `run-executor`'s unrelated `getCallerSignatures` path, which T2 must
  not touch. Mitigation: T2's test pins the new grouping; run the full server
  suite before merging.
- **`getEdges` full-table read is tempting for the reverse walk.** Mitigation: T3
  must use the indexed `getImporters` query (`file_edges_repo_to_idx` exists
  precisely for this); loading the whole graph per request would violate the
  spirit of REQ-5 on large repos.
- **`blast/` could drift into re-implementing resolution.** Mitigation: T5's grep
  acceptance forbids `adapters/*`, `db/schema` and `repo-intel/repository`
  imports inside `blast/`.
- **Symbol grouping is by name only** (`BlastCallerRow.viaSymbol` carries no
  file). Same-named symbols declared in two changed files collapse into one row.
  Mitigation: documented tie-break in T4 rule 3; acceptable for v1 and recorded
  here rather than silently.
- **`mcp-server` has both `package-lock.json` and `pnpm-lock.yaml` committed.**
  Its README uses `npm`; T11/T15/T16 must use `npm` and must not regenerate or
  delete either lockfile.
- **The bonus phase could fork the reviewer.** Mitigation: T14's acceptance
  requires findings to match a `reviewPullRequest` run over the same fixture, and
  the phase explicitly forbids refactoring `run-executor.ts`.

## Out of Scope

Architecture review and security review are performed by separate reviewer
agents/skills (the `security` skill, `pr-self-review`, code-review) — not by
`planner` or `implementer`. Also out of scope: any `db/migrations/` change (none
is needed), a "Risk Areas" card (L05 scope), and the demo video / PR write-up,
which is a submission artifact rather than an implementable task.
