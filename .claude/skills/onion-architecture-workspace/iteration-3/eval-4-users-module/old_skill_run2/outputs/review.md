# Users Module: Onion Architecture Review

## Overview
The users module (routes.ts, service.ts, repository.ts) is a workspace-aware CRUD module for managing users. Overall structure is sound in dependency direction, but violates the graduated-layering principle by including an empty pass-through service layer that should not exist.

---

## Issues by Severity

### CRITICAL: Composition Root Violation (service.ts, line 9)

**Pattern:**
```typescript
export class UsersService {
  private repo: UsersRepository;

  constructor(private container: Container) {
    this.repo = new UsersRepository(container.db);  // ← direct instantiation
  }
```

**Problem:** The service instantiates `UsersRepository` directly rather than receiving it as an injected dependency. This creates a **second wiring point** outside the composition root (container.ts), violating the architecture's dependency-inversion mechanism.

Per SKILL.md (Composition Root section): "the adapter is wired once in platform/container.ts, injected everywhere else." The same principle applies to repositories — they should be wired once, not instantiated ad-hoc in services.

**Fix:** Inject the repository as a constructor parameter instead of creating it:
```typescript
export class UsersService {
  constructor(private container: Container, private repo: UsersRepository) {}
```

Then wire both service and repository in container.ts when registering the users module, so they're created once and shared. Routes then receives the service from container.

---

### HIGH: Empty Service Layer (service.ts, entire file)

**Problem:** The service.ts is a pure pass-through wrapper. Every method forwards directly to the repository with zero business logic:
- `listUsers()` → calls `repo.list()`
- `getUser()` → calls `repo.getById()`
- `createUser()` → calls `repo.insert()`
- `updateUser()` → calls `repo.update()`
- `deleteUser()` → calls `repo.delete()`

Per SKILL.md (Graduated Layering section):
> "Don't add an empty service.ts that just forwards one call to repository.ts with zero logic in between — that's boilerplate the graduated model exists to avoid."

The decision rule is: **Does the module make a decision, compute a derived value, or coordinate multiple data sources?**
- No decisions (this is pure CRUD)
- No derived values
- No cross-source coordination
- Zero business logic

**Correct Pattern:** This module should be **flat** — routes.ts should call the repository directly, with no service layer. See LAYER_MAP.md's `workspace` and `pulls` entries for examples (though `pulls` graduated to full split after gaining real business logic like GitHub sync-on-read and cost-window batching; users has none of that).

**Fix:** Delete service.ts. Modify routes.ts to instantiate and call the repository directly:
```typescript
// routes.ts
export default async function usersRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const repo = new UsersRepository(app.container.db);

  app.get('/users', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return repo.list(workspaceId);
  });
  // ... rest of routes
}
```

---

### HIGH: Service Instantiation Per Request (routes.ts, line 24)

**Pattern:**
```typescript
export default async function usersRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new UsersService(app.container);  // ← created per plugin call
```

**Problem:** A new UsersService instance is created every time the plugin runs (typically once at server startup, but the pattern is fragile). Services should ideally be singletons wired in the composition root and injected, not recreated per route.

This is less critical if the service is only instantiated once at startup, but it still means the wiring logic is split between routes and the service constructor, rather than centralized in container.ts.

**Note:** This issue cascades from the critical composition-root violation above. Once repositories are properly wired in container.ts, services (if they exist) should be too.

---

### MEDIUM: Missing Application-Layer DTO Mapping

**Problem:** The service imports and re-exports `UserRow` directly from the repository without any application-layer mapping:

```typescript
export {
  type typeof t.users.$inferSelect as UserRow,
};
```

Per SKILL.md (examples.md, "Dependency Direction" section), the service layer should perform "application-layer mapping" when returning data:
```typescript
const rows = await repo.findAll();
return rows.map(toAgentDto);  // ← application-layer transformation
```

**Context:** This is a lower-severity issue because the module is currently CRUD-only (no transformation needed). However, when/if business logic is added and the service layer becomes necessary, this should be addressed — DTOs should be defined at the service level, not re-exported from the repository layer.

**Note:** This issue dissolves if the correct fix is applied (flat module with no service), since routes would call the repository directly.

---

### MEDIUM: Inconsistent Workspace Isolation Enforcement

**Pattern:**
```typescript
// routes.ts extracts workspaceId from request context
const { workspaceId } = await getContext(app.container, req);
// Then passes it to every service method
const user = await service.getUser(workspaceId, req.params.id);

// repository.ts enforces the scope in WHERE clauses
.where(and(eq(t.users.workspaceId, workspaceId), eq(t.users.id, id)))
```

**Problem:** Workspace isolation is enforced only at the repository level, after a string is passed through the service. There's no type-level guarantee or validation in the service that `workspaceId` is valid — it's accepted as a bare string.

This isn't a layering violation per se, but it's a weak point. A stronger pattern would be to extract workspaceId once in routes, validate it early, and pass a scoped context or workspace object through the layers (not a string). However, this would require a broader architectural change and isn't specific to the users module.

**Status:** Keep as-is unless the broader workspace context pattern is redesigned.

---

## Dependency Direction: ✓ Correct

The actual dependency flow is correct:
- routes.ts imports service.ts
- service.ts imports repository.ts
- repository.ts imports Drizzle db/schema
- No backflow to routes or circular dependencies

Once the composition root violation is fixed, this remains sound.

---

## Validation Placement: ✓ Correct

- **Zod shapes** (request validation): Properly placed in routes.ts
  - `CreateUserBody`, `UpdateUserBody` validate HTTP request structure
- **Business rules**: Correctly absent (no business invariants exist for CRUD users)

---

## Repository Pattern: ✓ Correct

The repository layer is well-structured:
- Typed `InsertUser` and `UpdateUser` DTOs
- Exported `UserRow` type via Drizzle's `$inferSelect`
- Clean typed functions (`list`, `getById`, `insert`, `update`, `delete`)
- No leakage of query structure into callers

---

## Recommendations

### Priority 1 (Do before wiring into modules/index.ts)

1. **Delete service.ts entirely.** It adds no value and violates graduated layering.

2. **Refactor routes.ts to call repository directly:**
   ```typescript
   export default async function usersRoutes(appBase: FastifyInstance) {
     const app = appBase.withTypeProvider<ZodTypeProvider>();
     const repo = new UsersRepository(app.container.db);

     app.get('/users', async (req) => {
       const { workspaceId } = await getContext(app.container, req);
       return repo.list(workspaceId);
     });
     // ... update remaining routes
   }
   ```

3. **Keep repository.ts as-is** — it's correct and follows the pattern well.

### Priority 2 (Can be addressed in a future iteration)

- If business logic is added to the users module later (e.g., email-uniqueness validation, role-permission rules, user lifecycle state transitions), extract it into a service.ts at that time. Don't pre-emptively create the layer.

---

## Result

**Current state:** Module is architecturally unsound due to composition root violation and graduated-layering violation.

**After fixes:** Routes (thin) → Repository (data access). Clean, testable, correct for a CRUD module.

**Ready to wire into modules/index.ts?** No — apply Priority 1 fixes first.
