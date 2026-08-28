# `@devdigest/web` — the studio (Next.js 15)

The DevDigest UI: import repos, browse pull requests, inspect Blast Radius, run
and read AI reviews, and author agents. App Router + React Server/Client
components, with data loaded through **TanStack Query** hooks over the Fastify
API (`src/lib/hooks/blast.ts:7-15`).

- **Stack:** Next.js 15 (App Router), React 19, TanStack Query, `next-intl`
  (messages in `messages/<locale>/*.json`), `recharts`, `mermaid`,
  `react-markdown`, and `d3-force` for Blast Radius graph physics only (React
  owns the SVG DOM). UI primitives are vendored under `src/vendor/ui`
  (`@devdigest/ui`) and shared Zod contracts under `src/vendor/shared`
  (`@devdigest/shared`).
- **API base:** `NEXT_PUBLIC_API_BASE` (default `http://localhost:3001`), used by
  `src/lib/api.ts`. Every data hook lives in `src/lib/hooks/*`.
- **Run:** `pnpm dev` (`:3000`). **Test:** `pnpm test` (vitest + jsdom, fetch
  mocked — no API needed). **Typecheck:** `pnpm typecheck`.

## UI route map

Routes (`src/app/**/page.tsx`) and the API surface each leans on (via
`src/lib/hooks/*` → `src/lib/api.ts`):

```mermaid
flowchart TD
  ROOT["/"] -->|"useRepos → GET /repos"| PULLS["/repos/:repoId/pulls<br/>PR list"]
  ONB["/onboarding<br/>add repo"] -->|"POST /repos"| API[("Fastify API")]
  PULLS --> PR["/pulls/:number<br/>review detail<br/>(overview · diff · findings)"]

  AGENTS["/agents"] --> AGENT["/agents/:id<br/>editor (config)"]
  SETTINGS["/settings/:section<br/>API keys · models"]

  PULLS -->|"GET /repos/:id/pulls · /repos/:id/index-state"| API
  PR -->|"GET /pulls/:id · /pulls/:id/blast · /reviews · /pulls/:id/comments<br/>POST /pulls/:id/review · /findings/:id/(accept|dismiss)"| API
  AGENTS -->|"/agents · /agents/:id"| API
  SETTINGS -->|"/settings · /providers"| API
```

Cross-cutting chrome lives in `src/components/app-shell` (nav, breadcrumbs,
`g`-then-key shortcuts). Pages are thin; feature logic sits in colocated
`_components/<Name>/` folders, each with its own `*.test.tsx`.

### Blast Radius on PR overview

The Overview tab renders Blast Radius between Intent and the PR description
(`src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/OverviewTab.tsx:20-38`).
The card exposes Tree and Graph views, keeps index-backed `empty`, `partial`,
and `degraded` states visible, and shows symbol, caller, endpoint, and cron data
from `GET /pulls/:id/blast`
(`src/app/repos/[repoId]/pulls/[number]/_components/BlastRadiusPanel/BlastRadiusPanel.tsx:60-164`).

Caller `file:line` links open the in-app diff when that exact new-side line is
rendered; otherwise they open the matching GitHub blob when repository and SHA
metadata are available
(`src/app/repos/[repoId]/pulls/[number]/_components/BlastRadiusPanel/helpers.ts:18-48`).
The Diff tab scrolls an in-app target into view
(`src/app/repos/[repoId]/pulls/[number]/_components/DiffTab/DiffTab.tsx:70-93`).

### PR Brief sections on PR overview

Three new sections render around the existing intent/blast panels, in this
fixed order: `BriefSummaryPanel` → `IntentPanel` (existing, untouched) →
`RiskAreasPanel` → `BlastRadiusPanel` (existing, untouched) →
`ReviewFocusPanel` → the PR description block
(`src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/OverviewTab.tsx:25-62`).
All three panels live in the sibling
`_components/BriefSections/` folder, backed by `GET`/`POST /pulls/:id/brief`
via `usePrBrief`/`useGenerateBrief`
(`src/lib/hooks/brief.ts:9-19,21-28`, exported from `src/lib/hooks/index.ts:14`)
— see [`server/README.md`](../server/README.md#brief--one-llm-call-pr-summary-shared-cache-key)
for the cache-key/state-flow design behind those two routes.

**`OverviewTab.tsx` calls `useBriefSections(prId)` exactly once**
(`OverviewTab.tsx:26`) and passes its returned `state` down to all three
panels as a prop — no panel calls the hook itself
(`BriefSummaryPanel.tsx:13`, `RiskAreasPanel.tsx:51`,
`ReviewFocusPanel.tsx:67`). This is a deliberate exception to this client's
usual "each panel self-fetches" pattern (`IntentPanel`/`BlastRadiusPanel`
each call their own hook): the three Brief panels provably need the *same*
in-flight mutation state — all of them must show the loading state during a
regenerate, and all of them must show the same error after a failed one —
and TanStack Query's `useMutation` does not synchronize pending/error state
across separate `useMutation()` instances without an explicit `mutationKey`.
With a single call site there is exactly one `useMutation()` (and one
`useQuery()`) for the whole feature, so `mutation.isPending`/
`mutation.isError` are trivially the single source of truth for every
consumer, with no `mutationKey`/`useIsMutating` wiring needed
(`_components/BriefSections/useBriefSections.ts:16-40`).

`useBriefSections` composes `useAgents()` + `pickDefaultAgent` — there is no
agent-selector UI; the default is the first `enabled` agent sorted by `name`
then `id`, since `Agent` has no `default`/`created_at` field
(`_components/BriefSections/helpers.ts:10-16`) — with `usePrBrief` and
`useGenerateBrief` into one
`status: "no-agent" | "loading" | "empty" | "error" | "ready"` state
(`_components/BriefSections/types.ts:7-14`). Each panel renders purely off
that `status`: `loading` shows a `Skeleton` in place of any previous Brief's
content, with the Summary panel's regenerate control disabled
(`BriefSummaryPanel.tsx:18-40`); `error` shows the failure message and a
retry action on the Summary panel only, while Risk Areas and Review Focus
render nothing (`BriefSummaryPanel.tsx:42-49`, `RiskAreasPanel.tsx:54-56`,
`ReviewFocusPanel.tsx:70-72`); `empty` shows an explicit "Generate brief" CTA
on the Summary panel — there is no auto-generation.

Review Focus items reuse the existing `?tab=diff&file=&line=` deep link
(`resolveReviewFocusDestination`,
`_components/BriefSections/helpers.ts:25-36`, built on `DiffTab`'s
`buildDiffLineRoute`) when the cited file is part of this PR's diff, and
show a non-navigating "not in this PR's diff" message otherwise
(`ReviewFocusPanel.tsx:26-32`).

## Testing

Component/interaction tests (`*.test.tsx`) run under vitest + jsdom with `fetch`
mocked, so they need neither the API nor a browser. The real browser journeys
(client + API + seeded DB) are covered by the deterministic agent-browser suite
in [`../e2e`](../e2e/README.md) and the `e2e-web.yml` workflow. See
[`../TESTING.md`](../TESTING.md).
