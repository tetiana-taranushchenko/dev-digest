Thanks for flagging this before wiring it in — good instinct, because there's a blocking issue here.

**CRITICAL — `AgentRow` import breaks the dependency direction**

Line 3:

```ts
import type { AgentRow } from '../../../db/rows.js';
```

`@devdigest/shared` contracts sit at the innermost ring — Domain — same as `reviewer-core` (this is explicit in LAYER_MAP.md's ring table, and SKILL.md's diagram places `@devdigest/shared` contracts inside the same innermost box as reviewer-core). `server/src/db/rows.ts` is Drizzle data access, which is Infrastructure — one ring further out. So this file has Domain importing from Infrastructure, which is exactly backwards. The rule is "dependencies point inward only... never the reverse," and while that section's wording is framed around `service.ts`/`repository.ts`, the same invariant is what keeps `reviewer-core` (and by the LAYER_MAP mapping, shared contracts) framework- and infra-agnostic — it shouldn't know Drizzle's row shapes exist.

It's not just a layering purity nit, either — it'll actually break the thing you said this is for. You said this contract will be used by both the API response and the client's repo detail page. `client/` has no access to `server/src/db/rows.ts` (and shouldn't — that's server-internal Drizzle output), so `RepoHealthDetail` as written can't actually be imported client-side without either dragging server/db into the client build or having the import fail to resolve.

Fix: don't reuse `AgentRow` at all. Define what the health-summary feature actually needs as its own domain type — something like a `StaleAgentSummary` zod schema with just the fields the UI needs (id, name/repo path, last-reviewed timestamp, whatever "stale" means here), and have `RepoHealthDetail` compose that. The mapping from a full `AgentRow` down to that summary shape belongs in the module's `service.ts` (application ring), not in the shared contract itself.

**Secondary — `RepoHealthDetail` isn't a validated contract like its sibling**

`RepoHealthSummary` is a zod object with an inferred type, which is the pattern this package uses elsewhere. `RepoHealthDetail` is a bare `interface` that extends it and bolts on `stale_agents: AgentRow[]` — no runtime schema, so there's no validation on the one field that's actually new. Once you replace `AgentRow` with the new `StaleAgentSummary` schema per the fix above, make `RepoHealthDetail` a zod object too (spread `RepoHealthSummary.shape` plus `stale_agents: z.array(StaleAgentSummary)`) so both contracts are inferable and parseable the same way, rather than one being a runtime-checked schema and the other a type-only shape.

**One more thing, unrelated to onion-architecture but worth pausing on**

The real path you gave — `server/src/vendor/shared/contracts/repo-health.ts` — falls under `server/src/vendor/shared/`, which the repo's CLAUDE.md marks as do-not-touch without coordination. That's presumably about the vendored package boundary rather than "no new files ever," but I'd confirm with whoever owns that sync before landing a new file there, separately from the architecture fix above.

Once the `AgentRow` import is replaced with a domain-owned summary type and `RepoHealthDetail` is a proper zod schema, this is good to wire in.
