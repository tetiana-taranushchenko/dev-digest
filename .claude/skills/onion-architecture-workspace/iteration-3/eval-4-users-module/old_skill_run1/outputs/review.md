# Code Review: Users Module (routes.ts, service.ts, repository.ts)

## Overview

The users module demonstrates good dependency-direction discipline — routes depend on service, service depends on repository, repository encapsulates Drizzle — but it violates the graduated-layering principle by adding a service layer that performs zero business logic. This is the exact boilerplate pattern the skill exists to avoid.

---

## Issues Found

### 1. **Graduated Layering Violation (HIGH)**

**Location:** `service.ts` (all methods)

**Problem:**

The `UsersService` is an empty pass-through layer. Every public method forwards its arguments directly to the repository with zero business logic, decision-making, or coordination:

```ts
async createUser(workspaceId, name, email, role): Promise<UserRow> {
  return this.repo.insert(workspaceId, { name, email, role }); // zero logic
}

async updateUser(workspaceId, id, patch): Promise<UserRow | undefined> {
  return this.repo.update(workspaceId, id, patch); // just forwards
}
```

This violates the skill's graduated-layering rule:

> "Don't add an empty `service.ts` that just forwards one call to `repository.ts` with zero logic in between — that's boilerplate the graduated model exists to avoid."

According to LAYER_MAP.md, `workspace` is correctly classified as "Flat" (routes.ts only) because it is "Pure CRUD" — the same category as users. The users module is doing exactly what flat modules do: validate shape in routes, read/write one table via repository, return.

**Why it matters:**

- Adds maintenance burden with no value (the service layer never orchestrates, never makes decisions)
- Creates false layering that will confuse future maintainers about whether business logic belongs in the service
- Sets a precedent for adding empty services to other CRUD modules

**Fix:**

Eliminate the service.ts. Have `routes.ts` call `UsersRepository` directly — this is the correct pattern for CRUD-only modules:

```ts
// routes.ts
import { UsersRepository } from './repository.js';

export default async function usersRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const repo = new UsersRepository(app.container.db);

  app.get('/users', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return repo.list(workspaceId); // routes calls repo directly
  });
  // ... rest of endpoints
}
```

This is the flat-module pattern, already used successfully in `workspace/` and other CRUD modules.

---

### 2. **Repository Instantiation in Service Constructor (MEDIUM)**

**Location:** `service.ts`, line 9

**Problem:**

The service constructor creates the repository directly:

```ts
constructor(private container: Container) {
  this.repo = new UsersRepository(container.db);
}
```

This couples the service to the repository's constructor signature. If the repository ever needs additional dependencies (e.g., a cache adapter, a logger), the service becomes a bottleneck for injecting them.

**Why it matters (for hypothetical future state, if service survives):**

If the module ever gains real business logic and the service stays, it becomes harder to mock the repository in unit tests or swap implementations.

**Best practice (if service layer becomes necessary later):**

Accept the repository as a constructor dependency:

```ts
constructor(
  private container: Container,
  repo?: UsersRepository
) {
  this.repo = repo ?? new UsersRepository(container.db);
}
```

Or inject via the container pattern the rest of the codebase uses.

**Current impact:** Low — this is a minor point to fix if the service layer remains. However, eliminating the service (Issue #1) makes this moot.

---

## What's Done Well

- **Dependency direction is correct:** Routes → Service → Repository → Drizzle. No backwards dependencies.
- **Zod validation in routes:** HTTP shape validation (`CreateUserBody`, `UpdateUserBody`) belongs at the boundary and is correctly placed.
- **Repository as typed adapter:** The repository exports `InsertUser`, `UpdateUser`, `UserRow` types as contracts; the service depends on those types, not on Drizzle directly. This is the dependency-inversion pattern working correctly.
- **Workspace scoping:** All operations correctly scope to `workspaceId`, enforcing multi-tenancy at the repository level.
- **Error handling in routes:** 404 checks are thin and appropriate (service returns null, route decides the HTTP response).

---

## Recommendation

**Before wiring into modules/index.ts:**

1. Delete `service.ts`.
2. Update `routes.ts` to instantiate and call `UsersRepository` directly (flat module pattern).
3. Keep `repository.ts` as-is — it correctly encapsulates Drizzle and provides typed methods.

This aligns the module with the graduated-layering principle and the existing pattern in `workspace/`. If the module later grows real business logic (e.g., email validation, role-based access control, audit logging), add the service layer back at that point — but only then.

---

## Summary

| Issue | Severity | Fix Priority |
|-------|----------|--------------|
| Empty service layer (graduated-layering violation) | HIGH | **Before merging** |
| Repository instantiation coupling | MEDIUM | **If service persists** |

**Ready to wire if:** The service.ts is removed and routes.ts calls the repository directly.
