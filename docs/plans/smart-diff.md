# Development Plan: Smart Diff — Instructor UI Alignment

## Context

Smart Diff is already implemented in the current dirty worktree: the server
classifies persisted PR files without an LLM, exposes `GET
/pulls/:id/smart-diff`, and the client renders the server groups. The instructor
demo clarifies that the current client interaction is not the intended one:
Smart ordering must be opt-in, findings must live on their exact diff rows, and
clicking an individual finding must navigate to its existing `FindingCard` in
the Agent runs tab. This plan is therefore a **delta plan over the current
implementation**, not permission to rewrite or discard the existing server or
the user's unrelated dirty-worktree changes.

The implementation evidence that drives this delta is:

- `DiffTab.tsx:20-76` currently selects Smart Diff automatically whenever the
  endpoint has groups; there is no user-controlled mode.
- `SmartDiffViewer.tsx:17-54,82-108` currently turns a file-level findings badge
  into an in-diff expand/highlight/scroll target. That behavior is obsolete.
- `page.tsx:60-69,141-164` and `FindingsTab.tsx:85-105` already implement the
  destination behavior for `?tab=findings&finding=<id>`: the tab clears hidden
  filters, opens the correct run, expands/focuses the card, and scrolls to it.
- `FindingRecord` carries the required `id`, `severity`, `file`, `start_line`,
  `dismissed_at`, and `review_id` (`contracts/findings.ts:47-62`,
  `contracts/review-api.ts:15-38`), while the fixed Smart Diff contract carries
  only de-duplicated `finding_lines` (`contracts/brief.ts:127-155`). Full finding
  identity must therefore be joined on the client from the already-loaded
  review records; the shared contract must not be changed.

## Requirements

- **REQ-1 — Explicit two-mode control.** The Files changed tab has one
  segmented, two-button control labelled exactly **`Smart order`** and
  **`Original order`**. `Original order` is selected on every initial mount.
  It renders the `PrFile[]` input in its existing order and exposes no
  finding-derived row marker or file finding count. Switching modes does not
  mutate or re-sort the input array.
- **REQ-2 — Graceful availability.** The Smart Diff query may load in the
  background, but loading, error, or `groups: []` leaves `Original order`
  selected and the flat `DiffViewer` usable. `Smart order` is disabled until a
  non-empty valid payload exists; no blank Smart view replaces the flat diff.
- **REQ-3 — Server order and disclosure defaults.** Smart mode renders the
  server-provided groups and files verbatim in `core` → `wiring` →
  `boilerplate` order; the client does not re-sort them. Group disclosures for
  **Core logic** and **Wiring** start open, while **Boilerplate** starts closed.
  Users may subsequently open or close any group.
- **REQ-4 — Exact instructor group chrome.** Every Smart group header contains
  its title, a descriptive subtitle, and a right-aligned file count. The Core
  title is exactly **`Core logic`** and its subtitle is exactly **`The substance
  of the change — review closely`**. Wiring and Boilerplate get equivalent
  localized descriptions rather than an unlabeled icon-only distinction.
- **REQ-5 — Exact inline findings.** In Smart mode, every current,
  non-dismissed finding is attached to the diff row whose new-side number
  equals `FindingRecord.start_line`. The row gets a worst-severity tint and a
  visible, clickable right-side lowercase severity label (`critical`,
  `warning`, or `suggestion`) for **each** finding. The text label, focus style,
  title, and `aria-label` make the signal non-color-only.
- **REQ-6 — Correct finding population.** Inline findings use only each agent's
  latest `kind: "review"` `ReviewRecord`, matching server
  `latestPerAgent` semantics (`server/src/modules/pulls/status.ts:33-50`):
  `kind: "summary"` and `dismissed_at != null` are excluded; rows with a null
  `agent_id` remain independent. The selected records are additionally
  intersected with that Smart file's authoritative `finding_lines`, preventing
  stale client review data from producing a marker the Smart endpoint omitted.
- **REQ-7 — Multiple findings on one row.** Findings sharing one
  `file + start_line` all render as separate controls. Their order is stable:
  severity (`CRITICAL`, `WARNING`, `SUGGESTION`) → review `created_at`
  descending → finding `id` ascending. The passive file count counts individual
  findings, not de-duplicated finding lines.
