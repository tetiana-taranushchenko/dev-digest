# Development Plan: Blast Radius — Force-Directed Graph View

## Context

The Blast Radius feature shipped per `docs/plans/blast-radius.md` and works end to
end: `GET /pulls/:id/blast` → `usePrBlastRadius(prId)` → `BlastRadiusPanel` with a
Tree/Graph toggle. The "Graph" half, however, is deliberately not a graph — it is a
flat set of flex rows, documented as such at
`client/src/app/repos/[repoId]/pulls/[number]/_components/BlastRadiusPanel/_components/BlastGraph.tsx:5-7`
("Deliberately no graph-viz library — a flat set of rows is enough to show fan-out at
a glance without adding a new npm dependency"). This plan **reverses that specific
tradeoff** and replaces the flat rendering with a real interactive force-directed
node-link graph (`d3-force` physics, React-owned SVG, draggable nodes, colour-coded
node kinds). It is **client-only**: no server route, no `@devdigest/shared` contract
change, no new HTTP call.

## Requirements

- REQ-1: The "Graph" view renders a real force-directed node-link diagram — circular
  nodes positioned by a physics simulation, connected by thin edges, with a text
  label under each node, and nodes draggable with the pointer.
- REQ-2: **Additive, not a replacement of the accessible path.** The Tree view
  (`SymbolRow` + `CallerRow`, `aria-expanded`, real `<button>`/`MonoLink` elements)
  stays the **default** view and keeps its current behaviour byte-for-byte. It is what
  satisfies the homework acceptance criteria (clickable `file:line`, ≥2 callers, ≥1
  endpoint visible), so no task may change its markup or semantics.
- REQ-3: The force graph **replaces** the flat `BlastGraph` behind the existing
  `view: "tree" | "graph"` state. No third toggle option; `view.tree` / `view.graph`
  message keys (`client/messages/en/blast.json:9-12`) keep their current wording.
  `_components/BlastGraph.tsx` is deleted, and the one test that covers it
  (`BlastRadiusPanel.test.tsx:255-268`) is updated by the same task that deletes it.
- REQ-4: Clicking a **caller** node navigates exactly like `CallerRow` does today —
  through the existing `resolveCallerDestination()`
  (`BlastRadiusPanel/helpers.ts:26-49`), i.e. in-app `buildDiffLineRoute(...)` when the
  file *and line* are rendered in the PR diff, otherwise the GitHub blob URL. This is a
  hard functional requirement, not cosmetic. `resolveCallerDestination` is reused
  unchanged — it must not be forked or reimplemented.
- REQ-5: Node kinds are visually distinguished per the reference design: **violet** =
  changed symbol, **gray** = caller, **green** = endpoint, **amber** = cron/job, joined
  by thin edges, each with a label beneath it, plus an HTML (non-SVG) legend.
- REQ-6: Accessibility — the graph `<svg>` carries `role="img"` + `aria-label` +
  `<title>`/`<desc>` (a text alternative), the legend is real HTML text, and a visible
  hint points screen-reader/keyboard users at the Tree view. The graph does **not**
  claim keyboard operability; the Tree view is the accessible equivalent and stays the
  default (REQ-2).
- REQ-7: `state` handling (`loading` / `empty` / `partial` / `degraded`) is **not**
  duplicated in the graph. `BlastRadiusPanel.tsx:87-127` keeps owning it; the graph
  component only handles "the model produced zero nodes" (reusing the existing
  `graph.empty` key).
- REQ-8: **Zero** server, API-client, hook or contract work. The graph consumes the same
  `data` object from `usePrBlastRadius(prId)` (`client/src/lib/hooks/blast.ts:7-16`)
  that the Tree view already consumes.
- REQ-9: Node count is bounded by an explicit, documented constant with deterministic
  truncation and a visible "+N more nodes not shown" notice. No virtualization, no
  canvas, no web worker.
- REQ-10: Exactly one new direct runtime dependency (`d3-force`) plus one new dev
  dependency (`@types/d3-force`) in `client/package.json`. No other npm additions.

## Affected Modules & Contracts

- **client** only — `client/src/app/repos/[repoId]/pulls/[number]/_components/BlastRadiusPanel/**`,
  `client/messages/en/blast.json`, `client/package.json` + `client/pnpm-lock.yaml`,
  `client/README.md`.
- **server** — untouched.
- **reviewer-core** — untouched.
- **mcp-server** — untouched.
- **Contract changes in `@devdigest/shared`: none.** `BlastRadius`,
  `DownstreamImpact` and `BlastCaller`
  (`client/src/vendor/shared/contracts/brief.ts:68-118`) already carry everything the
  graph needs. `client/src/vendor/shared/` and `client/src/vendor/ui/` are do-not-touch
  (`client/AGENTS.md`) and **no task in this plan may edit either**.

## Architecture Notes

This is a frontend-only change, so the backend onion rings are not involved. The
governing skill is `react-frontend-architecture` (colocation + business-logic
placement) plus `react-best-practices`.

### Library decision — `d3-force` + React-owned SVG (recommended)

| Option | Verdict |
|---|---|
| **`d3-force` + hand-written SVG** ✅ | d3 computes physics only; React owns every DOM node. No `d3-selection`, no `d3-drag` — so d3 never mutates the DOM React is reconciling, which is the failure mode the "React + D3" split exists to avoid. We write ~150 lines of SVG. |
| `react-force-graph` | Renders to `<canvas>`/WebGL via `force-graph` + `kapsule` (and `three` for the 3D build). A canvas graph is invisible to `@testing-library/react` in jsdom, so the repo's whole RTL testing convention (`react-testing-library` skill) stops applying to this component. Much larger bundle. Rejected. |
| `@visx/network` | Render-only — it has **no** force layout, so we would add `d3-force` anyway *plus* visx. Strictly more dependencies for less control. Rejected. |
| `@xyflow/react` / `cytoscape` | Node-editor / full graph frameworks. No force layout out of the box (`@xyflow/react`) or a very large all-in-one runtime (`cytoscape`). Both are far past what a ~40-node diagram needs. Rejected. |

**Measured cost of `d3-force`** (verified on disk in this repo's
`client/node_modules/.pnpm`, UMD `.min.js` sizes):

| Package | minified |
|---|---|
| `d3-force@3.0.0` | 8,300 B |
| `d3-quadtree@3.0.1` | 5,279 B |
| `d3-timer@3.0.1` | 1,947 B |
| `d3-dispatch@3.0.1` | 1,901 B |
| **total** | **~17 KB min (~6 KB gzip)**, before tree-shaking of unused forces |

Crucially, **`d3-force@3.0.0` and `@types/d3-force@3.0.10` are already resolved in
`client/pnpm-lock.yaml`** (lines 1275 / 3410 and 956 / 3075) as transitive deps of
`mermaid@11.15.0 → d3@7.9.0`. Adding them as direct deps adds *importer* entries to the
lockfile, not new packages or new versions — so the "new npm dependency" the base plan
avoided is, in practice, already installed. It is however a genuinely new module in the
PR-detail route's bundle, because `mermaid` is only ever `await import()`-ed
(`client/src/components/mermaid-diagram/MermaidDiagram.tsx:36`) and therefore sits in a
lazy chunk. That ~6 KB gzip is the honest incremental cost, and this plan records the
tradeoff reversal explicitly rather than letting `BlastGraph.tsx:5-7`'s comment quietly
become false.

**Drag is implemented with React pointer events** (`onPointerDown` +
`setPointerCapture` + window `pointermove`/`pointerup`), *not* `d3-drag` — that keeps
`d3-selection` out of the tree and keeps every listener under React's control.

### Data volume — confirmed small enough for a client-side simulation

`MAX_CALLERS_PER_SYMBOL = 20` (`server/src/modules/repo-intel/constants.ts:30`) caps
callers **per changed symbol**, not overall, so total node count is *not* inherently
bounded — a PR touching 10 symbols can produce ~200 caller rows. Two mitigations:

1. Caller nodes are **deduplicated by `file:line` across all symbols**, so a shared
   helper called from one place by three changed symbols is one node with three edges.
   That fan-in is precisely what makes the graph more informative than the flat rows.
2. A hard `MAX_GRAPH_NODES` budget (120) with deterministic truncation and a visible
   notice (REQ-9). At ≤120 nodes a 300-tick `d3-force` settle is a few milliseconds and
   the SVG is ~120 `<circle>` + ~120 `<text>` + edges — no virtualization needed.

### Layout strategy (drives testability)

Run the simulation **synchronously on mount**: `simulation.stop()` then a fixed
`SIMULATION_TICKS = 300` `simulation.tick()` calls, so final positions exist before the
first paint. Consequences: no entry animation (good for `prefers-reduced-motion`), no
`requestAnimationFrame` dependency, and jsdom renders the settled graph immediately, so
RTL tests need no `waitFor`. Live physics is re-heated **only** while dragging
(`alphaTarget(0.3).restart()` + a `"tick"` listener), then released
(`alphaTarget(0)`).

The SVG uses a **fixed `viewBox` (880×460) with `preserveAspectRatio` and
`width: 100%`** rather than measuring the container. The simulation therefore runs in a
constant virtual coordinate space — no `ResizeObserver`, no `getBoundingClientRect`,
identical behaviour in jsdom and the browser. (`client/src/test/setup.ts:3-9` only stubs
`ResizeObserver` with no-op callbacks, so a measurement-based layout would silently
produce width 0 in tests.)

### Relevant Do-not-touch items

- `client/AGENTS.md` — `src/vendor/ui/` and `src/vendor/shared/` are do-not-touch. The
  design system has **no violet token** (`client/src/vendor/ui/styles.css:11-47`
  defines `--accent` blue, `--ok` green, `--warn` amber, `--info` gray). The violet for
  "Changed symbol" is therefore a **local literal in the graph's own `styles.ts`**, with
  a comment saying why; every other node colour reuses an existing CSS variable.
- Root `CLAUDE.md` — ESM: relative imports carry the `.js` extension **inside
  `vendor/shared`**; app code under `src/app/**` uses the extension-less style already
  present in `BlastRadiusPanel/**`. Match the surrounding files.

### Relevant INSIGHTS.md entries

- `client/INSIGHTS.md:21-22` (Codebase Patterns) — helpers used by more than one
  component tree belong in `client/src/lib/`; a helper used by exactly one tree stays
  colocated. The graph model is single-consumer → it stays inside
  `BlastRadiusPanel/_components/BlastForceGraph/`.
- `client/INSIGHTS.md` "Recurring Errors & Fixes", 2026-08-11 entry — `.js`-suffixed
  relative imports only resolve because of `experimental.extensionAlias` in
  `client/next.config.mjs:10-14`. Nothing in this plan changes that, but do not
  "helpfully" add `.js` suffixes to the new app-code imports.
- `client/INSIGHTS.md` 2026-08-06 (`overflowY: "auto"`) — if the graph wrapper ever
  needs scroll, set both axes explicitly. The fixed-`viewBox` decision above avoids
  needing scroll at all.

### Verified facts this plan depends on

- `BlastRadiusPanel.tsx:61` holds `view: "tree" | "graph"`; `:129-130` is the single
  call site of `BlastGraph`; `:87-127` owns loading / empty / partial / degraded
  (REQ-7's seam).
- `BlastRadiusPanel.tsx:100-109` early-returns on `state === "empty"`, so the graph is
  only ever mounted for `ok` / `partial` / `degraded`. `downstream` **can** still be
  empty in `partial`/`degraded`, so the graph must keep an empty branch.
- `helpers.ts:26-49` `resolveCallerDestination({ caller, files, repoId, prNumber,
  repoFullName, headSha })` returns `{kind:"in-app", route}` or `{kind:"external", url:
  string|null}` — the graph reuses it verbatim (REQ-4).
- `CallerRow.tsx:39-55` is the parity reference: in-app → `router.push(route)`;
  external → `MonoLink href`; no URL → plain text.
- `SymbolRow.tsx:57` — a symbol row's click **expands**, it does not navigate, and
  `DownstreamImpact` carries no line number for the declaring symbol
  (`brief.ts:90-100`). There is also no file-only diff route
  (`DiffTab/helpers.ts:12-14` requires a line). Therefore **symbol nodes select /
  highlight their subgraph rather than navigate** — that is parity with `SymbolRow`,
  and adding a file-only route would be scope creep into `DiffTab` + `page.tsx`.
- `client/messages/en/blast.json:36-39` already has `graph.empty` and
  `graph.ariaLabel`; both are reused.
- `client/package.json` has no `d3-*` direct dependency today; the package manager is
  **pnpm** (`client/pnpm-lock.yaml`) — `mcp-server`/`reviewer-core`/`e2e` use npm, this
  package does not.
- `client/README.md:9-13` lists the stack's notable libraries (`recharts`, `mermaid`,
  `react-markdown`) — that line is where `d3-force` gets recorded.

## Phases

### Phase 1: dependency, pure model, i18n (all three run in parallel)

| Task ID | Module | Type | Owned paths | Depends-on | Skills to use | Acceptance |
|---|---|---|---|---|---|---|
| G1 | client | build | `client/package.json`, `client/pnpm-lock.yaml` | — | typescript-expert | `cd client && pnpm add d3-force && pnpm add -D @types/d3-force`; then `pnpm list d3-force --depth 0` prints `d3-force 3.0.0` (not a newer major), `pnpm install --frozen-lockfile` exits 0, and `pnpm typecheck && pnpm test` are green |
| G2 | client | ui | `.../BlastRadiusPanel/_components/BlastForceGraph/graph-model.ts`, `.../BlastForceGraph/constants.ts`, `.../BlastForceGraph/graph-model.test.ts` | — | react-frontend-architecture, typescript-expert, react-testing-library | `cd client && pnpm exec vitest run src/app/repos/\[repoId\]/pulls/\[number\]/_components/BlastRadiusPanel` green with the 5 named cases below; `pnpm typecheck` exits 0 |
| G3 | client | ui | `client/messages/en/blast.json` | — | — | `cd client && pnpm test` green (existing `BlastRadiusPanel.test.tsx` imports this file directly at `BlastRadiusPanel.test.tsx:5`); `node -e "const m=require('./client/messages/en/blast.json'); ['description','truncated','a11yHint','legend'].forEach(k=>{if(!(k in m.graph))throw new Error(k)}); if(m.view.graph!=='graph')throw new Error('view.graph reworded')"` exits 0 |

**G1 notes.** Use **pnpm**, not npm — this package has `pnpm-lock.yaml`. `d3-force` goes
in `dependencies`, `@types/d3-force` in `devDependencies`. Both versions are already in
the lockfile via `mermaid → d3@7.9.0`, so `git diff --stat client/pnpm-lock.yaml`
should show only importer-section additions; if pnpm wants to add a *new* package
version, stop and report rather than pinning around it. Do not touch any other
package's lockfile.

**G2 notes** — `graph-model.ts` is a **pure module**: no React, no imports from
`@devdigest/ui`, no `next/*`.

```ts
export type BlastNodeKind = "symbol" | "caller" | "endpoint" | "cron";

export interface BlastGraphNode {
  id: string;            // `symbol:<file>#<name>` | `caller:<file>:<line>` | `endpoint:<v>` | `cron:<v>`
  kind: BlastNodeKind;
  label: string;         // display text, middle-ellipsised to MAX_LABEL_CHARS
  title: string;         // full untruncated text (feeds the SVG <title>)
  caller?: BlastCaller;  // present iff kind === "caller" — fed straight to resolveCallerDestination
  degree: number;        // edge count, used for deterministic truncation
}
export interface BlastGraphLink { source: string; target: string }
export interface BlastGraphModel {
  nodes: BlastGraphNode[];
  links: BlastGraphLink[];
  hiddenNodeCount: number;
}
export function buildBlastGraph(downstream: DownstreamImpact[]): BlastGraphModel;
```

Rules:

1. One symbol node per `downstream[]` entry, keyed `${impact.file}#${impact.symbol}`
   (the base plan already records that same-named symbols in two files can collide —
   keying on file avoids repeating that collapse here).
