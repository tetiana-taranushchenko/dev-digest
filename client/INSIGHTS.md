# INSIGHTS — client

Findings and insights for `client` (`@devdigest/web`). Empty for now — filled in as the course progresses.

## What Works

## What Doesn't Work

## Codebase Patterns

### 2026-08-04 — Formatters used by >1 component tree belong in `client/src/lib/format.ts`, not co-located
`formatTokens`/`formatSeconds` live in `RunTraceDrawer/helpers.ts` because they were only ever used inside that one component tree. When the Run Cost Badge feature needed the same kind of formatting (`formatCost`, `formatTokenCount`) in three separate trees — `pulls/_components/PRRow`, `pulls/[number]/_components/RunHistory`, and `RunTraceDrawer/_components/TraceBody` — co-locating would've meant duplicating the function three times. Created `client/src/lib/format.ts` as the shared home instead; existing `RunTraceDrawer/helpers.ts` formatters were left in place (still single-consumer, no need to move them).

### 2026-08-06 — A hover popup anchored inside `s.tableCard` (`pulls/styles.ts:96`, `overflow: "hidden"` for rounded corners) must render through a portal, not `position: absolute` in place
`FindingsPopover` (`pulls/_components/FindingsPopover/`), rendered in-place with `position: absolute`, got silently clipped by the table card's `overflow: hidden` — no error, it just vanished past the row edge. Fixed with `createPortal(..., document.body)` + `position: fixed`, positioned from `anchorRef.getBoundingClientRect()` — the default pattern for any future overlay anchored inside a table row or card here.

## Tool & Library Notes

### 2026-08-29 — jsdom reports every element's `offsetParent` as null in focus-trap tests
`components/context-picker/_components/useFocusTrap.ts` filters focusable controls with `el.offsetParent !== null`; in jsdom this makes the list empty and correctly exercises the hook's fallback of focusing the drawer wrapper, even though a real browser focuses the first visible button. Component tests should assert wrapper focus plus Escape/focus restoration, not pretend jsdom performs layout; browser/e2e coverage remains the right place to verify Tab cycling between visible controls.

## Recurring Errors & Fixes

### 2026-08-04 — A zod `.nullable()` field is REQUIRED (just null-valued); `.nullish()` is what makes it optional
Adding `cost_usd: z.number().nullable()` to `RunStats`/`RunSummary` (`client/src/vendor/shared/contracts/trace.ts`) meant every existing object literal typed against those contracts now needed the key present (even if `null`) — TypeScript failed on 3 fixtures missing it: `RunTraceDrawer.test.tsx`, `RunHistory.test.tsx`, and the mirrored `server/test/contracts.test.ts`. `PrMeta.cost_usd` was deliberately declared `.nullish()` instead (matching the existing `score` field), so mock GitHub clients typed as `PrMeta[]` (e.g. `server/src/adapters/mocks.ts`) didn't need updating. When adding a field to a shared contract, `.nullish()` is the lower-blast-radius choice unless every producer must consciously set it.