- **REQ-8 — Finding navigation.** Activating one inline marker performs one
  standard Next navigation to exactly
  `/repos/<repoId>/pulls/<number>?tab=findings&finding=<encoded-id>`. It does not
  open a popup, link to GitHub, expand/scroll within the diff, or navigate to a
  file/card group generally. Existing `FindingsTab`/`FindingCard` target logic
  remains the sole owner of focus, force-expand, and scroll behavior.
- **REQ-9 — File-level finding count.** Smart mode may retain a passive
  **`N findings`** header count for scanability, derived from the mapped
  individual findings. It is not a link/button and has no scroll behavior.
  The current clickable count badge, `expandSignal`, `highlightLines`, target
  nonce, and `requestAnimationFrame(...scrollIntoView)` path are removed as
  superseded behavior.
- **REQ-10 — Large files.** A file is large iff
  `additions + deletions > 150`: 150 is normal and 151 is large. In both
  Original and Smart modes, a large file gets the instructor's orange-emphasis
  filename/header treatment plus a visible warning icon/label with an
  accessible name containing the path and changed-line count. This is separate
  from the existing 200-line auto-collapse behavior; the auto-open threshold is
  not silently redefined.
- **REQ-11 — Top summary and PR warning.** Above the file list, both modes show
  **`N files · +A · -D`** using the authoritative PR detail totals
  (`files_count`, `additions`, `deletions`), not a potentially incomplete sum of
  persisted `PrFile[]`. In Smart mode, `split_suggestion.too_big` renders the
  instructor-style **`This PR is large (N changed lines)`** warning using
  `split_suggestion.total_lines`.
- **REQ-12 — Grounded token status only.** Smart mode renders
  **`0 new tokens · built on N from last review`** only when every selected
  latest review has a non-null `run_id` matching a `RunSummary` with
  `status === "done"` and non-null `tokens_in` and `tokens_out`; `N` is the sum
  of both token fields across those matched latest reviews. If there is no
  latest review, a legacy null `run_id`, a missing run, a non-done run, or any
  unknown token field, omit the entire status line. `0 new tokens` describes
  the verified no-LLM Smart Diff request; do not invent a cache hit, reviewed
  head SHA, or model relationship because `RunSummary`/`ReviewRecord` expose no
  reviewed commit SHA.
- **REQ-13 — Preserve the server contract and behavior.** Keep the existing
  deterministic classifier, Core/Wiring/Boilerplate ordering, latest-per-agent
  filtering, dismissed/summary exclusion, graceful empty response, and
  `pseudocode_summary: null`. Smart Diff causes zero model calls. No DB schema,
  migration, repository, reviewer-core, or shared contract change is allowed.
- **REQ-14 — Preserve existing behavior outside the delta.** Inline GitHub
  comments, normal diff expansion, theme behavior, and the already-loaded
  Agent runs destination continue to work. Preserve all unrelated user changes
  in the dirty worktree.

## Affected Modules & Contracts

- **client** (`@devdigest/web`) — the main delta: route-level data/routing
  wiring, segmented mode control and instructor chrome, deterministic review
  projection helpers, group disclosure, and optional diff row/header
  annotations.
- **server** (`@devdigest/api`) — production Smart Diff code remains unchanged.
  Only the deterministic demo seed may gain a patch for the already-seeded
  finding so the follow-up browser flow can exercise a real inline row.
- **e2e** (`@devdigest/e2e`) — follow-up deterministic flow only; not assigned
  to the ordinary `implementer`.
- **reviewer-core** — untouched. Its grounding index is new-side line based
  (`reviewer-core/src/grounding.ts:23-38`), which matches REQ-5's row lookup.

### Contract changes in `@devdigest/shared`