2. Caller nodes deduped by `${caller.file}:${caller.line}` **across all symbols**;
   endpoint nodes deduped by their string; cron nodes deduped by their string.
3. Links: symbol → caller, symbol → endpoint, symbol → cron. No caller → endpoint edges
   (the contract does not say which caller reaches which endpoint — inventing that edge
   would be a lie).
4. **Truncation to `MAX_GRAPH_NODES = 120`**, deterministic: keep every symbol node
   first, then callers, then endpoints, then crons; within each group sort by `degree`
   desc, then `id` asc. `hiddenNodeCount` = number dropped.
5. **Drop every link whose source or target was dropped.** This is load-bearing:
   `forceLink().id()` throws `Error: node not found: <id>` on a dangling link, which
   would blow up the whole panel.
6. Labels: `doThing()` for symbols, `path/to/file.ts:10` for callers, the raw string for
   endpoints/crons; middle-ellipsised at `MAX_LABEL_CHARS = 28` by an exported pure
   helper.
7. `constants.ts` holds `MAX_GRAPH_NODES`, `MAX_LABEL_CHARS`, `SIMULATION_TICKS = 300`,
   `VIEWBOX = { width: 880, height: 460 }`, `NODE_RADIUS` per kind, `LINK_DISTANCE`,
   `CHARGE_STRENGTH`, `DRAG_ALPHA_TARGET`. Do **not** re-declare
   `MAX_CALLERS_PER_SYMBOL` — that is server-side and already applied to the payload.

