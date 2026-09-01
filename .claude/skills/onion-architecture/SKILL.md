---
name: onion-architecture
description: Layering and dependency-direction rules for DevDigest backend modules (server/, reviewer-core/). Use when creating or extending a Fastify module, deciding where new business logic belongs (routes vs service vs repository vs domain), wiring a new adapter, or touching reviewer-core's domain logic. Enforces inward-only dependencies (routes → service → repository/adapters → domain) with graduated layering by module complexity. Does not cover route/plugin mechanics (see fastify-best-practices), Drizzle schema/query authoring (see drizzle-orm-patterns), or Zod schema construction (see zod).
version: 0.1.0
---

# Onion Architecture (Backend)

Where backend code lives, and which direction it's allowed to depend. For code
examples, see [examples.md](examples.md). For the research behind these rules
(sources, quotes, rationale), see [README.md](README.md).

**Scope boundary** — this skill does not duplicate:

- `fastify-best-practices` — route/plugin mechanics, JSON-schema request/response validation details
- `drizzle-orm-patterns` — schema definition, query writing, migrations
- `zod` — how to construct/compose a schema

This skill governs _where code lives and which way dependencies point_, not how to
write a route or a query.

## Severity Levels

- **CRITICAL** — Breaks the dependency-inversion boundary that makes the domain testable and swappable
- **HIGH** — Will cause layering drift as the module grows
- **MEDIUM** — Hurts consistency/maintainability but isn't a boundary violation

---

## The Rings

```
+--------------------------------------------------------------------+
| Presentation — routes.ts (Fastify routes, plugins)                 |
|    +----------------------------------------------------------+    |
|    | Infrastructure / Adapters                                |    |
|    | repository.ts · adapters/* · container.ts                |    |
|    |    +------------------------------------------------+    |    |
|    |    | Application (services)                         |    |    |
|    |    | service.ts · helpers.ts                         |    |    |
|    |    |    +--------------------------------------+    |    |    |
|    |    |    | Domain — reviewer-core               |    |    |    |
|    |    |    | @devdigest/shared contracts          |    |    |    |
|    |    |    +--------------------------------------+    |    |    |
|    |    +------------------------------------------------+    |    |
|    +----------------------------------------------------------+    |
+--------------------------------------------------------------------+
                outer <────────────────────────> inner
```

Dependencies point inward only — Presentation → Infrastructure → Application →
Domain — never the reverse. The innermost ring (Domain) knows nothing about any
ring that wraps it.

| Ring (innermost → outermost)    | Role                                                            |
| ------------------------------- | --------------------------------------------------------------- |
| Domain                          | Pure business logic, zero framework/infra deps                  |
| Application                     | Orchestration, business rules, DTO mapping                      |
| Infrastructure (ports/adapters) | Drizzle data access, external system adapters, composition root |
| Presentation                    | Fastify handler + Zod request validation, thin                  |

For the exact path-by-path mapping and which modules currently carry the full
split vs. stay flat, see [LAYER_MAP.md](LAYER_MAP.md) — the living source of
truth; update it whenever a module is added or graduates.

## Dependency Direction (CRITICAL)

- Dependencies point inward only: `routes.ts` → `service.ts` → (`repository.ts` +
  adapter interfaces) → domain (`reviewer-core`/shared contracts). Never the reverse.
- `reviewer-core/**` never imports from `server/src/adapters`, `server/src/db`,
  `server/src/modules`, or any Fastify/Drizzle type — it stays framework- and
  infra-agnostic. This is already true today; treat it as an invariant, not an
  accident.
- `service.ts` never imports Drizzle `db`/`schema` directly — only through
  `repository.ts`'s exported functions/types. If a service needs a new query,
  add a function to `repository.ts`, don't reach into `schema` from the service.
- `routes.ts` never imports `repository.ts` or `server/src/adapters/*` directly,
  and never contains SQL or business rules — it parses/validates (Zod), calls the
  service, and serializes the response.
- `server/src/platform/container.ts` is the _only_ file allowed to import both an
  adapter's interface and its concrete implementation together (it's the
  composition root).

## Domain Purity — `reviewer-core` Is the Reference Example (CRITICAL)

- `reviewer-core` (diff → prompt → LLM → grounded findings) has no DB/GitHub/FS
  dependency; its only side effect is an injected `LLMProvider`. When adding new
  domain-level logic (new business rules about reviews, findings, grounding),
  model it on this package: plain functions/types, one injected interface for the
  one real side effect, nothing else.