**None.** Do not edit either `server/src/vendor/shared/` or
`client/src/vendor/shared/`. `SmartDiffFile.finding_lines` intentionally stays
`number[]`; full `FindingRecord` identity comes from the existing
`GET /pulls/:id/reviews` data already loaded by `page.tsx:40,71-76`.
`RunSummary` already supplies `run_id`, `status`, `tokens_in`, and `tokens_out`
(`client/src/vendor/shared/contracts/trace.ts:98-120`), and `ReviewRecord`
supplies the correlating `run_id`, `agent_id`, `kind`, and `created_at`.

## Architecture Notes

- The server onion remains unchanged: `smart-diff/routes.ts` →
  `smart-diff/service.ts` → existing review repository + pure assembler. The
  service already imports `latestPerAgent`, filters summaries/dismissals, and
  never imports an LLM (`server/src/modules/smart-diff/service.ts:1-49`).
- Keep fetching in the existing route client component. `page.tsx` already owns
  reviews, run summaries, URL tabs, and navigation; it passes those existing
  values down. `DiffTab` owns only the local `original | smart` view choice,
  while `SmartDiffViewer` remains presentational and calls an injected
  `onFindingClick(id)` callback.
- The review-to-inline projection is pure business logic in
  `SmartDiffViewer/helpers.ts`, not state synchronized through effects. It must
  mirror the server's strict `>` timestamp replacement behavior so equal-time
  ties keep the first (newest-first API) row.
- `FileCard`/`CodeLine` receive optional annotation and large-file props. Plain
  callers keep today's rendering. Do not move `FileCard` open state upward or
  couple the reusable diff viewer to page routing.
- Severity colors use the existing design tokens (`--crit/--crit-bg`,
  `--warn/--warn-bg`, `--sugg/--sugg-bg`); do not edit `client/src/vendor/ui/`.
- `client/INSIGHTS.md:12` makes `client/src/lib/format.ts` the shared formatter
  home only when multiple component trees need a formatter. The token/status
  projection has one consumer, so it stays colocated in SmartDiff helpers.
- `server/INSIGHTS.md:18-22` requires reusing, not reimplementing, the server
  `latestPerAgent` helper. This plan does not alter the server path; the client
  has a transport-shape projection only because the fixed Smart contract omits
  finding IDs.
- Relevant do-not-touch paths: `server/src/vendor/shared/`,
  `server/src/db/migrations/`, `client/src/vendor/shared/`, and
  `client/src/vendor/ui/`. ESM relative imports keep `.js` where the package
  convention requires them.

## Task Dependency Graph

```text
T1 review projection ─┐
                     ├─> T3 Smart viewer ─> T4 tab/page wiring ─> T5 e2e fixture + flow
T2 diff primitives ──┘                           │
                                                └─> T6 full verification

Existing server implementation/tests ───────────────────────────> T6
```

T1 and T2 own disjoint paths and are safe to run in parallel. Every later edge
is one-way; the graph has no cycle.

## Phases

### Phase 1: Pure client data projection and reusable diff primitives

| Task ID | Module | Type | Owned paths | Depends-on | Skills to use | Acceptance |
|---|---|---|---|---|---|---|
| T1 | client | logic/test | `client/src/app/repos/[repoId]/pulls/[number]/_components/SmartDiffViewer/helpers.ts`, `client/src/app/repos/[repoId]/pulls/[number]/_components/SmartDiffViewer/helpers.test.ts` | — | react-frontend-architecture, typescript-expert, react-testing-library | `cd client && pnpm exec vitest run 'src/app/repos/[repoId]/pulls/[number]/_components/SmartDiffViewer/helpers.test.ts' && pnpm typecheck` passes with named cases `keeps only each agent's latest review findings`, `keeps null-agent reviews independent`, `excludes summary and dismissed findings`, `intersects records with authoritative finding_lines`, `orders multiple findings on one line deterministically`, `sums complete latest-review run tokens`, and `suppresses partial or uncorrelated token status` |
| T2 | client | shared UI/test | `client/src/components/diff-viewer/constants.ts`, `client/src/components/diff-viewer/helpers.ts`, `client/src/components/diff-viewer/styles.ts`, `client/src/components/diff-viewer/CodeLine/**`, `client/src/components/diff-viewer/FileCard/**`, `client/src/components/diff-viewer/DiffViewer/**`, `client/src/components/diff-viewer/index.ts` | — | react-best-practices, react-frontend-architecture, react-testing-library, typescript-expert | `cd client && pnpm exec vitest run src/components/diff-viewer && pnpm typecheck` passes with named cases `keeps 150 changed lines normal and marks 151 large`, `renders no finding controls when annotations are absent`, `renders one accessible severity control per finding on the exact new-side row`, `uses worst severity to tint a row`, `preserves deterministic same-line marker order`, and `invokes the selected finding id exactly once` |

