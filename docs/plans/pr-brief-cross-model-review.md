# Cross-model review note: PR Brief Development Plan

Plan reviewed: `docs/plans/pr-brief.md`
Spec: `specs/2026-08-27-pr-brief.md`
Reviewed by: a non-Claude model (product owner ran this externally, per this
repo's Definition of done — "A short cross-model review note of that plan
exists and is committed alongside it").
Date: 2026-08-28

## Verdict

**Not safe to implement as written.** Every AC-1…AC-29 is textually assigned
to a task, but several tasks as described do not actually satisfy the AC they
claim to (see findings). Four findings were independently spot-checked
against the real code by the orchestrating Claude session and confirmed
accurate (marked ✅ below); the rest were not independently re-verified but
are internally consistent with the plan text and are treated as credible.

## Findings

- **Recommendation 1 is a real correctness bug, not an acceptable
  simplification.** `GET` presents a Brief as current after a document edit
  or repo-intel reindex, directly violating AC-19. Fix: persist a
  lightweight attachment/index revision so `GET` can detect staleness
  without reading document bodies.
- **The cache key is under-specified even on `POST`.** PR title/body edits,
  linked-issue edits, and intent becoming available/re-derived don't change
  `head_sha + agent_id + docsFingerprint + indexSha`, despite being model
  inputs. A same-SHA index rebuild can also change blast data without
  changing `lastIndexedSha`. `POST` can return stale cached output too.
- **Recommendation 2 (`useAgents()[0]` as default `agent_id`) is unsafe. ✅
  confirmed:** `AgentsRepository.list()` (`server/src/modules/agents/repository.ts:54`)
  has no `ORDER BY` and does not filter `enabled` — the "first" agent is not
  stable and can be a disabled agent.
- **`agent_id` has no authorization check. ✅ confirmed:** routes validate
  only UUID shape; `ContextDocsService.resolveForAgent(agentId)`
  (`server/src/modules/context/service.ts:144`) takes no `workspaceId` and
  performs no ownership check. A caller can submit a deleted, disabled,
  nonexistent, or foreign-workspace agent id. T4 also has no agent FK.
- **Regenerate is broken.** T4's unique index is `(pr, agent, stateKey)`; T6
  says force-regeneration always calls `insertBrief`, "never update-in-place."
  A second regeneration of an unchanged state hits the unique constraint
  instead of replacing the row, as AC-20 requires. Needs an upsert on the
  same state key.
- **T6's in-flight `Map` is keyed too broadly.** `${prId}:${agentId}` means a
  request for a new state (e.g. after a fresh commit) joins an in-flight
  generation for a stale state instead of starting its own. Should be keyed
  by `${prId}:${agentId}:${stateKey}`. (Cross-replica double-billing remains
  unaddressed, as the plan itself already acknowledges.)
- **"Exactly one call" is not actually enforced or tested.** `generateBrief`
  calling `completeStructured` once doesn't account for a provider's
  internal reprompt/retry behavior. The proposed spy only counts adapter
  invocations, not billed model requests. Pass `maxRetries: 0` and assert
  `attempts === 1` if the NFR means one *billed* generation.
- **Budgeting counts the wrong text.** T5 counts the raw section
  concatenation before `assembleBriefPrompt` adds the system message,
  injection guard, labels, and `<untrusted>` wrappers — the actual model
  input can exceed the 8000-token budget.
- **AC-25/AC-28 break on regenerate.** Mutation/loading/error state lives in
  `BriefSummaryPanel` alone; Risk Areas and Review Focus independently read
  the still-populated query cache, so they keep showing stale content during
  a regenerate and stay visible after a failed one. Loading/error state
  needs to be coordinated above all three panels, not owned by one.
- **AC-13's "record each drop with its reason" is lost in persistence.** T3
  produces reason-bearing drops, but `BriefResult` and the DB schema persist
  only counts (`dropped_sections: string[]`, `droppedRisksCount`,
  `droppedReviewFocusCount`) — the reasons themselves are discarded.
- **AC-29 is internally inconsistent.** T6 only describes a cache-miss log
  call; `get()` (the `GET` handler) has no logger, yet T7 expects a
  cache-hit log line to exist. Also T1 says `cached` is `true` for every
  `GET` result, while T6's empty-result branch returns `cached: false`.
- **Dependency/file issues:**
  - T14 (e2e follow-up) needs T6 as a dependency, not just T12.
  - **T8's sample code is wrong. ✅ confirmed:** `api.get<T>(path: string)`
    (`client/src/lib/api.ts:69`) takes exactly one argument — no
    query-params object. `api.get<BriefResult>(url, { agent_id })` as
    written won't compile/won't send the param.
  - **T9 treats `client/messages/en/brief.json` as new. ✅ confirmed: the
    file already exists** — its current contents need to be read and
    reconciled, not overwritten blind.
  - T4 has no migration/backfill strategy for legacy `pr_brief` rows before
    adding multiple non-null columns.
- **Layering: no onion-ring violation found.** DB/schema imports stay
  confined to `brief/repository.ts` as required. Importing
  `context/write-safety.ts` is cross-feature coupling, not a layer breach.
- **T7's integration test list is insufficient.** Missing: concurrent-request
  coverage, state-change-during-generation coverage, document/index/intent
  staleness tests, coordinated UI loading/failure tests. The cached-read
  check watches `repoIntel`/`git` but not `contextDocs.readBodies` (which
  reads through filesystem APIs). The budget test must count the *final
  captured prompt*, not the raw sections. The log test omits a diff-body
  sentinel. Accessibility coverage omits the risk-disclosure and
  visible-focus requirements.

## Round 1 disposition

Sent back to `implementation-planner` (same session, resumed) for a revision
pass addressing every finding above. Revision 2 addressed all 15, plus two
product-owner-settled decisions (S-1: `statBodies` approved; S-2: rejecting
disabled agents is an intentional divergence from `RunReviewDropdown`).

## Round 2 — cross-model review of revision 2

Reviewed by a non-Claude model against revision 2. Four spot-checked ✅
against the real code by the orchestrating Claude session; all confirmed
accurate.

**Blockers:**

- **Document-freshness signal still doesn't satisfy AC-17's literal wording.
  ✅ confirmed.** The spec cites `revisionOf` (SHA-256 content hash,
  `context/write-safety.ts:144-146`) for the composite state key's document
  component; the plan's state key instead uses `mtimeMs + size`. The
  `revisionOf` doc comment (`write-safety.ts:138`) explicitly names this
  exact failure mode: two saves in the same millisecond producing the same
  byte count collide. Either the spec's AC-17 wording needs an explicit,
  approved exception for this field, or the plan needs a real
  content-derived token GET can read cheaply (e.g. checking whether
  `project-context-authoring`'s save path already persists a `revisionOf`
  value somewhere GET could read as a DB row, instead of computing it from a
  file read).
- **Client loading/error coordination is still broken. ✅ confirmed.** T9's
  prose claims "all three panels call this same hook against the same
  TanStack Query and mutation keys, `isMutating` is true in all three
  simultaneously" — but the shown `useGenerateBrief` (plan line ~673) has no
  `mutationKey`, and `useBriefSections` is called independently by each of
  the three panels. A bare `useMutation()` called three times creates three
  independent mutation observers; TanStack Query's shared cache
  synchronizes query *data*, not mutation *pending/error state*, across
  separate `useMutation` instances without `mutationKey` +
  `useMutationState`/`useIsMutating`. Needs either: call the hook once in
  `OverviewTab.tsx` and pass state down as props, or add a real
  `mutationKey` + `useIsMutating`/`useMutationState` wiring.
- **"Exactly one billed generation" still not actually enforced. ✅
  confirmed.** `maxRetries: 0` stops `generateBrief`'s own reprompt loop,
  but `OpenAIProvider.completeStructured` wraps each attempt in `withRetry`
  (`adapters/llm/openai.ts:96`), whose default is 3 retries on
  429/5xx/network errors (`platform/resilience.ts:46`) — a request-level
  concern the `attempts` field never sees. Needs a transport-level
  `retries: 0` override reaching `withRetry` for this call path, or the NFR
  needs to be reworded to explicitly allow transport-layer retries on the
  same logical request.
- **T4's migration/backfill strategy is internally contradictory. ✅
  confirmed.** The plan simultaneously requires: exactly one generated
  migration file; a `DELETE`/drop before the `NOT NULL` columns; and never
  hand-editing generated SQL — while also stating `drizzle-kit generate`
  will not author the `DELETE` on its own, and its own suggested escape
  hatch (drop + recreate the table) needs two migration files. Needs an
  explicit resolution: either allow two generated migrations for this one
  task, or find the drizzle-kit-idiomatic single-migration path (e.g.
  express the change as removing the old `pgTable` export and adding a new
  one in the same schema edit, if that's what makes `drizzle-kit generate`
  emit a single drop+create).

**Non-blocking but real:**

- A linked GitHub issue's *body* being edited after the fact still doesn't
  invalidate the cache — an accepted, but not yet explicitly documented,
  staleness gap (same category as the doc-edit-without-commit gap already
  documented elsewhere in the plan).
- AC-29's logging isn't called on every completed request — `logOutcome` is
  wired for GET (hit/miss), POST cache hit, and POST generation success, but
  not for a POST that fails (budget rejection, model error, missing model
  config — AC-28's failure modes). Those are still "a Brief request
  completed" per AC-29's own wording.

**Confirmed genuinely fixed in revision 2** (per this round's review, no
objection): `agent_id` authorization, disabled-agent handling, deterministic
default agent, regenerate via upsert, state-aware in-flight join key, full
prompt token budgeting, persisted drop reasons, the `api.get` query-string
call, `brief.json` reuse, task dependencies, and materially expanded test
coverage.

## Round 2 disposition

Sent back to `implementation-planner` for a revision 3 pass targeting the
four blockers above.
