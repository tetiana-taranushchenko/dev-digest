# Onion Architecture — Eval Suite

Three draft modules under `fixtures/`, each with real architecture violations
planted on purpose — with no comments calling them out — so a review's output
can be checked against a known-correct answer rather than eyeballed.

Grading is mechanical: see `expected-findings.json` for the exact `file` +
`line` + rule each fixture is meant to trigger. A review "passes" a finding
when it calls out the same file within a few lines of the cited one and
references the same rule in substance (it doesn't need to quote the anchor).
Anything flagged beyond this list isn't wrong, just outside what this suite
checks for — this skill's own scope note (SKILL.md's "Scope boundary")
already excludes things like security, so a review may reasonably surface
issues that aren't in `expected-findings.json` at all.

## Fixtures & prompts

### 1. `fixtures/webhooks/`

Draft module for receiving GitHub webhook deliveries: `routes.ts`,
`service.ts`, `repository.ts`, plus an adapter at `hmac-verifier.ts`.

> I put together a first draft of a new module for receiving GitHub webhook
> deliveries — modules/webhooks/routes.ts, service.ts, repository.ts, plus a
> small adapter at adapters/webhooks/hmac-verifier.ts (all attached below).
> Before I wire it into modules/index.ts and open a PR, can you review it and
> point out anything that's off?

### 2. `fixtures/risk-score/`

Draft domain file for `reviewer-core`: a new risk-scoring step.

> I'm adding a new risk-scoring step to reviewer-core —
> reviewer-core/src/review/risk-score.ts (attached). It should combine
> finding severity with how central the touched files are in the repo. Can
> you take a look before I wire it into review/run.ts?

### 3. `fixtures/notifications/`

Draft module for a small notifications feature: `routes.ts`, `service.ts`,
`repository.ts`.

> Drafted a small notifications module (routes.ts, service.ts, repository.ts,
> attached) — users get a notification row, can list them, mark one read, and
> there's a small unread-count badge for the topbar. Can you check this over
> before I register it in modules/index.ts?

### 4. `fixtures/users-module/` (v2 only — tests the "Repository Export Boundaries" rule added after v1)

A three-file users module (`routes.ts`, `service.ts`, `repository.ts`) with a real CRUD flow.

> I started a users module for workspace management — routes, service, and
> repository all attached. The service layer talks to repo, routes talk to
> service. Before I wire it into modules/index.ts, can you review it for any
> onion-architecture issues?

### 5. `fixtures/shared-contracts/` (v2 only — tests the "Shared Contracts Stay Outward-Free" rule added after v1)

A new `@devdigest/shared` contract for a repo health-summary feature.

> I added a new contract to @devdigest/shared for a repo health-summary
> feature — server/src/vendor/shared/contracts/repo-health.ts (attached).
> It'll be used by both the API response and the client's repo detail page.
> Can you review it before I wire it in?

## Running it

Point a reviewer (with this skill loaded) at one fixture's files with its
prompt above, and separately at the same files with no skill loaded, then
diff the two against `expected-findings.json`. See the sibling
`onion-architecture-workspace/` folder for a worked example of both runs per
fixture (not shipped with the skill — dev-time scratch space only).
