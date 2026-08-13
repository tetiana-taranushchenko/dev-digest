# Onion Architecture — Examples

Illustrative patterns, not verbatim file excerpts. Paths point at where each
pattern applies in this repo.

## Dependency Direction

```ts
// BAD — modules/agents/service.ts reaching past the repository into Drizzle directly
import { db } from "../../db/client.js";
import { agents } from "../../db/schema/agents.js";

export async function listAgents(container: Container) {
  return db.select().from(agents); // service now knows Drizzle's query shape
}
```

```ts
// GOOD — service depends on the repository's typed surface, not on Drizzle
import type { AgentRepository } from "./repository.js";

export async function listAgents(container: Container, repo: AgentRepository) {
  const rows = await repo.findAll();
  return rows.map(toAgentDto); // application-layer mapping, still ring-appropriate
}
```

```ts
// BAD — modules/reviews/routes.ts deciding business rules inline
app.post("/pulls/:id/review", async (req, reply) => {
  const run = await repo.findLatestRun(req.params.id);
  if (run?.status === "running") {
    return reply.code(409).send({ error: "already running" }); // business rule in the route
  }
  // ...
});
```

```ts
// GOOD — routes.ts stays thin, the rule lives in the service
app.post("/pulls/:id/review", async (req, reply) => {
  const result = await reviewService.startRun(container, req.params.id);
  return reply.send(result);
});

// service.ts
export async function startRun(container: Container, pullId: string) {
  const existing = await repo.findLatestRun(pullId);
  if (existing?.status === "running") {
    throw new AppError("run-already-in-progress", 409);
  }
  // ...
}
```

## Domain Purity (`reviewer-core`)

```ts
// BAD — a new grounding rule reaching into server infra from inside reviewer-core
import { db } from "../../server/src/db/client.js"; // reviewer-core must never do this

export function groundFinding(finding: Finding) {
  // ...
}
```

```ts
// GOOD — reviewer-core stays infra-free; the server-side caller supplies data
// reviewer-core/src/grounding.ts
export function groundFinding(finding: Finding, diffContext: DiffContext) {
  // pure function, no DB/network access
}

// server/src/modules/reviews/service.ts calls it with data it already fetched
const diffContext = await repo.loadDiffContext(pullId);
const grounded = groundFinding(finding, diffContext);
```

## Graduated Layering

```
modules/agents/              modules/pulls/
  routes.ts                    routes.ts
  service.ts    ← has logic    (no service.ts — pure CRUD, correct as-is)
  repository.ts
  constants.ts
  helpers.ts
```

```ts
// BAD — an empty pass-through service added "for consistency" to a CRUD module
// modules/pulls/service.ts
export async function getPull(container: Container, id: string) {
  return repo.findById(id); // zero logic — this file adds nothing
}
```

```ts
// GOOD — pulls/routes.ts calls the repository directly; no forced service layer
app.get("/pulls/:id", async (req, reply) => {
  const pull = await repo.findById(req.params.id);
  return reply.send(pull);
});
```

## Validation Placement

```ts
// BAD — domain invariant encoded as a Zod refinement in routes.ts
const CreateAgentVersion = z.object({
  agentId: z.string().refine(async (id) => await agentExists(id), {
    message: "agent must exist",
  }),
});
```

```ts
// GOOD — Zod validates shape; the service enforces the invariant
const CreateAgentVersion = z.object({ agentId: z.string() });

// service.ts
export async function createVersion(container: Container, input: CreateAgentVersionInput) {
  const agent = await repo.findAgent(input.agentId);
  if (!agent) throw new AppError("agent-not-found", 404);
  // ...
}
```

## Composition Root

```ts
// BAD — a new adapter wired up ad hoc inside a service instead of the container
// modules/repo-intel/service.ts
import { RealEmbedderAdapter } from "../../adapters/embedder/real.js";

const embedder = new RealEmbedderAdapter(); // second wiring point — don't do this
```

```ts
// GOOD — the adapter is wired once in platform/container.ts, injected everywhere else
// platform/container.ts
export function createContainer(overrides?: ContainerOverrides): Container {
  return {
    embedder: overrides?.embedder ?? new RealEmbedderAdapter(),
    // ...
  };
}

// modules/repo-intel/service.ts
export async function indexRepo(container: Container, repoId: string) {
  await container.embedder.embed(/* ... */);
}
```
