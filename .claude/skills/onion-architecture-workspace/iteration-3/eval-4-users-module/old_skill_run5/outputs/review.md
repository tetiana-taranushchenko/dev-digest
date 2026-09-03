# Code Review: Users Module (routes, service, repository)

## Summary

The users module has **two CRITICAL dependency-inversion violations** and one **MEDIUM architectural mismatch** that should be addressed before wiring it into `modules/index.ts`. The layering is conceptually correct (routes → service → repository), but the composition root is violated, and the service layer is overengineered for the actual complexity of the module.

---

## Findings

### CRITICAL: Service Instantiation Violates Composition Root

**Location:** `routes.ts:24`

```ts
const service = new UsersService(app.container);
```

The service is instantiated ad-hoc inside routes.ts. This violates the composition-root discipline established in `server/src/platform/container.ts`, which is the **only** place where interface and concrete implementation should be wired together.

**Why this matters:** Routes should receive the service from the container (injected), not create it. This ensures a single point of configuration, enables test mocking (swapping mock adapters in `ContainerOverrides`), and prevents scattered wiring across multiple modules.

**Fix:** Move service instantiation to `container.ts`:

```ts
// server/src/platform/container.ts
export function createContainer(overrides?: ContainerOverrides): Container {
  return {
    // ... existing adapters ...
    usersService: new UsersService(/* ... */),
  };
}

// Then in routes.ts:
const service = app.container.usersService;
```

---

### CRITICAL: Repository Instantiation Violates Composition Root

**Location:** `service.ts:9`

```ts
this.repo = new UsersRepository(container.db);
```

The repository is instantiated inside the service. Like the routes violation above, this breaks composition-root discipline.

**Fix:** Pass the repository to the service constructor, or wire it in the container:

```ts
// Option A: Inject via constructor
constructor(private container: Container, private repo: UsersRepository) {}

// Option B: Wire in container and pass via container
// server/src/platform/container.ts
usersRepo: new UsersRepository(overrides?.db ?? this.db),
usersService: new UsersService(
  this.container,
  this.usersRepo, // pass the wired instance
),

// Then in service.ts
constructor(private container: Container, private repo: UsersRepository) {}
```

---

### MEDIUM: Service Layer is Overengineered (Graduated Layering Violation)

**Location:** `service.ts` (entire file)

The service layer is a pure pass-through: every method forwards directly to the repository with zero business logic, transformation, or coordination.

```ts
async listUsers(workspaceId: string): Promise<UserRow[]> {
  return this.repo.list(workspaceId); // ← no logic
}

async createUser(workspaceId, name, email, role): Promise<UserRow> {
  return this.repo.insert(workspaceId, { name, email, role }); // ← no logic
}
```

According to the skill's "Graduated Layering by Module Complexity" rule:

> Don't add an empty `service.ts` that just forwards one call to `repository.ts` with zero logic in between — that's boilerplate the graduated model exists to avoid.

The test is: **does the module make a decision, compute a derived value, or coordinate multiple data sources/adapters?** The users module does none of these—it's pure CRUD against a single table with no cross-source coordination.

**Recommendation:** Remove the service layer and have routes call the repository directly, like the existing `workspace` module (Flat classification in LAYER_MAP.md):

```ts
// routes.ts
app.get('/users', async (req) => {
  const { workspaceId } = await getContext(app.container, req);
  return app.container.usersRepo.list(workspaceId);
});

app.post('/users', { schema: { body: CreateUserBody } }, async (req, reply) => {
  const { workspaceId } = await getContext(app.container, req);
  const user = await app.container.usersRepo.insert(workspaceId, {
    name: req.body.name,
    email: req.body.email,
    role: req.body.role,
  });
  reply.status(201);
  return user;
});
```

**When to keep the service layer:** If the module later gains business logic (validation rules like "email must be unique across the workspace before insert", coordination like "when adding a user, also sync to GitHub org", or decisions like "reject admin role if workspace has no admin cap"), then extract that logic into the service and keep it.

---

### MEDIUM: Type Export Syntax Error

**Location:** `repository.ts:62-64`

```ts
export {
  type typeof t.users.$inferSelect as UserRow,
};
```

This syntax is invalid. TypeScript doesn't accept `export { type typeof ... as Alias }`. The Drizzle pattern requires a type alias:

**Fix:**

```ts
export type UserRow = typeof t.users.$inferSelect;
```

---

## Positive Points

- **Routes layer is thin.** No business logic in routes; proper responsibility division.
- **Zod validation at the boundary.** CreateUserBody and UpdateUserBody validate shape correctly; no domain invariants leaked into `.refine()`.
- **Repository abstraction is sound.** Drizzle is fully hidden behind typed functions (list, getById, insert, update, delete); the service would depend on the interface, not on db/schema directly. This maintains the dependency-inversion barrier.
- **Correct overall dependency direction.** Routes → Service → Repository → Drizzle, inward all the way (ignoring the composition-root violations).
- **Workspace isolation.** Every query correctly filters by workspaceId, maintaining multi-tenant integrity.

---

## Before Wiring into modules/index.ts

1. **Fix the composition root violations** (CRITICAL): Move service and repository instantiation to `container.ts`.
2. **Flatten the module to routes + repository** (MEDIUM): Remove `service.ts` per the graduated-layering rule; this is pure CRUD.
3. **Fix the type export** (MEDIUM): Change line 62-64 to a proper type alias.
4. Update `LAYER_MAP.md` to classify `users` as **Flat** (routes, repository only, no service).

After these fixes, the module is ready to register.

---

## References

- Skill: onion-architecture v0.1.0 — "Dependency Direction (CRITICAL)", "Graduated Layering by Module Complexity (HIGH)", "Composition Root (MEDIUM)"
- LAYER_MAP.md: See `workspace` module (Flat classification) and `agents` module (Full split, with business logic justifying the service layer)
- examples.md: See "Graduated Layering" section for the flat-vs-split decision pattern
