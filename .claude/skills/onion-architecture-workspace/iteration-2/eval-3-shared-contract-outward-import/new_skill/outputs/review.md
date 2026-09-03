Thanks for flagging this before wiring it in — good call, because there's a boundary problem here that'll bite the client build, not just a style nit.

**CRITICAL — the contract imports from `server/src/db`, which breaks the outward-free rule for `@devdigest/shared`**

`repo-health.ts:3` has:

```ts
import type { AgentRow } from '../../../db/rows.js';
```

and then at line 17:

```ts
export interface RepoHealthDetail extends RepoHealthSummary {
  stale_agents: AgentRow[];
}
```

`@devdigest/shared` sits in the Domain ring (same as `reviewer-core`) precisely so both server and client can depend on it without either depending on the other. The onion-architecture skill is explicit: a shared contract "never imports a type from `server/src/db`, `server/src/adapters`, `server/src/modules`, or any Fastify/Drizzle type," and specifically calls out this exact pattern — "never reach into `server/src/db/rows.ts`" for a DB-row-shaped field, because "a contract that embeds a raw row type quietly couples every consumer of `@devdigest/shared` (including the client) to the server's Drizzle schema."

That's exactly what's happening: `AgentRow` is `typeof t.agents.$inferSelect` (server/src/db/rows.ts:12) — a raw Drizzle-inferred row, full of columns the client detail page has no business seeing (internal timestamps, foreign keys, whatever else lives on that table) and no reason to import a server-only db module to get. Since this package is mirrored into `client/src/vendor/shared/`, the client either can't resolve `../../../db/rows.js` at all (it doesn't have a `server/src/db`), or someone "fixes" it later by duplicating/faking that file on the client side — both are bad outcomes and both stem from importing across the ring boundary here.

**Fix:** don't import `AgentRow`. Shape the field inline in the contract with just what the repo detail page actually needs, e.g.:

```ts
export const StaleAgentSummary = z.object({
  agent_id: z.string().uuid(),
  agent_name: z.string(),
  last_run_at: z.string().datetime().nullable(),
});
export type StaleAgentSummary = z.infer<typeof StaleAgentSummary>;
```

and reference that instead of `AgentRow[]`.

**HIGH — `RepoHealthDetail` isn't a Zod schema, just a TS interface**

Separately from the import issue: `RepoHealthSummary` is done right (Zod schema + inferred type), but `RepoHealthDetail` is a plain `interface extends`. The skill's convention is "a contract is a Zod schema (+ its inferred type) that both server and client can depend on" — that's what gives you runtime validation at the API boundary, not just a compile-time shape. As written, if the API route tries to use `RepoHealthDetail` as a Fastify/Zod response schema, there's nothing to validate against — you'd need to hand-roll it. Once you replace `stale_agents: AgentRow[]` with the `StaleAgentSummary` schema above, make `RepoHealthDetail` a real `z.object` too, something like:

```ts
export const RepoHealthDetail = RepoHealthSummary.extend({
  stale_agents: z.array(StaleAgentSummary),
});
export type RepoHealthDetail = z.infer<typeof RepoHealthDetail>;
```

That gives you one schema you can actually use for response validation on the server and get a matching inferred type on the client, which is presumably the point of putting this in `@devdigest/shared` in the first place.

Everything else in the file is fine — `RepoHealthSummary` itself is a clean, self-contained Zod schema with no outward dependencies, which is exactly the pattern to follow. Once the two issues above are fixed, I'd say it's good to wire in.