The 5 required `graph-model.test.ts` cases: (a) node ids/kinds/labels for one symbol
with a caller, an endpoint and a cron; (b) a caller at the same `file:line` under two
symbols yields **one** node with **two** links; (c) 200 callers across 10 symbols yields
exactly `MAX_GRAPH_NODES` nodes, all 10 symbol nodes retained, and the right
`hiddenNodeCount`; (d) no link in the output references an id absent from `nodes`;
(e) two calls on the same input produce identical node id order (determinism).

**G3 notes** — add to `messages/en/blast.json` under the existing `graph` object,
keeping `graph.empty` and `graph.ariaLabel` and every other key's wording untouched:

```jsonc
"graph": {
  "empty": "…existing…",
  "ariaLabel": "…existing…",
  "description": "Force-directed graph of {symbols} changed symbols, {callers} callers and {facts} affected endpoints or cron jobs.",
  "truncated": "+{count} more nodes not shown",
  "a11yHint": "Switch to the tree view for a keyboard-accessible list of the same data.",
  "legend": {
    "symbol": "Changed symbol",
    "caller": "Caller",
    "endpoint": "Endpoint",
    "cron": "Cron / job"
  }
}
```

Do not rename `view.graph` (REQ-3) and do not delete any existing key — `helpers.ts:55-63`
and `SymbolRow.tsx` still consume `reason.*`, `stat.*`, `showMore`, `showLess`.