**T1 detail — one canonical projection.** Add pure helpers that:

1. Filter to `kind === "review"`, select the latest record per
   `(pr_id, agent_id)` using the same key/null-agent rule and strict timestamp
   comparison as the server, then discard dismissed findings.
2. Join by exact `file + start_line`, but only when that path and line exist in
   the server group's `finding_lines`.
3. Return `Map<path, Map<line, FindingRecord[]>>` with REQ-7 ordering plus an
   individual finding count per file.
4. Derive the optional token total under REQ-12's all-or-nothing rule from the
   same selected reviews and `RunSummary[]`.

Do not use `allFindings = reviews.flatMap(...)`: it includes superseded review
rows and is intentionally broader for other existing page features.

**T2 detail — optional diff API.** Replace the temporary Smart Diff
`highlightLines`/`expandSignal`/clickable `badge` API with the final optional
shape: per-line finding annotations plus `onFindingClick`, a passive file count,
and large-file emphasis. `CodeLine` keeps its new-side
`data-diff-line="<path>:<newNo>"` anchor for deterministic testing, but removes
the old generic jump-highlight state. A row with findings reserves a right-side
marker rail without covering code; each marker is a semantic `<button>`. Add
`LARGE_FILE_CHANGED_LINES = 150`; the large check is strict `>` and independent
of `AUTO_EXPAND_MAX_LINES = 200`. `DiffViewer` gets an optional
`emphasizeLargeFiles` flag so `DiffTab` can enable the same header treatment in
Original mode while unrelated callers retain prior behavior.

### Phase 2: Instructor Smart viewer

| Task ID | Module | Type | Owned paths | Depends-on | Skills to use | Acceptance |
|---|---|---|---|---|---|---|
| T3 | client | feature UI/test/i18n | `client/src/app/repos/[repoId]/pulls/[number]/_components/SmartDiffViewer/SmartDiffViewer.tsx`, `client/src/app/repos/[repoId]/pulls/[number]/_components/SmartDiffViewer/SmartDiffViewer.test.tsx`, `client/src/app/repos/[repoId]/pulls/[number]/_components/SmartDiffViewer/constants.ts`, `client/src/app/repos/[repoId]/pulls/[number]/_components/SmartDiffViewer/styles.ts`, `client/src/app/repos/[repoId]/pulls/[number]/_components/SmartDiffViewer/index.ts`, `client/messages/en/smartDiff.json` | T1, T2 | react-frontend-architecture, react-best-practices, react-testing-library, next-best-practices | `cd client && pnpm exec vitest run 'src/app/repos/[repoId]/pulls/[number]/_components/SmartDiffViewer' && pnpm typecheck` passes with named cases `renders Core logic subtitle and right-aligned count`, `opens Core and Wiring but collapses Boilerplate initially`, `renders the large-PR warning`, `shows passive individual finding count`, `places multiple severity markers on their exact line`, `forwards the clicked finding id without scrolling the diff`, `shows token provenance only for complete correlated runs`, and `does not reorder server groups or files` |

**T3 detail.** Delete the current `Target`, `jumpToFinding`, `expandSignal`,
`highlightLines`, `requestAnimationFrame`, `querySelector`, and
`scrollIntoView` path. Render a disclosure button for each role group, with
local open state initialized from `role !== "boilerplate"`; its file count is
pushed to the right and remains visible while collapsed. Resolve patches with
the existing path map, pass T1 annotations to T2's `FileCard`, pass the selected
finding ID through `onFindingClick`, and render a passive header count only in
Smart mode. Localize every new user-facing string, including exact control
labels consumed by T4, group titles/descriptions, severity aria-labels, the
large-file indicator, summary/status text, and warning banner.

