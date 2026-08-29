---
name: workflow-retro
description: Captures a retrospective of a just-finished multi-subagent stretch of this session — which of this repo's custom Claude Code subagents (.claude/agents/*.md) ran, in what order and at what depth (including a subagent's own nested children), with real per-agent token/cache/cost/tool-call/timing figures extracted from each agent's own transcript via jq (not an estimate), what came easily, what was hard, what got duplicated across agents (or with the orchestrator's own work), where the user had to intervene or correct course, and one concrete recommendation for next time. Appends the detailed report to .claude/agents/WORKFLOW_INSIGHTS.md and a compact trend row to docs/retros/ledger.md. MANUAL ONLY — invoke exactly when the user runs /workflow-retro. Never invoke this proactively or automatically at the end of a session on your own judgment, and never wire it to a hook — the user has explicitly opted for manual-only invocation, at least for now.
---

# Workflow Retro

A retrospective on how this repo's own dev-tooling — the custom subagents in
`.claude/agents/*.md`, chained either by hand or via the `Workflow` tool —
actually performed in the stretch of session just completed. This is about
the *tooling*, not the product: it never touches a package's `INSIGHTS.md`
(that's [`engineering-insights`](../engineering-insights/SKILL.md)'s job —
durable knowledge about the codebase, not about how the agents behaved).

**Manual only.** This skill runs exactly when the user types `/workflow-retro`.
Do not run it proactively, do not suggest wiring it to a Stop hook, and do not
treat "we just finished a multi-agent stretch" as a reason to invoke it
yourself — the user has explicitly chosen manual-only invocation.

## Scope check

Before doing anything, confirm the stretch of session being retro'd actually
chained **two or more** subagent calls (`Agent` tool calls with a
non-`fork`/non-`claude` `subagent_type`, and/or a `Workflow` run). If the
user runs `/workflow-retro` after a session with zero or one subagent call,
say so and stop — there's nothing to retrospect.

## Process

**Step 1 — Reconstruct the agent timeline (real data, not memory).** Every
subagent this session ever spawned — including one subagent spawning its own
children (`Agent`-tool-capable agents like `spec-creator` can) — has a real
transcript on disk, whether or not the stretch used the `Workflow` tool:

```
~/.claude/projects/<project-slug>/<session-id>/subagents/agent-<agentId>.jsonl        (full transcript, can be 100s of KB — do not Read directly)
~/.claude/projects/<project-slug>/<session-id>/subagents/agent-<agentId>.meta.json    (tiny — safe to Read/cat directly)
```

`<session-id>` is this conversation's own session (the directory the
`output_file` path an `Agent` call result gives you resolves through, or
the same one `.claude/skills/`'s own memory system uses for this project).
For every subagent you directly spawned in the stretch, `cat` its
`.meta.json` (small, ~150 bytes: `agentType`, `description`,
`parentAgentId`, `spawnDepth`, `isFork`). Then list the whole `subagents/`
directory and filter for any `.meta.json` whose `parentAgentId` matches one
of your own agent ids — those are children a subagent spawned on its own
(`spawnDepth: 2`+), invisible to you otherwise. Recurse until no new
`parentAgentId` matches turn up. Build the timeline from this — real
`agentType`/`depth`/parent-child structure, not recollection. If the stretch
used `Workflow`, also read that run's `journal.jsonl` for its own call
sequence and merge it in the same way.

**Step 2 — Real per-agent cost, extracted via `jq` (never via `Read`).**
Per-agent token/cost data is NOT approximate — it's sitting in each agent's
own `.jsonl`, one usage object per assistant turn. Extract only the numeric
fields, never the message text, with `jq` through `Bash` (a raw `Read` of
the file dumps the entire transcript's prose into your context — don't):

```bash
jq -s '[.[] | select(.message.usage != null) | .message.usage] as $u | {
  input: ($u | map(.input_tokens // 0) | add),
  output: ($u | map(.output_tokens // 0) | add),
  cache_creation: ($u | map(.cache_creation_input_tokens // 0) | add),
  cache_read: ($u | map(.cache_read_input_tokens // 0) | add)
}' agent-<id>.jsonl
jq -c '[.message.content[]? | select(.type=="tool_use") | .name] | .[]' agent-<id>.jsonl | sort | uniq -c
jq -r 'select(.message.model != null) | .message.model' agent-<id>.jsonl | sort -u
jq -r '.timestamp' agent-<id>.jsonl | sort | sed -n '1p;$p'    # span: first, last
jq -c 'select(.isApiErrorMessage==true or .error != null) | {error: (.error // .message.content), ts: .timestamp}' agent-<id>.jsonl   # crash cause, if any
```