### Phase 2: the graph component

| Task ID | Module | Type | Owned paths | Depends-on | Skills to use | Acceptance |
|---|---|---|---|---|---|---|
| G4 | client | ui | `.../BlastForceGraph/useForceLayout.ts`, `.../BlastForceGraph/BlastForceGraph.tsx`, `.../BlastForceGraph/styles.ts`, `.../BlastForceGraph/index.ts`, `.../BlastForceGraph/BlastForceGraph.test.tsx` | G1, G2, G3 | react-frontend-architecture, react-best-practices, react-testing-library, next-best-practices | `cd client && pnpm test && pnpm typecheck` green; `BlastForceGraph.test.tsx` passes the 4 named flows below; `grep -rn "d3-selection\|d3-drag\|from \"d3\"" client/src` returns no matches |

**G4 notes.**

`useForceLayout.ts` — a custom hook, all physics lives here (`react-best-practices`:
business logic out of component bodies):

```ts
useForceLayout(model: BlastGraphModel): {
  nodes: PositionedNode[];               // BlastGraphNode & { x: number; y: number }
  links: { source: PositionedNode; target: PositionedNode }[];
  draggingId: string | null;
  onNodePointerDown(id: string, e: React.PointerEvent): void;
}
```

Binding constraints:

- **Clone before simulating.** `d3-force` mutates node objects in place and
  `forceLink().id()` *rewrites* `link.source`/`link.target` from strings to node object
  references. Deep-copy `model.nodes`/`model.links` into simulation-local objects; never
  hand `buildBlastGraph`'s output arrays to d3.
