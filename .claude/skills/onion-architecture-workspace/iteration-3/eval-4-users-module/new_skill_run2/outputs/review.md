# Code Review: Users Module (routes.ts, service.ts, repository.ts)

## Summary

The users module has three architecture violations that need fixing before wiring into `modules/index.ts`. Two are **CRITICAL** — they break dependency inversion and the composition-root pattern — and one is **HIGH**, signaling layering drift as the codebase grows. The third is a **MEDIUM** consistency question: does this module actually need a service layer, or is it pure CRUD?

---

## Findings

### 1. **CRITICAL: Raw Drizzle type leaked from repository (repository.ts:62–64)**

**Problem:**
```ts
export {
  type typeof t.users.$inferSelect as UserRow,
};
```

The repository exports a raw Drizzle-inferred type. Per the skill's "Repository Export Boundaries" rule, this couples every consumer of `UserRow` (the service, routes, tests, and any other module that re-exports it) to the current database schema. When the `users` table schema changes, all those consumers break — even though they shouldn't care about internal schema details.

**Evidence from SKILL.md:**
> `repository.ts` must export **DTO types** (application-layer shapes like `InsertUser`, `UpdateUser`, `UserResponse`), never raw Drizzle-inferred types (`typeof t.users.$inferSelect`).

**Fix:**
Define a proper DTO (Data Transfer Object) in the repository instead:
```ts
export interface UserResponse {
  id: string;
  workspaceId: string;
  name: string;
  email: string;
  role: 'admin' | 'user';
  // (other fields as needed)
}
```

Then update the service and routes to use `UserResponse` instead of `UserRow`. The repository's methods can still use Drizzle internally, but they expose application-layer DTOs at the boundary.

**Severity: CRITICAL** — breaks the anti-corruption layer that insulates the service from schema changes.

---

### 2. **CRITICAL: Service instantiates repository; violates composition root (service.ts:8–9)**

**Problem:**
```ts
export class UsersService {
  private repo: UsersRepository;

  constructor(private container: Container) {
    this.repo = new UsersRepository(container.db); // ❌ creates its own instance
  }
```

The service `new`s up the repository inside its constructor. This breaks the composition-root pattern enforced by `server/src/platform/container.ts`. According to the skill, that container is the *sole* wiring point — adapters and repositories are wired there, not ad hoc inside services.

**Why this matters:**
- **Testability:** Tests cannot mock the repository for the service (it's always a real `UsersRepository`).
- **Composition discipline:** A second wiring point invites inconsistency — another developer might wire a different way later, or the container overrides won't be honoured for this module.
- **Dependency inversion:** The service depends on the concrete class, not an interface.

**Evidence from SKILL.md:**
> `server/src/platform/container.ts` + `server/src/adapters/*` already model ports-and-adapters correctly (prod adapters vs. `src/adapters/mocks.ts` for tests, via `ContainerOverrides`). Reinforce this existing pattern for new adapters — don't invent a second wiring mechanism.

**Fix:**
1. Extract a `UsersRepository` interface (the public method contract).
2. Wire the repository in `container.ts`:
   ```ts
   export interface Container {
     // ...
     usersRepo: UsersRepository;
   }
   
   export function createContainer(overrides?: ContainerOverrides): Container {
     return {
       // ...
       usersRepo: overrides?.usersRepo ?? new UsersRepository(db),
     };
   }
   ```
3. Inject it into the service:
   ```ts
   export class UsersService {
     constructor(private container: Container) {}
     
     async listUsers(workspaceId: string) {
       return this.container.usersRepo.list(workspaceId);
     }
     // ...
   }
   ```

**Severity: CRITICAL** — breaks the single-composition-root discipline that keeps tests and prod wiring consistent.

---

### 3. **HIGH: Service is a thin pass-through; violates graduated layering (service.ts)**

**Problem:**
Every method in `UsersService` is a one-line forward to the repository with zero logic:
```ts
async listUsers(workspaceId: string): Promise<UserRow[]> {
  return this.repo.list(workspaceId); // no decision, no coordination, no mapping
}
```

Per the skill's graduated-layering rule, a service should exist only if the module "makes a decision, compute[s] a derived value, or coordinat[es] multiple data sources/adapters." The users module is pure CRUD of a single table — validation happens at the routes layer (Zod). There's no business logic here.

**Two valid approaches:**

**Option A: Go flat** — remove the service entirely, have routes call the repository directly (like `workspace/` and `pulls/` do). This is correct for pure-CRUD modules.

**Option B: Keep the service if** there *is* actual business logic to add later (e.g. "cannot delete a user if they own active reviews", "validate email domain against workspace config"). But then remove the empty pass-throughs now and add the service layer *when* the logic arrives.

**Evidence from SKILL.md & examples.md:**
> Don't add an empty `service.ts` that just forwards one call to `repository.ts` with zero logic in between — that's boilerplate the graduated model exists to avoid.

And from the bad example in examples.md:
```ts
// BAD — an empty pass-through service added "for consistency" to a CRUD module
export async function getPull(container: Container, id: string) {
  return repo.findById(id); // zero logic — this file adds nothing
}
```

**Recommendation:**
Either (1) delete `service.ts` and have routes call `container.usersRepo` directly, or (2) keep it as a placeholder with a comment explaining expected business logic that will live there, but don't populate it with pass-throughs.

**Severity: HIGH** — will cause layering drift; every flat module with "simple" logic will start growing its own unnecessary service layers.

---

### 4. **MEDIUM: Routes instantiate service per-request (routes.ts:24)**

**Problem:**
```ts
export default async function usersRoutes(appBase: FastifyInstance) {
  // ...
  const service = new UsersService(app.container); // created once per route registration
```

This is less severe than the repository issue, but worth noting: the service is instantiated once when routes are registered (stateless, so it's harmless). However, once the service is wired via the container properly (fixing finding #2), the pattern becomes:
```ts
export default async function usersRoutes(app: FastifyInstance) {
  return async (req, reply) => {
    const service = new UsersService(app.container); // now safe, but still unnecessary
  };
}
```

If the service becomes stateless (like most in this repo), consider whether it should be a namespace of pure functions rather than a class. That said, the existing agents module models it as a class, so consistency here is fine once the injection is fixed.

**Severity: MEDIUM** — works, but is awkward once composition root is fixed. Reconsider as part of fixing #2.

---

## Next Steps

**Before wiring into `modules/index.ts`:**

1. **Wrap `UserRow` in a DTO** — define `UserResponse` in repository.ts, update service and routes to use it.
2. **Wire repository via container** — add `usersRepo` to the container interface and `createContainer()`, inject it into the service.
3. **Decide: flat or service?** — either delete the service layer (CRUD is simple), or keep it as a placeholder for future business logic, but remove pass-through methods.
4. **Update routes** — once the service is injected via container, adjust the instantiation pattern.

Once these are fixed, the module will align with the onion-architecture rules and won't require retrofitting later.
