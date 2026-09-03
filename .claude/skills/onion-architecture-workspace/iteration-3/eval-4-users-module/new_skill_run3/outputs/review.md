# Users Module Onion-Architecture Review

## Summary

The users module's layering structure is roughly sound — it correctly separates routes, service, and repository with dependencies pointing inward. However, there are three significant issues:

1. **CRITICAL**: The repository exports a raw Drizzle-inferred type (`UserRow`) instead of a properly defined DTO, violating the anti-corruption boundary that protects the application layer from schema changes.
2. **MEDIUM**: Composition-root discipline is broken: both the service and repository are instantiated ad hoc in the routes layer instead of being injected from the container.
3. **MEDIUM** (design question): The service layer adds zero business logic and purely forwards repository calls, which may indicate overengineering for what is currently a pure-CRUD module.

---

## Issues

### 1. Raw Drizzle Type Exported from Repository (CRITICAL)

**Location:** `repository.ts`, lines 62–64

```ts
export {
  type typeof t.users.$inferSelect as UserRow,
};
```

**Problem:**

This exports `UserRow` as a raw Drizzle-inferred type. Per SKILL.md (Repository Export Boundaries section):

> "repository.ts must export **DTO types** (application-layer shapes like `InsertUser`, `UpdateUser`, `UserResponse`), never raw Drizzle-inferred types (`typeof t.users.$inferSelect`). A raw Drizzle type leaked from `repository.ts` couples every importer (including tests, service code, even other modules via re-exports) to the current DB schema — a change to the schema breaks all those consumers unnecessarily."

The service already uses this type in its return signatures (service.ts, lines 12, 16, 25, 34), which means:
- When the `users` table schema changes, the service code breaks without the service author knowing why.
- Tests that stub the repository will have to match the exact Drizzle inferred shape.
- Other modules re-exporting this type silently couple to schema details they don't control.

**Fix:**

Define a proper `UserResponse` (or `User`) DTO in `repository.ts` that captures the public shape of a user as returned from the API:

```ts
export interface UserResponse {
  id: string;
  workspaceId: string;
  name: string;
  email: string;
  role: 'admin' | 'user';
}
```

Update repository methods to return `UserResponse` instead of the raw row:

```ts
async list(workspaceId: string): Promise<UserResponse[]> {
  return this.db
    .select()
    .from(t.users)
    .where(eq(t.users.workspaceId, workspaceId));
}
```

Then update service.ts to import `UserResponse` instead of `UserRow`:

```ts
import type { UserResponse } from './repository.js';

async listUsers(workspaceId: string): Promise<UserResponse[]> {
  return this.repo.list(workspaceId);
}
```

This is the anti-corruption pattern: the application layer (service) and presentation layer (routes) code against a stable contract that the infrastructure layer (repository) promises, not against the raw schema.

---

### 2. Composition Root Discipline Broken (MEDIUM)

**Location:** `routes.ts`, line 24 and `service.ts`, line 9

**Problem:**

Routes instantiates the service directly:
```ts
const service = new UsersService(app.container);
```

And the service instantiates the repository directly:
```ts
constructor(private container: Container) {
  this.repo = new UsersRepository(container.db);
}
```

According to SKILL.md (Composition Root section):

> "`server/src/platform/container.ts` is the _only_ file allowed to import both an adapter's interface and its concrete implementation together (it's the composition root)."

Having multiple instantiation points makes the module harder to test (you can't swap in a mock repository without modifying the service class), and it violates the single-responsibility principle for wiring. The container is the composition root — all wiring should happen there.

**Fix:**

Add the service and repository to `platform/container.ts`:

```ts
export interface Container {
  usersRepo: UsersRepository;
  usersService: UsersService;
  // ... other services
}

export function createContainer(overrides?: ContainerOverrides): Container {
  const db = overrides?.db ?? new Db();
  const usersRepo = overrides?.usersRepo ?? new UsersRepository(db);
  const usersService = overrides?.usersService ?? new UsersService(usersRepo);
  
  return {
    usersRepo,
    usersService,
    // ... rest
  };
}
```

Then in routes.ts, inject the service from the container:

```ts
const service = app.container.usersService;
```

And update service.ts to receive the repository in the constructor rather than creating it:

```ts
export class UsersService {
  constructor(private repo: UsersRepository) {}

  async listUsers(workspaceId: string): Promise<UserResponse[]> {
    return this.repo.list(workspaceId);
  }
  // ...
}
```

This follows the pattern already established in this repo (see examples.md, lines 140–152).

---

### 3. Empty Service Layer (MEDIUM — Design Question)

**Location:** `service.ts`, all methods

**Problem:**

The service class is a pure pass-through: each method receives parameters, calls the corresponding repository method with those same parameters, and returns the result. There is zero business logic, validation, or coordination.

From SKILL.md (Graduated Layering section, lines 114–121):

> "Don't add an empty `service.ts` that just forwards one call to `repository.ts` with zero logic in between — that's boilerplate the graduated model exists to avoid."

According to LAYER_MAP.md, `workspace` is correctly classified as Flat (routes only) because it is "pure CRUD". If users is similarly pure CRUD with no business logic, it should follow the same pattern.

**Consideration:**

However, if you *intend* to add business logic in the service layer (e.g., email-uniqueness validation per workspace, role-change audit logging, rate-limiting on user creation, or syncing with an external identity provider), then having the service layer now is justified — it's not boilerplate, it's readiness for the logic that's coming.

**Recommendation:**

If users module will remain pure CRUD forever:
- Remove `service.ts` and call the repository directly from routes (as `workspace` does).
- Update LAYER_MAP.md to classify users as Flat.

If you plan to add business logic soon:
- Keep the service layer, but do add that logic as you build it.
- Add a comment to `service.ts` explaining what logic will go there.

If you're unsure:
- Keep the service layer for now (it's not wrong, just not minimal), but make the decision explicit in a code comment or AGENTS.md.

---

## Ready to Wire Into `modules/index.ts`?

**Not quite.** Fix issue #1 (the critical DTO export) before registering this module. Issues #2 and #3 should be addressed before or immediately after registration, depending on your timeline and the module's intended complexity.

Once those are fixed, the module will be ready — the dependency direction is sound, the routes are thin, and the HTTP-boundary validation is in the right place.