- Forces: `forceLink(links).id(d => d.id).distance(LINK_DISTANCE)`,
  `forceManyBody().strength(CHARGE_STRENGTH)`,
  `forceCenter(VIEWBOX.width / 2, VIEWBOX.height / 2)`,
  `forceCollide(d => NODE_RADIUS[d.kind] + 6)`.
- Settle synchronously: `.stop()` then `for (let i = 0; i < SIMULATION_TICKS; i++) sim.tick()`.
  Then clamp every `x`/`y` into the viewBox minus a padding margin (exported pure
  `clampToViewBox` helper so it is unit-testable).
- Rebuild only when `model` identity changes (`useEffect` keyed on `model`); the caller
  memoises the model with `useMemo(() => buildBlastGraph(downstream), [downstream])`.
- Drag: `onPointerDown` → `e.currentTarget.setPointerCapture(e.pointerId)` + record id.
  Window-level `pointermove` / `pointerup` listeners registered in a `useEffect` **with
  cleanup**. Convert client → SVG coordinates via
  `svgRef.current?.getScreenCTM()?.inverse()`; **`getScreenCTM()` returns `null` in
  jsdom**, so guard it and no-op — dragging is therefore not unit-testable and is
  verified in the e2e follow-up (G7) instead. Document that in a comment.
