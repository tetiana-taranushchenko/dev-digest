# Users Module Architecture Review

## Overview
The users module follows the layered structure (routes → service → repository) and mostly respects dependency direction, but has two critical violations before wiring into `modules/index.ts`: a raw Drizzle type leak and composition-root discipline issues. The service layer is also a pure pass-through with no business logic — which is correct for a CRUD module per graduated layering, but worth calling out given the structure chosen.

---

## Critical Issues

### 1. Raw Drizzle Type Export (CRITICAL)
**File:** `repository.ts`, lines 62–64  
**Severity:** CRITICAL

```ts
export {
  type typeof t.users.$inferSelect as UserRow,
};
```

**Problem:**  
`UserRow` is a raw Drizzle-inferred type (`typeof t.users.$inferSelect`), not a DTO. Per the skill: "repository.ts must export DTO types… never raw Drizzle-inferred types. A raw Drizzle type leaked from repository.ts couples every importer (including tests, service code, even other modules via re-exports) to the current DB schema."

**Impact:**
- Every place that imports `UserRow` (service.ts line 3, any route test, any future re-export to other modules) becomes tightly coupled to your Drizzle schema
- If the schema changes (e.g., you add/remove/rename a column), all consumers break unnecessarily

**Fix:**  
Define a DTO interface in `repository.ts` instead. The exported types should be `InsertUser` and `UpdateUser` (which you already have), plus a new `UserResponse` DTO for read operations:

```ts
// repository.ts
export interface UserResponse {
  id: string;
  workspaceId: string;
  name: string;
  email: string;
  role: 'admin' | 'user';
  createdAt: Date;
  updatedAt: Date;
}

// Then map inside repository methods:
async list(workspaceId: string): Promise<UserResponse[]> {
  const rows = await this.db
    .select()
    .from(t.users)
    .where(eq(t.users.workspaceId, workspaceId));
  return rows.map(row => this.toUserResponse(row));
}

private toUserResponse(row: typeof t.users.$inferSelect): UserResponse {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    email: row.email,
    role: row.role,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
```

Then `service.ts` imports `UserResponse` instead of `UserRow`, and all consumers are decoupled from schema changes.

---

### 2. Composition Root Violations (CRITICAL)
**Files:** `routes.ts` line 24, `service.ts` line 9  
**Severity:** CRITICAL

**routes.ts:**
```ts
const service = new UsersService(app.container);
```

**service.ts:**
```ts
this.repo = new UsersRepository(container.db);
```

**Problem:**  
Per the skill: "server/src/platform/container.ts is the only file allowed to import both an adapter's interface and its concrete implementation together (it's the composition root)."

Creating instances ad hoc in routes and service creates a second (or third) wiring point. This violates the single-responsibility principle for dependency assembly and makes testing harder (you can't mock the service/repo without changing the module code).

**Impact:**
- Unit tests can't inject a mock repository without hacking `service.ts`
- If you add a second implementation of `UsersRepository` (e.g., for a test double), you have to edit service.ts to swap it
- Container overrides (the pattern already used in tests for adapters like `embedder`, `github`) can't work here

**Fix:**  
Wire the service and repository once in `container.ts`, then inject them:

```ts
// server/src/platform/container.ts
import { UsersRepository } from '../modules/users/repository.js';
import { UsersService } from '../modules/users/service.js';

export function createContainer(overrides?: ContainerOverrides): Container {
  const usersRepository = overrides?.usersRepository ?? new UsersRepository(db);
  const usersService = overrides?.usersService ?? new UsersService(usersRepository);

  return {
    db,
    usersRepository,
    usersService,
    // ... rest of container
  };
}

// Update Container type to include both
export interface ContainerOverrides {
  usersRepository?: UsersRepository;
  usersService?: UsersService;
  // ... rest of overrides
}
```

Then update service constructor to take the repository as a parameter:

```ts
// service.ts
export class UsersService {
  constructor(private repo: UsersRepository) {}
  // ... rest stays the same
}
```

And routes to get the service from container:

```ts
// routes.ts
export default async function usersRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = app.container.usersService;
  // ... rest of routes
}
```

---

## High-Priority Issues

### 3. Service Is a Pure Pass-Through (HIGH – Consider Graduated Layering)
**File:** `service.ts`, entire file  
**Severity:** HIGH (architectural consistency note)

Every method in `UsersService` is a direct delegation to the repository with no business logic:

```ts
async listUsers(workspaceId: string): Promise<UserRow[]> {
  return this.repo.list(workspaceId);
}
```

Per the skill's "Graduated Layering by Module Complexity" section: "Not every module needs the full routes → service → repository split… does the module make a decision, compute a derived value, or coordinate multiple data sources? No — it's pure validate → read/write one table → return — a flat routes.ts (optionally with a thin repository.ts) is correct."

**Question for your team:**  
Is this users module intended as a true CRUD endpoint that stays simple, or as a scaffold expecting future business logic (e.g., role-based access validation, audit logging, onboarding workflows)? If it's forever CRUD, consider moving to a flat structure (routes directly calls repository). If you expect it to grow, keep the service layer as written — it's a valid choice and makes the future refactor easier.

**Recommendation:**  
Document this choice (as a comment in service.ts or in a module-level README) so future maintainers understand why the service layer exists if no logic is there yet. Compare to the `workspace/` module (LAYER_MAP.md: flat, CRUD only) to see the alternative.

---

## Medium-Priority Issues

### 4. Error Handling Inconsistency (MEDIUM)
**File:** `routes.ts`, lines 34 and 56  
**Severity:** MEDIUM

The routes throw `NotFoundError` when a user isn't found. But consider: should the service layer decide to throw, or return null? Currently, the routes decide. For consistency with the rest of the codebase (and to keep routes thin), consider having the service throw:

```ts
// service.ts
async getUser(workspaceId: string, id: string): Promise<UserRow> {
  const user = await this.repo.getById(workspaceId, id);
  if (!user) {
    throw new NotFoundError('User not found');
  }
  return user;
}

// routes.ts — now simpler
const user = await service.getUser(workspaceId, req.params.id);
return user;
```

This keeps business rules (including "missing user is an error") in the service, not the route.

---

## Green Flags

- ✅ Dependency direction is correct: routes → service → repository
- ✅ Zod validation is in the right layer (routes, shape validation only)
- ✅ Repository is wrapped in an interface-like class; no direct Drizzle imports in service
- ✅ Workspace scoping is respected (all queries filter by `workspaceId`)
- ✅ Uses getContext for auth/workspace extraction
- ✅ DTO interfaces (`InsertUser`, `UpdateUser`) are defined and used correctly

---

## Action Items Before Wiring

1. **Replace the raw Drizzle export** (lines 62–64 of repository.ts) with a `UserResponse` DTO interface and map in repository methods
2. **Wire service and repository in `container.ts`** instead of instantiating in routes and service
3. **Update service constructor** to accept the repository as a parameter
4. **Update routes** to inject the service from `app.container.usersService`
5. **Optionally document** whether this module is a permanent CRUD endpoint or a scaffold for future logic

After these fixes, the module will be ready to add to `modules/index.ts` and will serve as a solid example of layering for future modules.
