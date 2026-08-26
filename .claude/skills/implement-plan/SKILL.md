---
name: implement-plan
description: Executes an existing implementation-planner Development Plan (docs/plans/**) end to end — implementer(s) per phase (parallel when the plan's Execution Mode is multi-agent), then architecture-reviewer and plan-verifier in parallel, then a bounded iterative fix loop (max-fix rounds, default 3) that maps each finding back to its owning task's Owned paths before fixing, re-checks only what previously failed, and breaks early as "stuck" if the backlog stops shrinking, then one full plan-verifier regression check before doc-writer, reported in a fixed structured template. Does not create the plan — run spec-creator and implementation-planner manually first, this skill only starts once a plan file already exists. test-writer is temporarily excluded from this flow to save tokens; run it by hand when a task's Acceptance genuinely names a new test. Use when the user runs /implement-plan plan:<path> [mode:multi|single] [max-fix:<n>], or asks to "implement the plan", "execute this Development Plan", "run implementer on this plan".
version: 0.5.0
---

# Implement Plan

Runs the **execution half** of this repo's Spec-Driven-Development pipeline —
everything that happens *after* a Development Plan already exists.

```
spec-creator → implementation-planner        [invoked manually by the user —
                        │                      NOT part of this skill]
                        ▼
        ┌────────────── implement-plan (this skill) ──────────────┐
        │  implementer(s) per phase                                │
        │       → architecture-reviewer ∥ plan-verifier (parallel) │
        │       → bounded fix loop (max-fix rounds)                │
        │       → doc-writer (only if final verdict is COMPLETE)   │
        └───────────────────────────────────────────────────────────┘
```

**`test-writer` is currently skipped** from this flow — a deliberate
cost decision (Opus/Sonnet agent-hours add up fast on a course budget). Run
`test-writer` yourself, standalone, for any task whose Acceptance criterion
genuinely names a new test.

## Invocation

```
/implement-plan plan:<path-to-plan> [mode:multi|single] [max-fix:<n>]
```

- `plan:` — required. A path under `docs/plans/**`. If omitted, `Glob` for
  `docs/plans/*.md`, list the candidates with mtime, and ask which one if
  there's more than one recent match — never guess.
- `mode:` — optional. Overrides the plan's own `Execution Mode` section for
  this run only (e.g. force `single` on a plan marked multi-agent, if the
  user wants a slower but simpler pass). Defaults to whatever the plan file
  says.
- `max-fix:` — optional. Caps how many rounds the fix loop (Step 4) may run.
  Default **3**. `max-fix:0` disables the loop entirely — Step 3's findings
  go straight into the report, unfixed.

## Process

**Step 1 — Read the plan.** Read the plan file in full. Extract, verbatim,
into your own working notes: `Execution Mode` (unless overridden by
`mode:`), every phase's task table (`Task ID`, `Owned paths`, `Depends-on`,
`Skills to use`, `Acceptance`), and `Testing Strategy`. Do not paraphrase
these — you carry them into every step below and into each sub-agent's
brief.

Before touching anything: run `git rev-parse HEAD` and save the result as
`baseline_head` — this run's own starting point, not the branch's
merge-base with `main`. Then run `git status --short`; if any file under
the union of this plan's `Owned paths` already shows modified or untracked,
stop and ask the user how to proceed instead of mixing pre-existing,
unrelated changes into this run's review scope. Using the branch's
merge-base instead of `baseline_head` would pull in whatever was already on
the branch before this run started — the review would then cover work this
run didn't do.

**Step 2 — Execute phases, in order.** For each phase, in the order it
appears in the plan:
- Split its tasks into ready-batches: a task is ready once every task ID
  named in its `Depends-on` has completed — either in a prior batch of this
  same phase, or in an earlier phase entirely (already guaranteed done: the
  next phase never starts until every task in the previous phase has
  reported back, per the rule below).
- **Multi-agent mode:** within one ready-batch, tasks with disjoint `Owned
  paths` and no dependency edge between them are spawned as parallel
  `implementer` sub-agents — one message, multiple `Agent` calls, never one
  at a time. A task that shares a path with another, or depends on one still
  running, waits for the next batch instead.
- **Single-agent mode:** ignore batching — run every task sequentially, one
  `implementer` call per task ID, in the plan's listed order.
- Brief each `implementer` call with exactly: the task ID, its `Owned
  paths`, `Depends-on`, `Skills to use`, `Acceptance`, and the plan's file
  path (the sub-agent re-reads its own row from there — the brief just
  points it at the right file and task ID, it doesn't re-explain the whole
  plan).
- Do not start the next phase until every task in the current phase has
  reported back — a later phase may depend on contracts an earlier phase
  just introduced.
- If any `implementer` reports a deviation, a missing file, or a mismatch
  between the plan and the actual code, stop and surface it to the user
  before continuing. Don't improvise past a discrepancy.

**Step 3 — Review, in parallel.** Once every phase has completed, spawn
**both** in one message (two `Agent` calls, not sequential):
- `architecture-reviewer`, scoped to
  `git diff <baseline_head> -- <union of this run's task Owned paths>`
  — this run's own changes only, never a whole-repo audit and never
  whatever else happened to already be on the branch before `baseline_head`.
- `plan-verifier`, against the plan file and the current branch — its full
  enumeration, every `REQ-n` and every task row, exactly as it always does.
  Brief it to use `baseline_head` (not its default merge-base) as the
  comparison point for its owned-path check specifically — same reasoning
  as above: with merge-base, a pre-existing, unrelated change already on
  the branch (something the user edited by hand before this run, touching
  no task's `Owned paths`) would show up in the diff and get reported as a
  false "changed outside all declared Owned paths" deviation, even though
  this run never touched it.

Neither depends on the other's output, so there is no reason to stage them —
this is the main saving over running them sequentially.

**Step 4 — Bounded fix loop.** Round counter `r` starts at 1. Keep the
previous round's fix-target set (`file:line`/`REQ`-or-task-id, one identity
per target) to compare against — start it empty.

1. Collect this round's fix targets: `architecture-reviewer`'s `CRITICAL`/
   `HIGH` findings, plus `plan-verifier`'s `FAIL`/`PARTIAL` rows. (`MEDIUM`
   findings and `NOT-VERIFIABLE` rows are never fix targets — they go
   straight into the final report.)
2. **Recompute the backlog:**
   - Empty → exit the loop now — go to Step 5, which decides whether this
     round's `plan-verifier` verdict already is the final one or needs one
     more full check. Loop status: `resolved`.
   - Non-empty, but **identical to the previous round's set** (same
     `file:line`/id's, nothing dropped since the last fix attempt) → exit
     the loop now, even if `r < max-fix`. Loop status: `stuck — no progress
     since round <r-1>`, listed for a human decision. Don't spend further
     rounds retrying a fix that visibly isn't landing.
   - `r > max-fix` → exit the loop. Loop status: `exhausted max-fix`, listed
     for a human decision.
   - Otherwise (non-empty, changed from last round, `r <= max-fix`) →
     continue to step 3 below.
3. **Resolve each fix target to the plan task that owns it**, then spawn one
   `implementer` fix-pass per distinct **task** — briefed the same way as
   Step 2 (`Task ID`, `Owned paths`, `Depends-on`, `Skills to use`,
   `Acceptance`, all from Step 1's notes) plus the specific gap to close.
   `implementer` only ever works inside a task's declared `Owned paths`
   (`implementer.md`, Boundaries) — a bare `file:line` is not a valid brief
   on its own:
   - A `plan-verifier` `FAIL`/`PARTIAL` row already names its task directly
     — use that task's own row.
   - An `architecture-reviewer` finding names a `file:line`, not a task —
     look up which task's `Owned paths` contains that file, from Step 1's
     data, and brief that task's owner with the finding as the gap to close.
   - If a finding's file falls under no task's `Owned paths` at all (a
     shared file nobody claimed, or a do-not-touch violation), do not
     invent an owner: surface it to the user instead of guessing.
   - Group multiple targets that resolve to the same task into one
     `implementer` call, not one call per finding.
4. Re-run **only against the files touched by this round's fixes** (not a
   full re-audit / full re-enumeration):
   - `architecture-reviewer` re-checks just those files for the specific
     findings raised, plus anything the fix itself might have introduced.
   - `plan-verifier` re-checks only the `REQ`/task rows that were `FAIL`/
     `PARTIAL` last round — rows that already `PASS`ed in the very first
     Step 3 pass are carried forward unchanged here, never re-derived
     twice **within the loop** (Step 5 below still re-checks them all once).
5. Save this round's fix-target set as "previous", increment `r`, go back to
   step 1.

Any exit whose loop status is `stuck` or `exhausted max-fix` produces an
`INCOMPLETE` verdict regardless of what `plan-verifier`'s own last line
said — open fix targets remain either way.

**Step 5 — Final verification gate (regression check).** If Step 4 exited
with loop status `resolved` **and at least one fix round actually ran**
(`r > 1`), run one more `plan-verifier` pass — this time its **full
enumeration**, not scoped to previously-failing rows only. A fix made
during the loop could touch code a different, already-`PASS`ing
requirement also depends on; the loop's own re-checks (Step 4.4)
deliberately skip re-deriving those rows for efficiency, so this is the one
point that actually confirms nothing regressed. This pass's verdict is the
true final verdict, overriding the loop's own last line. Skip this extra
call only if Step 4 never needed a single fix round (`r` stayed at 1 with
an empty backlog from the start) — in that case Step 3's original
`plan-verifier` pass already is the untouched, full, final check.

**Step 6 — Docs.** Only if the final verdict (Step 5's re-check when it
ran, otherwise Step 3's original pass) is `COMPLETE` **and** Step 4's loop
status is `resolved`, spawn `doc-writer` with the plan file as its input
material. Otherwise skip this step and report the gaps instead — never
document a feature that isn't actually finished.

## Output

Use exactly this structure — it's built to be skimmed, not read as prose:

```
## Implement Plan — <plan title, from the plan file's own heading>

- Plan: `docs/plans/<slug>.md` — mode: multi-agent | single-agent
- Implemented: <N> tasks (T1…Tn) — <one-line summary per phase>
- Self-verify: module suites + typecheck green | failing (<detail>)

### Review gate
- architecture-reviewer (sonnet): clean | <n> CRITICAL, <n> HIGH, <n> MEDIUM open
- plan-verifier (sonnet): COMPLETE | INCOMPLETE — <n> PASS / <n> FAIL / <n> PARTIAL / <n> NOT-VERIFIABLE
  (from: Step 3's original pass | Step 5's post-fix full re-check)

### Fix loop
- iterations run: <r> / <max-fix>
- resolved: <targets fixed, one line each — or "none needed">
- remaining (needs human decision): <list — or "none">
- status: resolved | stuck since round <r> | exhausted max-fix

### test-writer
Not run this pass.

### Next step
[plan-verifier verdict COMPLETE and loop resolved] → run `/pr-self-review` before opening a PR.
[otherwise] → resolve the "remaining" items above, then re-run this skill.
```

Note the `architecture-reviewer` line reports **findings by severity, not a
verdict** — that agent never emits PASS/FAIL itself (it's strictly a
reporter, per its own hard rules), so "clean" here means the skill counted
zero CRITICAL/HIGH after the loop, not that the sub-agent said so. The
`plan-verifier` line, by contrast, quotes that agent's own verdict verbatim
— `COMPLETE`/`INCOMPLETE` is its real vocabulary.

## What this skill does NOT do

- **Does not create a spec or a plan.** `spec-creator` and
  `implementation-planner` are invoked directly by the user, standalone,
  before this skill starts — see `.claude/agents/README.md`.
- **Does not run `test-writer`** — temporarily excluded to save tokens; run
  it by hand.
- **Does not push, commit, or open a PR.** That's `pr-self-review` and the
  user's own call, after this skill's report looks good.
- **Does not loop past `max-fix` rounds**, and **does not keep retrying a fix
  that isn't landing** — an unchanged backlog two rounds in a row stops the
  loop early as `stuck`, before the cap. Either way, open targets are a
  human decision, reported as `INCOMPLETE`, never silently retried forever.