- While dragging: set `node.fx`/`node.fy`, `sim.alphaTarget(DRAG_ALPHA_TARGET).restart()`,
  and push positions to React state from a `sim.on("tick", …)` listener. On
  `pointerup`: `sim.alphaTarget(0)` and clear `fx`/`fy`.
- Reduced motion: if `typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches`, skip the re-heat —
  just move the dragged node. **jsdom does not define `matchMedia`**, so the `typeof`
  guard is mandatory or every test throws.
- `useEffect` cleanup must call `sim.stop()` and remove the window listeners.

`BlastForceGraph.tsx` — `"use client"`, props
`{ downstream, files, repoId, prNumber, repoFullName, headSha }`. It calls
`useTranslations("blast")` itself (same as `SymbolRow.tsx:38` / `CallerRow`), so the
panel no longer threads `emptyLabel`/`ariaLabel` through props. Rendering:

- `model.nodes.length === 0` → `<p>{t("graph.empty")}</p>` and nothing else (REQ-7:
  loading/partial/degraded stay in the panel).
- `<svg role="img" aria-label={t("graph.ariaLabel")} viewBox="0 0 880 460"
  preserveAspectRatio="xMidYMid meet" style={{ width: "100%", height: "auto" }}>`
  containing `<title>{t("graph.ariaLabel")}</title>` and
  `<desc>{t("graph.description", { symbols, callers, facts })}</desc>` (REQ-6).
- Edges first (`<line stroke="var(--border-strong)" strokeWidth={1}>`), then one `<g>`
  per node with a `<circle>` and a `<text textAnchor="middle" dy={r + 13}>` label
  (REQ-1/REQ-5). Colours from a local `NODE_COLORS` map in the graph's own `styles.ts`:
  symbol `#8b5cf6` (violet literal — see Do-not-touch note above), caller
  `var(--info)`, endpoint `var(--ok)`, cron `var(--warn)`.
- Click behaviour (REQ-4). Caller node: `const dest = resolveCallerDestination({ caller:
  node.caller!, files, repoId, prNumber, repoFullName, headSha })` — imported from
  `../../helpers`, not reimplemented — then `dest.kind === "in-app" ?
  router.push(dest.route) : dest.url && window.open(dest.url, "_blank",
  "noopener,noreferrer")`. Symbol node: toggles `selectedId` (its own subgraph stays at
  full opacity, everything else drops to `0.25`). Endpoint/cron nodes: selection only,
  no navigation.
- Below the SVG: the HTML legend (`<ul>` of coloured dot + `t("graph.legend.*")`, cron
  entry rendered only when a cron node exists), `t("graph.a11yHint")`, and — when
  `model.hiddenNodeCount > 0` — `t("graph.truncated", { count: model.hiddenNodeCount })`.
- No `useMemo`/`useCallback` beyond the model memo unless something measurably needs it
  (`react-best-practices`).

Required `BlastForceGraph.test.tsx` flows (RTL, `NextIntlClientProvider` + a mocked
`next/navigation` `useRouter`, mirroring `BlastRadiusPanel.test.tsx:1-23`):

1. **Renders the graph and its text alternative** — `getByRole("img", { name: "Blast
   radius graph" })` exists; `getByText("doThing()")`, `getByText("src/consumer.ts:10")`
   and `getByText("GET /api/public/items")` are present; the legend labels "Changed
   symbol" / "Caller" / "Endpoint" and the tree-view hint all render.
2. **Caller click, both branches** — a caller whose file+line is covered by a rendered
   patch hunk calls `router.push` with
   `buildDiffLineRoute(repoId, prNumber, file, line)`; a caller not in the diff calls a
   spied `window.open` with `githubBlobUrl(...)`. Assert on the exact strings.
3. **Empty model** — `downstream: []` renders `t("graph.empty")` and no `role="img"`.
4. **Truncation notice** — a fixture exceeding `MAX_GRAPH_NODES` renders "+N more nodes
   not shown" with the correct N.

Assert on visible labels and roles, never on `container.querySelector` counts — SVG
shapes carry no implicit role, so node labels (which are real `<text>`) are the
user-visible thing to test.