### Phase 3: Mode control, authoritative summary, and Next routing

| Task ID | Module | Type | Owned paths | Depends-on | Skills to use | Acceptance |
|---|---|---|---|---|---|---|
| T4 | client | route UI/test | `client/src/app/repos/[repoId]/pulls/[number]/page.tsx`, `client/src/app/repos/[repoId]/pulls/[number]/_components/DiffTab/DiffTab.tsx`, `client/src/app/repos/[repoId]/pulls/[number]/_components/DiffTab/DiffTab.test.tsx`, `client/src/app/repos/[repoId]/pulls/[number]/_components/DiffTab/helpers.ts`, `client/src/app/repos/[repoId]/pulls/[number]/_components/DiffTab/helpers.test.ts` | T3 | react-frontend-architecture, react-best-practices, react-testing-library, next-best-practices, typescript-expert | `cd client && pnpm exec vitest run 'src/app/repos/[repoId]/pulls/[number]/_components/DiffTab' && pnpm typecheck` passes with named cases `defaults to Original order even when Smart data exists`, `shows N files plus additions and deletions from PR totals`, `Original order preserves file order and hides findings`, `switches to server Smart order on demand`, `disables Smart order during loading error and empty groups`, `keeps large-file emphasis in both modes`, and `inline marker routes to the exact FindingCard query` asserting one `router.push('/repos/repo-1/pulls/42?tab=findings&finding=finding-2')` call |

**T4 detail.** `page.tsx` passes `repoId`, numeric PR number, `pr.additions`,
`pr.deletions`, `reviews ?? []`, and `prRuns ?? []` to `DiffTab`; do not launch
new queries. `DiffTab` owns `mode: "original" | "smart"`, initialized to
`"original"`, and renders the two buttons as one labelled segmented group with
`aria-pressed`/active state. Original renders the existing `DiffViewer` with
large-file emphasis and no annotations. Smart renders `SmartDiffViewer` only
when a non-empty payload exists. The marker callback calls `router.push` with a
pure, tested URL builder that `encodeURIComponent`s the finding ID and drops
unrelated query parameters, leaving the destination `FindingsTab` to consume
and then clear `finding` via its existing `router.replace` flow.

### Phase 4: Deterministic browser follow-up and verification

| Task ID | Module | Type | Owned paths | Depends-on | Skills to use | Acceptance |
|---|---|---|---|---|---|---|
| T5 | server + e2e | fixture/e2e follow-up | `server/src/db/seed.ts`, `e2e/specs/09-smart-diff.flow.json` | T4 | — (follow deterministic `agent-browser` conventions from `e2e/AGENTS.md`) | **Not for ordinary `implementer`.** Add a non-secret unified patch to the existing seeded `src/config.ts` whose new-side line 12 corresponds to the existing seeded finding, then run `./scripts/e2e.sh`. Flow `09-smart-diff` passes deterministically: open Files changed → assert `Original order` is pressed/default and original file is visible → activate `Smart order` → assert `Core logic` and its subtitle → find the exact `critical` control for `src/config.ts:12` and click → wait for URL containing `tab=findings&finding=` → assert `Hardcoded Stripe secret key in commit` is visible in the focused/expanded FindingCard. No `chat`/AI locator and no review/model-triggering step. |
| T6 | client + server | verification | No files (read-only verification of T1-T4 and existing server implementation) | T4 | — | All commands in Testing Strategy pass. Additionally `rg -n "scrollIntoView|expandSignal|highlightLines|jumpToFinding" 'client/src/app/repos/[repoId]/pulls/[number]/_components/SmartDiffViewer'` has no output, `git diff -- server/src/vendor/shared client/src/vendor/shared server/src/db/migrations client/src/vendor/ui` shows no task-introduced edits, and the Smart Diff integration test leaves `MockLLMProvider.calls` at length `0`. |

## Testing Strategy

- **Targeted client projection and UI:**
  `cd client && pnpm exec vitest run 'src/app/repos/[repoId]/pulls/[number]/_components/SmartDiffViewer' 'src/app/repos/[repoId]/pulls/[number]/_components/DiffTab' src/components/diff-viewer`
