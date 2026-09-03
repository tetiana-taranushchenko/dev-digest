# Code Review: Users Module (routes, service, repository)

## Overview

Your users module follows the onion-architecture dependency direction correctly overall (routes → service → repository → domain), and the HTTP layer is clean. However, there are two significant issues that should be resolved before wiring this into `modules/index.ts`: one around DTO boundaries (HIGH) and one about graduated layering (HIGH).

---

## Issue 1: Raw Drizzle Type Leaked from Repository (HIGH)

**Location**: `repository.ts`, lines 62–64

```ts
export {
  type typeof t.users.$inferSelect as UserRow,
};
```

**Problem**

You're exporting `UserRow` as a raw Drizzle-inferred type (`typeof t.users.$inferSelect`). Per the skill's "Repository Export Boundaries" section, this violates the DTO boundary and couples every consumer—including your service, routes, tests, and any downstream module that re-exports it—to the current database schema. If the schema changes (e.g., a column is added, renamed, or removed), all those consumers break unnecessarily.

**The Right Pattern**

Export a stable **DTO type** instead. Define shapes that the service and routes code against:

```ts
// DTO types the service will use (never raw Drizzle)
export interface UserResponse {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'user';
  workspaceId: string;
  createdAt: Date;
  updatedAt: Date;
}

// Repository methods return DTOs
async list(workspaceId: string): Promise<UserResponse[]> {
  const rows = await this.db
    .select()
    .from(t.users)
    .where(eq(t.users.workspaceId, workspaceId));
  return rows.map((row) => toUserResponse(row));
}

// Helper to map Drizzle row → DTO (encapsulates schema knowledge)
function toUserResponse(row: typeof t.users.$inferSelect): UserResponse {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    workspaceId: row.workspaceId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
```

Then update your service to use `UserResponse`:

```ts
async listUsers(workspaceId: string): Promise<UserResponse[]> {
  return this.repo.list(workspaceId);
}

async getUser(workspaceId: string, id: string): Promise<UserResponse | undefined> {
  return this.repo.getById(workspaceId, id);
}
```

This way, your schema can evolve without breaking callers.

---

## Issue 2: Service Layer is Empty Boilerplate (HIGH)

**Location**: `service.ts`, entire file

**Problem**

Your service is a pure pass-through with zero business logic—every method just forwards to the repository:

- `listUsers` → `repo.list()`
- `getUser` → `repo.getById()`
- `createUser` → `repo.insert()`
- etc.

Per the skill's "Graduated Layering by Module Complexity" section, this is exactly the anti-pattern to avoid:

> Don't add an empty `service.ts` that just forwards one call to `repository.ts` with zero logic in between — that's boilerplate the graduated model exists to avoid.

The graduated-layering rule asks: **does the module make a decision, compute a derived value, or coordinate multiple data sources?**

For users management (pure CRUD, single table, no coordination), the answer is **no**.

**The Right Pattern**

According to LAYER_MAP.md, a pure-CRUD workspace module should be **flat**: `routes.ts` calls `repository.ts` directly, with no service layer. See the `workspace` module classification:

```
| `workspace` | Flat | routes only | Pure CRUD |
```

**Recommended change**: Remove `service.ts` entirely. Call the repository directly from routes:

```ts
// routes.ts
import { UsersRepository, type UserResponse } from './repository.js';

export default async function usersRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const repo = new UsersRepository(app.container.db);

  app.get('/users', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return repo.list(workspaceId);
  });

  app.get('/users/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const user = await repo.getById(workspaceId, req.params.id);
    if (!user) throw new NotFoundError('User not found');
    return user;
  });

  // ... etc
}
```

If, in the future, user creation requires a business decision (e.g., checking team-size limits, sending an invitation email, deriving role from team rules), then promote the module to full split and add real logic to `service.ts`. Until then, keep it flat.

---

## Issue 3: Repository Instantiation in Service (MEDIUM)

**Location**: `service.ts`, line 9

```ts
constructor(private container: Container) {
  this.repo = new UsersRepository(container.db);
}
```

**Context**

This is a minor concern given Issue 2 removes the service altogether. But for reference: most modules follow the composition-root pattern where repositories are wired once in `platform/container.ts` and injected everywhere else. If you ever do add a real service layer, consider having the container provide the repository rather than instantiating it in the service:

```ts
// platform/container.ts
export function createContainer(overrides?: ContainerOverrides): Container {
  return {
    // ...
    usersRepo: overrides?.usersRepo ?? new UsersRepository(db),
  };
}

// service.ts
constructor(private container: Container) {
  this.repo = container.usersRepo; // injected, not instantiated
}
```

This makes testing easier (mock the repo in `ContainerOverrides`) and keeps the wiring centralized.

---

## Positive Notes

- **Dependency direction is clean**: routes → service → repository, never reversed. ✓
- **HTTP layer is thin**: routes.ts validates with Zod, extracts context, delegates, and returns. No business rules or SQL. ✓
- **Proper error handling**: Uses `NotFoundError` from the platform layer. ✓
- **Workspace scoping**: Correctly scopes all operations to the workspace. ✓

---

## Recommendation Before Wiring to `modules/index.ts`

1. **Remove `service.ts`** entirely (it's boilerplate under graduated layering).
2. **Define a `UserResponse` DTO** in `repository.ts` and map Drizzle rows to it (fixes the raw-type leak).
3. **Update `routes.ts`** to instantiate and use the repository directly.
4. **If future requirements add business logic** (validation beyond Zod shape, coordination, side effects), add the service layer back with real logic, not an empty pass-through.

After those changes, the module will be architecturally sound and ready to register.
