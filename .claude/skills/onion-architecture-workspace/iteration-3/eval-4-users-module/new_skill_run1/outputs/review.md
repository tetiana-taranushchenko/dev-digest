# Code Review: Users Module (routes.ts, service.ts, repository.ts)

## Overall Assessment

The module demonstrates a proper three-layer structure with dependency direction flowing correctly (routes → service → repository). However, there are **two critical issues** blocking this from wiring into `modules/index.ts`: one breaks the domain/application boundary (raw Drizzle types leaking), and one violates the composition-root pattern.

---

## CRITICAL Issues

### 1. Raw Drizzle Type Exported from Repository (repository.ts:62-64)

**Issue:**
```ts
export {
  type typeof t.users.$inferSelect as UserRow,
};
```

This exports the raw Drizzle-inferred type directly. According to SKILL.md ("Repository Export Boundaries", lines 150-161):

> "repository.ts must export DTO types (application-layer shapes like InsertUser, UpdateUser, UserResponse), never raw Drizzle-inferred types. A raw Drizzle type leaked from repository.ts couples every importer (including tests, service code, even other modules via re-exports) to the current DB schema — a change to the schema breaks all those consumers unnecessarily."

**Impact:**  
- service.ts (line 3) now imports and returns `UserRow` throughout its public interface
- Routes depend on this type indirectly, coupling the presentation layer to the DB schema
- Tests of the service must now mock the Drizzle shape, not a clean DTO
- If `t.users` gains new columns (e.g., `createdAt`, `updatedAt`), all callers break

**Fix:**  
Define and export a DTO type instead. You already have `InsertUser` and `UpdateUser` (good!); add a response DTO:

```ts
// repository.ts
export interface UserResponse {
  id: string;
  workspaceId: string;
  name: string;
  email: string;
  role: 'admin' | 'user';
}

// Then map internal queries to the DTO:
async list(workspaceId: string): Promise<UserResponse[]> {
  const rows = await this.db.select().from(t.users)...;
  return rows.map(row => ({
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    email: row.email,
    role: row.role,
  }));
}
```

Then update service.ts to return `UserResponse` instead of `UserRow`.

---

### 2. Service Instantiation Outside Composition Root (routes.ts:24)

**Issue:**
```ts
const service = new UsersService(app.container);
```

Routes should not instantiate services directly. According to SKILL.md ("Composition Root", lines 163-168) and examples.md (lines 130-154), `server/src/platform/container.ts` is the **only** file allowed to wire dependencies. Services should be injected through the container.

**Current pattern (wrong):**
- Each route handler creates a new service instance
- Routes know the service's constructor signature
- If service dependencies change, all routes must be updated

**Expected pattern:**
- Container creates and caches the service once
- Routes request it from `app.container.usersService` (or via getter)
- Changes to service wiring are centralized

**Fix:**  
1. In `server/src/platform/container.ts`, add a `usersService` property:
   ```ts
   export type Container = {
     // ... other adapters
     usersService: UsersService;
   };
   
   export function createContainer(overrides?: ContainerOverrides): Container {
     return {
       // ...
       usersService: new UsersService(this), // injected with full container
     };
   }
   ```

2. In routes.ts, remove the instantiation:
   ```ts
   // DELETE: const service = new UsersService(app.container);
   // Instead:
   app.get('/users', async (req) => {
     const { workspaceId } = await getContext(app.container, req);
     return app.container.usersService.listUsers(workspaceId);
   });
   ```

---

## HIGH Issues

### 3. Service May Be an Unnecessary Pass-Through (service.ts:5-40)

**Issue:**  
Every service method is a thin forwarding wrapper with **no business logic**:
- `listUsers` → calls `repo.list()` and returns result unchanged
- `getUser` → calls `repo.getById()` and returns result unchanged
- etc.

According to SKILL.md ("Graduated Layering by Module Complexity", lines 113-121):

> "Not every module needs the full routes → service → repository split. Use this test: does the module make a decision, compute a derived value, or coordinate multiple data sources/adapters? No → it's pure validate → read/write one table → return → a flat routes.ts (optionally with a thin repository.ts) is correct, not a shortcut."

The examples explicitly warn against this (examples.md:91-104).

**Clarification needed:**  
Does the users module implement real business logic beyond CRUD? Examples might include:
- Enforcing role-based access rules (e.g., only workspace admins can add users)
- Audit logging or event emission on user creation/deletion
- Deriving computed fields (e.g., user tier based on usage)
- Coordinating with other services (e.g., provisioning external accounts)

If the answer is **no**, consider a flat structure: routes.ts → repository.ts directly, no service.ts. This is correctly implemented elsewhere in the codebase (e.g., `workspace` and `polling` modules per LAYER_MAP.md).

If the answer is **yes**, move that logic into the service methods and document it — the current code doesn't show it.

---

## MEDIUM Issues

### 4. Service Constructor Takes Full Container (service.ts:8)

**Current:**
```ts
constructor(private container: Container) {
  this.repo = new UsersRepository(container.db);
}
```

The service receives the full container but only uses `container.db`. This is acceptable but less precise than dependency injection at the method level.

**Prefer** (if using composition root approach above):
```ts
constructor(private db: Db) {}
```

This makes the service's actual dependencies explicit and testable without the full container.

---

## Summary & Next Steps

**Before wiring into modules/index.ts:**

1. **Fix the DTO export** (CRITICAL): Replace `UserRow` export with a `UserResponse` interface and map queries to it.
2. **Move service creation to container** (CRITICAL): Wire `usersService` in `server/src/platform/container.ts` and inject via `app.container`.
3. **Clarify service scope** (HIGH): If this is pure CRUD with no business logic, consider removing the service.ts and calling the repo directly from routes. If there is business logic, add it to the service methods.
4. **Refine container injection** (MEDIUM): Pass only `db` to the service constructor instead of the full container (depends on step 2).

**Styling notes:**  
- Routes and repository are well-written — minimal, clear, proper error handling.
- Zod validation placement is correct.
- Workspace scoping via `getContext` is appropriate.

Once these are resolved, the module will be ready for integration.
