# Users Module Review — Onion Architecture

## Overview

You've created a properly layered structure (`routes.ts` → `service.ts` → `repository.ts`) with correct dependency direction at the *semantic* level: routes call service, service uses repository, repository owns Drizzle. However, there are three issues that violate the composition-root pattern and graduated-layering principle. Two are critical to the architecture; one is about whether the service layer belongs here at all.

---

## Critical Issues

### 1. Service Instantiation in Routes (routes.ts:24)

**Severity: CRITICAL — Breaks composition-root discipline**

```ts
const service = new UsersService(app.container);
```

This violates the composition-root pattern established in `server/src/platform/container.ts`. Routes should never instantiate services directly. The service must be wired once in the container and injected via `app.container.usersService` (or equivalent).

**Why it matters:** 
- Couples routes to the service's constructor signature; any change to the service constructor requires updating all route files.
- The container becomes the single wiring point for all adapters and services — this is lost when routes create services ad hoc.
- Makes testing harder: you can't override the service via `ContainerOverrides` in tests if routes instantiate it directly.

**Fix:** Wire the service in `server/src/platform/container.ts`:

```ts
// container.ts
export interface Container {
  // ... existing fields
  usersService: UsersService;
  // or through a factory if it needs lazy initialization
}

export function createContainer(overrides?: ContainerOverrides): Container {
  const db = overrides?.db ?? createDbClient();
  const usersService = overrides?.usersService ?? new UsersService(db);
  return {
    // ...
    usersService,
  };
}
```

Then in `routes.ts`:

```ts
const service = app.container.usersService;
```

---

### 2. Repository Instantiation in Service (service.ts:9)

**Severity: CRITICAL — Breaks composition-root discipline and dependency injection**

```ts
constructor(private container: Container) {
  this.repo = new UsersRepository(container.db);
}
```

The service is instantiating the repository directly. This should be injected, not created ad hoc.

**Why it matters:**
- Same coupling problem as issue #1: any change to the repository constructor affects the service.
- The service holds a reference to `Container` solely to instantiate the repository. It should receive the repository as a dependency instead.
- Breaks the dependency-inversion principle: the service should depend on the repository *interface* (its exported functions/types), not on its constructor.

**Fix:** Inject the repository as a constructor parameter:

```ts
export class UsersService {
  constructor(private repo: UsersRepository) {}

  async listUsers(workspaceId: string): Promise<UserRow[]> {
    return this.repo.list(workspaceId);
  }
  // ... rest of methods unchanged
}
```

Wire it in the container (combining with fix #1):

```ts
export function createContainer(overrides?: ContainerOverrides): Container {
  const db = overrides?.db ?? createDbClient();
  const usersRepo = overrides?.usersRepo ?? new UsersRepository(db);
  const usersService = overrides?.usersService ?? new UsersService(usersRepo);
  return {
    usersService,
    usersRepo,
    // ...
  };
}
```

---

## High-Severity Issue

### 3. Service Layer May Be Over-Engineered (service.ts, overall)

**Severity: HIGH — Violates graduated-layering principle**

The service currently contains zero business logic — all methods are pure pass-throughs to the repository:

```ts
async listUsers(workspaceId: string): Promise<UserRow[]> {
  return this.repo.list(workspaceId); // no logic
}

async createUser(...): Promise<UserRow> {
  return this.repo.insert(...); // no logic
}
```

Per the skill's graduated-layering rule (SKILL.md, line 96–105), **not every module needs a `service.ts`**. The test is: "does the module make a decision, compute a derived value, or coordinate multiple data sources/adapters?"

- Yes → full split (routes → service → repository) is correct.
- No → a flat `routes.ts` (with optional thin `repository.ts` for CRUD) is correct, not a shortcut.

For users, if there's no business logic (no role validation, no workspace membership checks, no constraints), then the service layer is boilerplate. The skill explicitly warns against this (line 105): *"Don't add an empty `service.ts` that just forwards one call to `repository.ts` with zero logic in between."*

**Decision tree:**

1. **If users CRUD has real business logic** (e.g., "you can only create an admin role if you're a workspace owner", "deleting a user requires checking no active runs exist"), then keep the service and add that logic. The layer becomes justified.
2. **If users is pure CRUD with no decisions**, flatten it: let `routes.ts` call the repository directly (see examples.md for the flat pattern). Remove `service.ts` entirely.

This is not a hard error — it's a code-clarity issue. The current structure won't break, but it costs maintainability. If you're *planning* to add validation logic, keep the structure and document that in a comment; if not, flatten it.

---

## Medium-Severity Issue

### 4. UserRow Type Export Syntax (repository.ts:62–64)

**Severity: MEDIUM — Code-style inconsistency**

```ts
export {
  type typeof t.users.$inferSelect as UserRow,
};
```

This syntax is non-standard. The `type typeof` construction works but is unusual. It should follow TypeScript's idiomatic pattern:

```ts
export type UserRow = typeof t.users.$inferSelect;
```

(Then import it as `import type { UserRow }` elsewhere, which you already do.)

**Why it matters:** It's not a bug, but other reviewers will flag it as odd. Use the simpler form for clarity.

---

## What's Correct

- **Dependency direction (semantic):** Routes → Service → Repository is correct.
- **Repository pattern:** Good encapsulation of Drizzle queries; service depends on exported functions, not on `schema` or `db` directly.
- **Routes are thin:** Zod validates shape, routes parse input and call the service, no business logic inline.
- **Interfaces and types:** `InsertUser` and `UpdateUser` are well-structured DTOs.

---

## Action Items Before Wiring into modules/index.ts

1. **Create fixes for issues #1 and #2** (move service and repository instantiation to `server/src/platform/container.ts`).
2. **Decide on issue #3:** Keep the service layer only if you have (or plan soon) business logic. If this is pure CRUD, flatten it to `routes.ts` → `repository.ts` directly.
3. **Fix issue #4:** Use the standard `export type UserRow = typeof t.users.$inferSelect` syntax.
4. **Update LAYER_MAP.md:** Add the users module to the table with its classification (full split vs. flat) and rationale once you've decided on #3.

---

## Reference

- Composition root: SKILL.md line 81–82, examples.md line 129–153
- Graduated layering: SKILL.md line 95–108, examples.md line 79–104
- Type exports: Standard TypeScript convention (TypeScript Handbook §11.3)
