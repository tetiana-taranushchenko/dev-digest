---
name: engineering-insights
description: Captures durable engineering knowledge for this repo — a pattern that worked, an antipattern/dead-end, a non-obvious codebase convention, a tool/library gotcha, a recurring error and its fix, or an open question — as a dated entry in the touched package's INSIGHTS.md (client/, server/, reviewer-core/, or e2e/). Use at the end of a session that did substantive, non-trivial work in a package, or when the user runs /engineering-insights. Do not use for trivial one-line fixes, or when nothing new beyond what INSIGHTS.md already documents was actually learned — in that case take no action.
---

# Engineering Insights

- **Dedup check first:** re-read the target `INSIGHTS.md` in full before writing anything; if this finding (or an equivalent one) is already recorded, stop — do not duplicate it.
- **No filler:** only write when something non-obvious, new, and evidence-backed happened — a file:line, a command, or an exact error message, plus an actionable takeaway. A trivial fix or a restatement of what the code already says doesn't qualify. If nothing qualifies, write nothing, even at session end.
- **Target:** the INSIGHTS.md of the package the finding came from — `client/INSIGHTS.md`, `server/INSIGHTS.md`, `reviewer-core/INSIGHTS.md`, or `e2e/INSIGHTS.md`. If a task touched multiple packages, write one entry per affected package, each in its own file — never cross-post a finding into another package's file.
- **Sections (fixed, in this order):** What Works, What Doesn't Work, Codebase Patterns, Tool & Library Notes, Recurring Errors & Fixes, Session Notes, Open Questions. All four INSIGHTS.md files are currently placeholder stubs with no sections — the first time you write to one, add all 7 as `##` headings in this order, then append the entry under the matching one.
- **Entry format:**
  ```
  ### YYYY-MM-DD — <one-line summary>
  <1-3 sentences: the concrete evidence (file:line / command / error text) and the actionable takeaway.>
  ```
  Vague (skip this): "Promises can be tricky." Actionable (write this): "`Promise.all()` on the ingest pipeline times out after 30 items — switch to `Promise.allSettled()` batched by 10 (see `server/src/ingest.ts:42`)."
- **Append-only:** never rewrite or delete an existing entry. If new information corrects or supersedes an old one, add a new dated entry that references the old one instead.