### Phase 3: wire it in and delete the flat graph

| Task ID | Module | Type | Owned paths | Depends-on | Skills to use | Acceptance |
|---|---|---|---|---|---|---|
| G5 | client | ui | `.../BlastRadiusPanel/BlastRadiusPanel.tsx`, `.../BlastRadiusPanel/styles.ts`, `.../BlastRadiusPanel/BlastRadiusPanel.test.tsx`, `.../BlastRadiusPanel/_components/BlastGraph.tsx` *(deleted)* | G4 | react-frontend-architecture, react-best-practices, react-testing-library | `cd client && pnpm test && pnpm typecheck` green; `git status` shows `_components/BlastGraph.tsx` deleted; `grep -rn "BlastGraph" client/src` returns no matches; `BlastRadiusPanel.test.tsx` still asserts tree-is-default and that toggling to "graph" reveals `role="img"` name "Blast radius graph" |

**G5 notes.**

- Swap `BlastRadiusPanel.tsx:129-130` to render `<BlastForceGraph downstream={data.downstream}
  files={files} repoId={repoId} prNumber={prNumber} repoFullName={repoFullName}
  headSha={headSha} />`. Everything above it (`:87-127`: loading skeleton, `empty`
  early-return, the `role="status"` partial/degraded notice, `BlastStatsRow`) stays
  **exactly** as-is — that is REQ-7.
- `view` state, both toggle buttons, `aria-pressed`, and `useState<"tree" | "graph">`
  are unchanged (REQ-3). Tree remains the initial value (REQ-2).
- Delete `_components/BlastGraph.tsx` and remove the now-dead `graphWrap`, `graphRow`,
  `graphArrow`, `graphSymbol`, `graphCallers`, `graphCaller`, `graphEmpty` entries from
  `BlastRadiusPanel/styles.ts:120-127`. **Careful:** `SymbolRow.tsx:81` uses the
  *message key* `t("graph.empty")` (not the style) and `s.noDownstream` — neither may be
  removed. Verify with `grep -n "graphEmpty\|noDownstream" client/src` before deleting.
- Do not touch `SymbolRow.tsx`, `CallerRow.tsx`, `helpers.ts`, `helpers.test.ts`,
  `index.ts` or `OverviewTab.tsx` — the panel's public props are unchanged, so
  `OverviewTab.tsx:25-32` needs no edit.
- Test updates: the existing toggle test (`BlastRadiusPanel.test.tsx:255-268`) should
  still pass unchanged — the force graph keeps `role="img"` + `aria-label="Blast radius
  graph"` and still renders the `doThing()` label. Confirm it does; if any assertion
  depended on flat-row markup, update *that assertion only*. Add one new test: the panel
  mounts in tree view by default (`aria-pressed="true"` on "tree", no `role="img"`
  present) and, after clicking "graph", renders the tree-view a11y hint.

### Phase 4: docs and follow-ups

| Task ID | Module | Type | Owned paths | Depends-on | Skills to use | Acceptance |
|---|---|---|---|---|---|---|
| G6 | docs | docs | `client/README.md` | G5 | — | The Stack bullet at `client/README.md:9-13` lists `d3-force` alongside `recharts`/`mermaid`, with a half-sentence saying it powers the Blast Radius graph layout only (physics, not DOM). No other README claim changes. Hand this to the `doc-writer` agent, not `implementer`. |
| G7 | e2e | e2e | `e2e/**` | G5 | — | **Follow-up, not for `implementer`.** Deterministic locators only (no AI/`chat` locator): open a seeded PR's Overview tab, click the "graph" toggle, assert a node label is visible, drag a node and assert it moved, click a caller node and assert the Diff tab scrolled to that line. Covers the drag path that jsdom cannot (`getScreenCTM()` is null there). |

## Dependency graph

```
G1 ─┐
G2 ─┼─► G4 ─► G5 ─┬─► G6
G3 ─┘             └─► G7
```

G1, G2 and G3 own disjoint paths with no edges between them → safe to run as three
parallel `implementer` instances. G4 and G5 are strictly sequential after them.

## Testing Strategy

- client: `cd client && pnpm test && pnpm typecheck`
- Scoped run while iterating:
  `cd client && pnpm exec vitest run src/app/repos/\[repoId\]/pulls/\[number\]/_components/BlastRadiusPanel`
