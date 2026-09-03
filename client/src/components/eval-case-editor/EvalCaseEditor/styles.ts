import type { CSSProperties } from "react";

/** Co-located styles for EvalCaseEditor (single-consumer tree — see
 *  `client/INSIGHTS.md` 2026-08-04 colocation rule). */
export const s = {
  body: { display: "flex", flexDirection: "column", gap: 20, padding: "20px 24px" } satisfies CSSProperties,
  // Custom, not `FormField` — `FormField`'s own 20px marginBottom can't be
  // dialed down (no style prop, and a flex item's margin doesn't collapse
  // with its children's, so a wrapper's negative margin traps rather than
  // cancels it — see ExpectedOutputEditor.tsx for the same lesson). `body`'s
  // own `gap: 20` already spaces this from the row below, so this field
  // needs none of its own.
  nameField: { marginBottom: 0 } satisfies CSSProperties,
  // Row layout so `CaseKindCallout` sits to the right of the Name field
  // (label + input) rather than inline with the label text itself — the
  // callout runs two lines (badge + description), taller than the label row.
  nameFieldRow: { display: "flex", gap: 16, alignItems: "flex-start" } satisfies CSSProperties,
  nameFieldMain: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  nameFieldLabel: {
    display: "flex",
    alignItems: "center",
    marginBottom: 8,
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  requiredMark: { color: "var(--crit)", marginLeft: 4 } satisfies CSSProperties,
  // Narrow (260, not the label row's full remaining width) and height-capped
  // via `caseKindCalloutDesc`'s 2-line clamp below — a long finding title
  // must never let this box outgrow the Name field beside it.
  caseKindCallout: {
    flexShrink: 0,
    width: 260,
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 5,
    padding: "8px 10px",
    borderRadius: 7,
    border: "1px solid",
  } satisfies CSSProperties,
  // Blue = positive (`must_find`) — same accent vocabulary as `CaseRow`'s
  // MUST_FIND badge (`eval-tab/EvalsTab/_components/CaseRow.tsx`).
  caseKindCalloutPositive: {
    borderColor: "var(--accent-text)",
    background: "var(--accent-bg)",
  } satisfies CSSProperties,
  // Amber = negative (`must_not_flag`) — deliberately not `--ok` green here:
  // this callout is a heads-up ("you're asserting an absence"), not a
  // pass/fail signal like `CaseRow`'s state icon.
  caseKindCalloutNegative: {
    borderColor: "var(--warn)",
    background: "var(--warn-bg)",
  } satisfies CSSProperties,
  // 2-line clamp with ellipsis — a long finding title (routinely 60+ chars)
  // must not push this box past the Name input's own height; the full text
  // is still reachable via the `title` attribute `CaseKindCallout` sets.
  caseKindCalloutDesc: {
    fontSize: 12,
    lineHeight: 1.4,
    color: "var(--text-secondary)",
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  } satisfies CSSProperties,
  columns: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 20,
    alignItems: "start",
  } satisfies CSSProperties,
  rightColumn: { display: "flex", flexDirection: "column" } satisfies CSSProperties,
  // Custom, not `FormField` — same reason as `nameField` above. `rightColumn`
  // has no `gap` of its own, so this exact 4px is the only thing separating
  // Expected from Actual output.
  expectedOutputField: { marginBottom: 4 } satisfies CSSProperties,
  expectedOutputLabelRow: { display: "flex", alignItems: "center", marginBottom: 8 } satisfies CSSProperties,
  expectedOutputLabel: { fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" } satisfies CSSProperties,
  expectedOutputBadge: { marginLeft: "auto" } satisfies CSSProperties,
  footer: { display: "flex", alignItems: "center", gap: 16 } satisfies CSSProperties,
  footerActions: { display: "flex", gap: 10, marginLeft: "auto" } satisfies CSSProperties,
  runOnSaveLabel: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  ownerRow: { display: "flex", gap: 10 } satisfies CSSProperties,
  ownerAlert: { fontSize: 12, color: "var(--crit)", marginTop: 8 } satisfies CSSProperties,
  inputTabsWrap: {
    borderRadius: 8,
    border: "1px solid var(--border)",
    overflow: "hidden",
  } satisfies CSSProperties,
  tabBody: { padding: 12, background: "var(--bg-surface)" } satisfies CSSProperties,
  metaWrap: { display: "flex", flexDirection: "column", gap: 4 } satisfies CSSProperties,
  metaPreview: {
    padding: "10px 12px",
    borderRadius: 7,
    border: "1px solid var(--border-strong)",
    background: "var(--bg-elevated)",
    minHeight: 180,
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  invalidNote: { fontSize: 12, color: "var(--crit)", marginTop: 8 } satisfies CSSProperties,
  // Manual FormField-alike (see ActualOutputViewer.tsx for why) — label row
  // styling mirrors `FormField`'s own so it reads as the same field type.
  actualOutputField: { display: "flex", flexDirection: "column" } satisfies CSSProperties,
  actualOutputLabel: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-secondary)",
    marginBottom: 8,
  } satisfies CSSProperties,
  actualOutput: {
    width: "100%",
    // Fixed (not flex/stretch — that let a long JSON result blow this box's
    // intrinsic size up, which then stretched the whole grid row and left
    // Input's own fixed-size textarea stranded with blank space beneath it).
    // Matches ExpectedOutputEditor's rows={7} textarea, so together the two
    // boxes read as one compact, evenly split column.
    height: 172,
    margin: 0,
    padding: "10px 12px",
    borderRadius: 7,
    border: "1px solid var(--border-strong)",
    background: "var(--bg-elevated)",
    fontSize: 14,
    lineHeight: 1.55,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    overflow: "auto",
  } satisfies CSSProperties,
  actualOutputEmpty: { color: "var(--text-muted)" } satisfies CSSProperties,
  actualOutputFilled: { color: "var(--text-primary)" } satisfies CSSProperties,
  runResult: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    padding: "10px 12px",
    borderRadius: 7,
    border: "1px solid var(--border)",
  } satisfies CSSProperties,
  runResultPass: { borderColor: "var(--ok)", background: "var(--ok-bg)" } satisfies CSSProperties,
  runResultFail: { borderColor: "var(--crit)", background: "var(--crit-bg)" } satisfies CSSProperties,
  runResultLabel: { fontSize: 13, fontWeight: 600, color: "var(--text-primary)" } satisfies CSSProperties,
  runResultSummary: { fontSize: 12.5, color: "var(--text-secondary)" } satisfies CSSProperties,
  // Brief post-save confirmation on the Save button (same green vocabulary as
  // FindingCard's Accept-active state) — a `Button` prop override, since
  // `kind="primary"`'s own styles don't react to app state on their own.
  saveSuccess: {
    background: "var(--ok-bg)",
    color: "var(--ok)",
    borderColor: "var(--ok)",
  } satisfies CSSProperties,
} as const;