Cost per agent = `input_tokens × base_input_price + output_tokens ×
output_price + cache_creation_input_tokens × (base_input_price × 1.25) +
cache_read_input_tokens × (base_input_price × 0.1)` (standard Anthropic
prompt-caching multipliers: 5-min cache write = 1.25×, cache read = 0.1× —
confirm against the `claude-api` skill if a cache-write entry's
`ephemeral_1h_input_tokens` is non-zero, since 1-hour writes price at 2×
instead). **Get current per-model base input/output prices from the
`claude-api` skill (`Skill({skill: "claude-api"})`) at retro time — never
hardcode a price table here, rates change.**

Report the whole table: agent id (short), role/type, depth, in, out,
cache-read, cache-hit% (`cache_read / (cache_read + cache_creation +
input)`), tool-call count, span (seconds), cost ($) — plus totals, launch
order, and a critical path (the longest sequential chain of agent spans;
agents nested inside a parent's own span, like a parallel fan-out, don't
add to it) with a parallelism factor (`sum of every agent's own span ÷
critical path`).

If a transcript file is missing or unreadable (rare — e.g. a very old
session already garbage-collected), fall back to labeling that agent's
figures `≈` and say why, rather than blocking the whole retro on one
missing file.

**Step 3 — Per-agent insight pass.** For each agent, from its own final
report (already in your context — you received it) plus whatever Step 1/2's
`jq` extraction already surfaced (an error marker, an unusually high tool
count, an outsized span relative to its peers):
- What it flagged as a blocker, an ambiguity it had to ask about, or
  something it couldn't verify.
- What it explicitly did cleanly / fast / without friction.
Numeric metadata (usage, tool names, timestamps, error markers) is cheap to
pull via `jq` and always fair game per Step 1/2. **Message *content* is
different** — do not dump a subagent's actual prose/tool-output text into
your context by default. Only if the user names a specific agent and asks
for a deeper look at *what it thought or did*, spawn one narrowly-scoped
summarizer subagent to read that one transcript's content and report back a
short summary — never read a raw subagent JSONL transcript's message text
directly into your own context.

**Step 4 — Cross-agent duplication scan.** Compare what different agents (or
you, the orchestrator, directly) independently investigated or verified in
this stretch. Call out real overlap by name — e.g. "agent A already checked
X, then agent B re-derived the same fact independently" — not vague "there
may have been overlap." If there was none, say so; don't invent filler.

**Step 5 — Human-intervention scan.** Find every point in this stretch where
the user stopped, corrected, cancelled, or redirected what was happening.
These are the highest-signal entries — each one names a place where the
default behavior wasn't what the user actually wanted. Quote or closely
paraphrase what triggered it, not just "user intervened."