- If new domain logic needs something from outside (a DB read, a GitHub call),
  that's a signal it belongs in a `service.ts` (application ring) that calls the
  domain function, not in the domain function itself.

## Shared Contracts Stay Outward-Free (CRITICAL)

- `@devdigest/shared` (`server/src/vendor/shared/`, mirrored at
  `client/src/vendor/shared/`) is part of the Domain ring, same as `reviewer-core` —
  it never imports a type from `server/src/db`, `server/src/adapters`,
  `server/src/modules`, or any Fastify/Drizzle type. A contract is a Zod schema (+
  its inferred type) that both server and client can depend on; it must not itself
  depend on either.
- If a contract needs a field shaped like a DB row, shape it inline in the contract
  (or import from another `@devdigest/shared` contract file) — never reach into
  `server/src/db/rows.ts` for it. A contract that embeds a raw row type quietly
  couples every consumer of `@devdigest/shared` (including the client) to the
  server's Drizzle schema.

## Graduated Layering by Module Complexity (HIGH)

- Not every module needs the full `routes → service → repository` split. Use this
  test: **does the module make a decision, compute a derived value, or coordinate
  multiple data sources/adapters?**
  - Yes → it has real business logic → give it a `service.ts` (and `repository.ts`
    if it touches the DB). Example: `agents`, `reviews`, `repo-intel`.
  - No — it's pure validate → read/write one table → return → a flat `routes.ts`
    (optionally with a thin `repository.ts`) is correct, not a shortcut. Example:
    `pulls`, `polling`, `workspace`.
- Don't add an empty `service.ts` that just forwards one call to `repository.ts`
  with zero logic in between — that's boilerplate the graduated model exists to
  avoid (see [README.md](README.md) — overengineering sources).

## New Code Only — No Silent Retrofits (CRITICAL)

- This skill governs **new modules and new files**. It must not push an
  unsolicited refactor of an existing flat module (`pulls/`, `polling/`,
  `workspace/`) just because it doesn't have a `service.ts`.
- Apply the split to an existing flat module only when either (a) the user
  explicitly asks for that refactor, or (b) the module is organically growing
  real business logic as part of the current task — i.e. it just crossed the
  decision/coordination line above.

## Validation Placement (HIGH)

- Zod schemas in `routes.ts` (via `fastify-type-provider-zod`) validate _shape_ —
  request params/body structure and types — at the HTTP boundary. This is already
  the repo convention; keep it there.
- Business/domain invariants (e.g. "an agent version must reference an existing
  agent", "a run can't be started twice concurrently") belong in `service.ts`,
  never encoded as a Zod `.refine()` and never left implicit in the repository.

## Repository Pattern & Dependency Inversion (HIGH)

- `repository.ts` exposes typed functions and DTOs (the existing pattern, e.g.
  typed `Insert*` interfaces) as the _sole_ interface between the application
  layer and Drizzle. `service.ts` depends on that function surface, never on
  `db`/`schema` directly — this is the dependency-inversion mechanism that makes
  services unit-testable without a real database.

## Repository Export Boundaries (HIGH)

- `repository.ts` must export **DTO types** (application-layer shapes like
  `InsertUser`, `UpdateUser`, `UserResponse`), never raw Drizzle-inferred types
  (`typeof t.users.$inferSelect`). A raw Drizzle type leaked from `repository.ts`
  couples every importer (including tests, service code, even other modules via
  re-exports) to the current DB schema — a change to the schema breaks all those
  consumers unnecessarily. DTOs act as the anti-corruption layer: they let the
  service and tests code against a stable interface while the schema evolves.
- If `repository.ts` re-exports a Drizzle type for use in the module, document
  why (rare; valid only when there's no DTO alternative, e.g. a raw-row
  pass-through for admin tools). Otherwise, wrap it in a DTO.

## Composition Root (MEDIUM)

- `server/src/platform/container.ts` + `server/src/adapters/*` already model
  ports-and-adapters correctly (prod adapters vs. `src/adapters/mocks.ts` for
  tests, via `ContainerOverrides`). Reinforce this existing pattern for new
  adapters — don't invent a second wiring mechanism.

## Additional Resources

### Reference Files

- **[examples.md](examples.md)** — good/bad module layouts, dependency-direction violations and fixes, the flat-vs-split decision applied to real modules
- **[LAYER_MAP.md](LAYER_MAP.md)** — living path-by-path ring mapping and per-module classification (full split vs. flat) — update it as modules change
- **[README.md](README.md)** — full source list with quotes and per-topic consensus this skill was built from