### 2026-08-06 — `overflowY: "auto"` alone also makes an unwanted `overflowX` scrollbar appear
`FindingsPopover.tsx` set only `overflowY: "auto"`, and a horizontal scrollbar showed up under the findings list (CSS's overflow spec computes a `visible` axis to `auto` too once the other axis is non-`visible`) — fixed with an explicit `overflowX: "hidden"` (`FindingsPopover.tsx:105`). Compounding cause: flex children (title, `file:line` text) had no `minWidth: 0`, so `text-overflow: ellipsis` never triggered and text pushed past the 340px panel (`FindingsPopover.tsx:135/143/167`) — ellipsis truncation in a flex row needs `minWidth: 0` alongside the usual `overflow`/`textOverflow`/`whiteSpace` trio.

### 2026-08-06 — A viewport-aware popup's "flip above" check should use a minimum usable height, not its max height
`FindingsPopover` first flipped above its trigger whenever `spaceBelow < POPUP_MAX_HEIGHT` (420px) — since the panel already scrolls internally, this flipped it for any row past the window's vertical middle, which read as arbitrary in testing (a ~300px-tall popup flipped up despite ~300-400px of real room below). Fixed by flipping only when `spaceBelow < POPUP_MIN_HEIGHT` (200px, `FindingsPopover.tsx:22,34`) — otherwise it opens down and scrolls internally.

### 2026-08-06 — Severity tally loops need an `in counts` guard, or an unrecognized severity produces `NaN`
`RunHistory.tsx:28`'s `RunFindingsSummary` did `counts[f.severity as Severity]++` with no check that `f.severity` is a known key — `severity` is a free-text DB column (`server/src/db/schema/reviews.ts:36`, no enum constraint), so any unexpected value makes `counts[...]` `undefined` and `undefined++` is `NaN`, silently breaking the badge. `SeverityCounters.tsx:24` already guards this with `f.severity in c`; `RunHistory.tsx` was missed when the same tally logic was duplicated there. Fixed by adding the same `f.severity in counts` guard. Any future severity-tally loop should copy this guard rather than the unguarded version.

### 2026-08-11 — `tsconfig`'s `moduleResolution: "Bundler"` does not make webpack resolve `.js`-suffixed relative imports to `.ts` files — `next.config.mjs` needs `experimental.extensionAlias` too
`import ... from './contracts/findings.js'` in `client/src/vendor/shared/index.ts:17` failed dev-server compilation with "Module not found: Can't resolve './contracts/findings.js'" even though `findings.ts` existed and was correct, and `rm -rf client/.next` didn't fix it. Root cause: TypeScript's `moduleResolution: "Bundler"` (`client/tsconfig.json`) accepts this `.js`→`.ts` pattern for type-checking, but Next's webpack build only wires up this alias from `config.experimental.extensionAlias` (`node_modules/next/dist/build/webpack-config.js:575`) — it isn't on by default. Fixed by adding `experimental: { extensionAlias: { ".js": [".ts", ".tsx", ".js"] } }` to `client/next.config.mjs`. If a "module not found" error names a real, correctly-spelled `.ts` file, suspect this config gap before suspecting a stale cache.

### 2026-09-01 — `noUncheckedIndexedAccess` (`tsconfig.json:8`) types `array[i]` in RTL tests as `T | undefined`, breaking `fireEvent.click(rows[0])`/`within(rows[0])`
`EvalOwnerDetail.test.tsx`'s `runRows()` returns `HTMLElement[]` via `.filter(...)`; every `rows[0]`/`rows[1]`/`rows[2]` passed straight into `fireEvent.click`/`within` failed typecheck because those APIs require a non-`undefined` `Element`. A prior `toHaveLength(n)` assertion earlier in the test does not narrow the type for TypeScript. Fixed with a small `getRow(rows, index)` helper that throws (with a useful message) if the index is out of bounds, then returns a narrowed `HTMLElement` — safer than a non-null assertion since it fails loudly if a fixture regresses instead of passing `undefined` silently into RTL. Same pattern applies to the `[prev[1], runId]` shape in `EvalOwnerDetail.tsx`'s `setSelected` callback — index into a same-invariant array inside a small guarded branch rather than asserting.

### 2026-09-01 — Sibling `next-intl` message groups with the same literal values create ambiguous RTL `getByText` queries across unrelated components on the same page
`messages/en/eval.json`'s `dashboard.legend.*` (`TrendChart`'s legend) and `dashboard.table.*` (`RecentRunsTable`'s column headers) both resolve to the literal strings `"Recall"`/`"Precision"`/`"Citation"` — harmless in isolation, but `EvalOwnerDetail` renders both trees on the same page, so `screen.getByText("Recall")` throws `Found multiple elements`. No accessible-role or text query can disambiguate identical text with no distinguishing role; fixed by adding `data-testid="trend-legend"` to `TrendChart.tsx`'s legend container and scoping the test query with `within(screen.getByTestId("trend-legend"))` — a justified exception to the project's accessible-query-first convention (see `react-testing-library` skill's query priority) when two real, meaningfully-different UI regions legitimately share exact copy.

## Session Notes

## Open Questions