- server / reviewer-core / mcp-server: **not run by this plan's tasks** — no file in
  those packages is touched. Run `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'`
  once at the end only as a paranoia check that nothing leaked.
- New tests exist only where a task's Acceptance requires them: `graph-model.test.ts`
  (G2), `BlastForceGraph.test.tsx` (G4), one added case in `BlastRadiusPanel.test.tsx`
  (G5).
- No `.it.test.ts` files are involved — this plan touches no database and no server
  route.

## Requirement → Acceptance map

| Requirement | Proven by |
|---|---|
| REQ-1 force-directed SVG graph | G4 test 1 + G4's `grep` check that no d3 DOM package is imported |
| REQ-2 tree stays default & unchanged | G5's new default-view test; G5 owns no tree-component path |
| REQ-3 replaces flat graph behind the same toggle | G5 acceptance (`grep -rn "BlastGraph"` empty, toggle test still green) |
| REQ-4 caller click parity | G4 test 2 (both in-app and GitHub branches) + G7 e2e |
| REQ-5 node colours / labels / edges / drag | G4 test 1 (labels + legend); drag by G7 |
| REQ-6 a11y text alternative + hint | G4 test 1 (`role="img"` accessible name, legend text, hint) |
| REQ-7 state handling not duplicated | G5 owns the panel; graph has only an empty branch (G4 test 3) |
| REQ-8 no server/contract work | No task owns a path outside `client/` |
| REQ-9 bounded node count | G2 case (c) + G4 test 4 |
| REQ-10 exactly one runtime dep | G1 acceptance (`pnpm list d3-force --depth 0`) + `git diff client/package.json` |

## Risks & Mitigations

- **d3 mutates what you hand it.** `forceSimulation` writes `x/y/vx/vy/index` onto node
  objects and `forceLink().id()` swaps link endpoint strings for object references —
  passing `buildBlastGraph`'s output straight in would corrupt the memoised model and
  make re-renders non-idempotent. Mitigation: G4's binding constraint to clone first.
- **Dangling links crash the panel.** `forceLink().id()` throws `node not found: <id>`
  if truncation drops a node an edge still points at. Mitigation: G2 rule 5 plus test
  case (d).
- **jsdom gaps.** `getScreenCTM()` returns `null` and `window.matchMedia` is undefined.
  Unguarded, either throws inside every RTL test. Mitigation: explicit guards in G4;
  drag coverage deferred to G7 e2e rather than faked.
- **Reversing the base plan's "no graph-viz library" decision.** `BlastGraph.tsx:5-7`
  documents that choice; leaving it deleted-but-unexplained would make the codebase's
  history misleading. Mitigation: this plan states the reversal, G6 records `d3-force`
  in `client/README.md`, and the cost is quantified above (~6 KB gzip, version already
  in the lockfile).
- **Removing behaviour needs matching test updates.** The flat graph's only coverage is
  `BlastRadiusPanel.test.tsx:255-268`; there is no `BlastGraph.test.tsx`. Mitigation: G5
  owns both the deletion and that test file, so the two can never diverge.
- **A hub PR could still produce a hairball.** 120 nodes is readable but busy.
  Mitigation: symbol-node selection dims the rest of the graph, caller nodes dedupe by
  `file:line`, and the truncation notice makes the cut honest rather than silent. If it
  still reads badly on a real PR, tighten `MAX_GRAPH_NODES` in `constants.ts` — a
  one-line change, no restructuring.
- **The graph is not keyboard-operable.** Accepted and recorded, not hidden: the Tree
  view is the default and is fully keyboard/screen-reader accessible, the SVG carries a
  proper text alternative, and `graph.a11yHint` tells users where to go. Revisit only if
  the graph ever becomes the default view.
- **Wrong package manager.** `client` is pnpm; `mcp-server`/`reviewer-core`/`e2e` are
  npm. Running `npm install` in `client/` would create a stray `package-lock.json`.
  Mitigation: G1's acceptance commands are pnpm-only.

## Out of Scope

Architecture review and security review are performed by separate reviewer
agents/skills (the `security` skill, `pr-self-review`, code-review) — not by `planner`
or `implementer`. Also out of scope: any server, `@devdigest/shared`, `reviewer-core` or
`mcp-server` change; a file-only (line-less) diff route for symbol-node navigation; a
second locale for the new message keys (`messages/en/` only, matching the rest of the
repo); zoom/pan controls; and persisting graph layout between visits.