**Step 6 — Dedup check.** Read `.claude/agents/WORKFLOW_INSIGHTS.md` in full
(create it with the two headings below if it doesn't exist yet), then read
`docs/retros/ledger.md` in full (create it with the ledger structure below if
it doesn't exist yet). If this retro's real findings are already recorded — a
near-identical friction point, duplication pattern, or recommendation — do
not write a near-duplicate detailed entry. Treat an exact `(Date, Workflow)`
pair as the ledger row's identity: never append that exact pair twice. If the
detailed entry exists but its ledger row is missing, backfill only the ledger
row. If a **new** entry meaningfully updates or contradicts an existing one,
append the new entry and reference the old one instead of editing it.

**Step 7 — Write the entry.** Append under `## Retrospectives`, using the
template below. Then check: has the same friction point, duplication
pattern, or recommendation now shown up in **2 or more** dated entries? If
so, add or update one line under `## Recurring Patterns` at the top of the
file, pointing at the dated entries it's drawn from — that section is the
skimmable summary; `## Retrospectives` is the raw log.

**Step 8 — Append the trend row.** Append exactly one compact row to
`docs/retros/ledger.md` for this run. Copy the figures from the detailed
entry's Totals line — do not recalculate or round them differently. `Workflow`
is a short, distinguishing run label; `Next action` is the same single
concrete action as the detailed entry's `Next time`, shortened to one line.
Use `≈` on any derived/fallback figure exactly when the detailed entry does.
This ledger is the cross-run comparison surface required by the lab; it does
not replace or duplicate the detailed narrative.

## File structure

`.claude/agents/WORKFLOW_INSIGHTS.md`, sections in this fixed order:

```
## Recurring Patterns

<curated, one line each — only patterns seen in ≥2 dated entries below,
each citing which entries it's drawn from>

## Retrospectives

<dated entries, newest last, append-only>
```

## Entry template

```
### YYYY-MM-DD — <one-line summary of what the stretch was for>

**Run:** <one-line chain summary, e.g. "spec-creator → 2×researcher (parallel) → fork (crashed)"> · **N agents** · data: real (jsonl)

| agent | role | depth | in | out | cache-read | hit% | tools | span | cost |
|---|---|---|---|---|---|---|---|---|---|
| <id> | <type> | <n> | <n> | <n> | <n> | <n>% | <n> | <n>s | $<n> |

**Totals:** in <n> · out <n> · cache-read <n> · blended hit <n>% · tools <n> · wall <n>min · critical path <n>min · parallelism <n>x · **cost $<n>**
**Launch order:** <chain, noting any parallel fan-out and any gap where nothing was running>
**Worked well:** <1-2 sentences, concrete>
**Friction:** <1-3 sentences, concrete — cite which agent/step>
**Duplicated:** <what overlapped, between whom, or "none observed">
**Missed / gaps:** <what the stretch should have covered but didn't, or "none observed">
**Human interventions:** <each point the user redirected things, with what triggered it, or "none">
**Next time:** <one concrete, actionable change — not a vague aspiration>
```

If a transcript was unreadable and a figure had to fall back to `≈`
(Step 2's fallback), say so directly in that entry's table cell or a note
under it — never silently blend a real number and a guess in the same
totals row.

## Trend ledger structure

`docs/retros/ledger.md` is append-only and intentionally compact:

```md
# Workflow Retrospective Ledger

Compact cross-run metrics. Detailed evidence and narrative live in
[`.claude/agents/WORKFLOW_INSIGHTS.md`](../../.claude/agents/WORKFLOW_INSIGHTS.md).

| Date | Workflow | Agents | Tokens in / out | Cache read / hit | Tools | Wall | Parallelism | Cost | Next action |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| YYYY-MM-DD | <short run label> | <n> | <in> / <out> | <cache-read> / <hit%> | <n> | <n>min | <n>x | $<n> | <one concrete action> |
```

Keep one row per real retrospective run, oldest first. Do not add prose
entries, per-agent rows, launch order, friction detail, or human-intervention
detail here; those belong only in `WORKFLOW_INSIGHTS.md`.

Vague (skip this): "Communication could be better." Actionable (write this):
"Agent A's brief didn't say the output should be structured data — it
returned prose the orchestrator then had to re-parse by hand; next time pass
a `schema` /explicit output-shape instruction in the brief."

## What this skill does NOT do

- **Does not touch any package's `INSIGHTS.md`.** That's `engineering-insights` —
  durable knowledge about the *codebase*. This file is about the *agents/workflow*.
- **Does not turn the ledger into a second detailed report.** It writes only
  the compact metrics/action row defined above; evidence and narrative stay in
  `.claude/agents/WORKFLOW_INSIGHTS.md`.
- **Does not fix, re-run, or re-verify anything.** Purely observational — a
  retrospective, not a review.
- **Does not require a `Workflow`-tool run.** Every subagent — plain `Agent`
  calls or `Workflow`-orchestrated — has its own transcript with real usage
  data on disk; Step 1/2 read it the same way either way.
- **Does not read subagent message *content* by default.** Numeric metadata
  (tokens, tool names, timestamps, error markers) is extracted via `jq` for
  every retro, always. Actual message *text* — what an agent reasoned through
  or wrote — stays opt-in and user-directed only (Step 3).
- **Does not run itself.** No hook, no "I noticed we just finished a
  multi-agent stretch, let me log it" — manual invocation only, until the
  user says otherwise.
