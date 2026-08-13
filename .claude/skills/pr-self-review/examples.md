# Example reports

## PASS

```
# PR Self Review

Base: origin/main · Branch: feat/agent-run-history · 6 files changed

Skills run: onion-architecture, fastify-best-practices, react-best-practices,
react-frontend-architecture, security, zod

## Findings
None.

## Suppressed
None.

## Not verified
None.

## Summary
0 CRITICAL · 1 HIGH · 2 MEDIUM — none blocking. See below for advisory notes.

### HIGH
- `server/src/modules/agents/service.ts:88` (onion-architecture) — service.ts
  reads `db` directly instead of going through repository.ts; will need to
  move behind a repository function as this module grows.

### MEDIUM
- `client/src/features/agent-runs/RunHistory.tsx:40` (react-best-practices) —
  derived `isStale` value is stored in state instead of computed inline.
- `server/src/modules/agents/routes.ts:12` (fastify-best-practices) — missing
  response schema on GET /agents/:id/runs.

PR_SELF_REVIEW: PASS
```

## BLOCK

```
# PR Self Review

Base: origin/main · Branch: fix/webhook-signature · 3 files changed

Skills run: onion-architecture, fastify-best-practices, security, zod

## Findings

### CRITICAL
- `server/src/modules/webhooks/routes.ts:34` (security) — webhook signature
  comparison uses `===` instead of a constant-time compare, enabling a
  timing attack against the shared secret.
  Failure scenario: an attacker measures response-time deltas across many
  requests to recover the secret byte-by-byte, then forges valid webhook
  payloads.

### HIGH
- `server/src/modules/webhooks/service.ts:19` (onion-architecture) — service
  imports `db` directly, bypassing repository.ts.

## Suppressed
None.

## Not verified
- `zod` — review sub-agent timed out after 60s, not retried.

## Summary
1 CRITICAL · 1 HIGH · 0 MEDIUM — BLOCKED. Fix the CRITICAL finding (or add a
`pr-self-review-ignore:` comment with justification) before pushing.

PR_SELF_REVIEW: BLOCK
```

## BLOCK with a suppressed finding (after adding an ignore comment)

Same diff as above, but `routes.ts:34` now has:

```ts
// pr-self-review-ignore: false positive, this path is unreachable in prod —
// guarded by featureFlag.webhookV2 which is off; tracked in JIRA-4821
if (signature === expectedSignature) {
```

Resulting report:

```
## Findings
None.

## Suppressed
- `server/src/modules/webhooks/routes.ts:34` (security, was CRITICAL) —
  timing-unsafe signature comparison. Reason: "false positive, this path is
  unreachable in prod — guarded by featureFlag.webhookV2 which is off;
  tracked in JIRA-4821"

## Summary
0 CRITICAL (1 suppressed) · 1 HIGH · 0 MEDIUM — not blocking.

PR_SELF_REVIEW: PASS
```