- **Full client regression:**
  `cd client && pnpm test && pnpm typecheck`
- **Full hermetic server regression:**
  `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts' && pnpm typecheck`
- **Smart Diff DB integration/no-LLM proof (Docker):**
  `cd server && pnpm exec vitest run test/smart-diff.it.test.ts`. Preserve the
  existing assertions for contract parse, role grouping, dismissed exclusion,
  multiple agents/latest review, summary exclusion, 404/422, and
  `MockLLMProvider.calls.length === 0`.
- **Deterministic browser follow-up:** `./scripts/e2e.sh` after T5. The new flow
  proves the full instructor journey, including Original default, Smart opt-in,
  exact inline marker, URL transition, and exact FindingCard—not merely the
  existence of a group heading.
- **Manual visual pass:** with `./scripts/dev.sh`, inspect light and dark themes,
  keyboard-focus both mode buttons and severity markers, verify a 150-line file
  remains normal and a 151-line file has orange emphasis plus the non-color
  indicator, verify same-line markers do not cover code, and verify Boilerplate
  starts closed on each fresh mount.

## Risks & Mitigations

- **Fixed Smart contract has lines but no finding IDs/severity.** Joining all
  page findings naively would resurrect stale runs. *Mitigation:* T1 exactly
  mirrors latest-per-agent/summary/dismissed selection, then intersects with
  server `finding_lines`; tests cover both stale-client and same-line cases.
- **A full-file scanner finding may cite a line absent from the rendered patch.**
  The grounding exception only guarantees that its file exists
  (`reviewer-core/src/grounding.ts:58-69`). *Mitigation:* never attach it to a
  nearby or invented row. Count only actually mapped inline controls in the
  passive count; retain the FindingCard in Agent runs. Record this as a fixture
  case if observed rather than weakening exact-row semantics.
- **Equal timestamps or multiple findings on one line can create flaky order.**
  *Mitigation:* match the server's strict timestamp replacement rule and apply
  the explicit severity/date/id ordering from REQ-7; never rely on `Map`/DB
  incidental ordering.
- **Token provenance can be partial.** Legacy seed reviews have null `run_id`,
  failed runs may have null token fields, and the contracts expose no reviewed
  head SHA. *Mitigation:* REQ-12 is all-or-nothing; suppress the entire status
  instead of showing `0`, a partial sum, or a false cache/freshness claim.
- **File totals can disagree with the loaded file subset.** The seed currently
  reports nine files but persists a subset (`server/src/db/seed.ts:150-164`).
  *Mitigation:* top chrome uses PR detail totals, while rendered file/group
  counts accurately describe their own collection; tests do not recompute PR
  totals from `files`.
- **Row marker rail can conflict with inline GitHub comments.** *Mitigation:*
  keep annotations inside the code row and comment threads below it; T2 retains
  comment tests and adds a finding-marker click test proving the comment
  composer is not opened.
- **Dirty worktree overlap.** All current Smart Diff files are modified or
  untracked. *Mitigation:* implement against the current contents, remove only
  the explicitly obsolete badge/scroll behavior, and inspect `git diff` before
  each task; do not reset or overwrite unrelated changes.

## Out of Scope

- Any new model/LLM call, model selection, pseudocode generation, or token
  consumption for Smart Diff.
- Any change to the Smart Diff/shared contracts, reviewer-core, DB schema,
  migrations, repositories, or production Smart Diff endpoint.
- Claiming commit-aware cache freshness or “built on this SHA”; neither
  `ReviewRecord` nor `RunSummary` exposes the reviewed head SHA.
- Popups, GitHub links, in-diff scroll targets, or whole-file navigation for
  Smart finding markers.
- Redesigning the general Findings/Agent runs experience; the existing
  `?finding=` focus/expand/scroll path is reused unchanged.
- Redefining the existing 200-line file auto-collapse threshold; the instructor
  large-file emphasis threshold is a separate strict `> 150` concern.
- Course submission prose/video and the three manual homework observations.
- Architecture and security review, which remain separate reviewer passes from
  implementation.
