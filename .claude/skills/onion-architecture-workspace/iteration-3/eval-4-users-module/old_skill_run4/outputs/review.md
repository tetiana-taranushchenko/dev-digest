# Users Module Architecture Review

## Summary

The users module is well-structured at the dependency-direction level (routes → service → repository) and correctly isolates Drizzle into the repository layer. However, it violates the **graduated layering principle** by including an empty `service.ts` that forwards calls to the repository with zero business logic. According to the onion-architecture skill, this is boilerplate that should not exist—the module should either be completely flat (routes calling repository directly) or kept flat with only a thin repository helper.

---

## Findings

### MEDIUM: Unnecessary Service Layer (Graduated Layering Violation)

**Location:** `service.ts`

**Issue:** The service layer is an empty pass-through that adds no business logic. Every method simply forwards to the repository with no orchestration, validation, or derived computation:

- `listUsers()` → calls `repo.list()`
- `getUser()` → calls `repo.getById()`
- `createUser()` → calls `repo.insert()`
- `updateUser()` → calls `repo.update()`
- `deleteUser()` → calls `repo.delete()`

**Skill guidance:** From SKILL.md, "Graduated Layering by Module Complexity":
> Does the module make a decision, compute a derived value, or coordinate multiple data sources/adapters?
> No — it's pure validate → read/write one table → return → a flat `routes.ts` (optionally with a thin `repository.ts`) is correct, not a shortcut.

The users module meets the "No" case: it's pure CRUD against a single table with no cross-source coordination or business rules.

**Skill example:** examples.md shows the anti-pattern:
```ts
// BAD — an empty pass-through service added "for consistency" to a CRUD module
export async function getPull(container: Container, id: string) {
  return repo.findById(id); // zero logic — this file adds nothing
}
```

**Why it matters:** Empty service layers increase maintenance burden and make the codebase feel inconsistent. The skill exists to justify layering; layers without logic obscure that justification.

**Recommendation:** Remove `service.ts` and have `routes.ts` call the repository directly, matching the pattern used in `workspace` and `polling` modules (per LAYER_MAP.md). The repository interface remains the same—`routes.ts` just imports and uses it directly.

---

### MEDIUM: Ad-Hoc Service/Repository Instantiation (Composition Root Violation)

**Location:** `routes.ts` line 24, `service.ts` line 9

**Issue:** The service and repository are instantiated ad hoc inside the plugin, rather than wired once in the composition root (`container.ts`):

```ts
// routes.ts line 24
const service = new UsersService(app.container);

// service.ts line 9
this.repo = new UsersRepository(container.db);
```

**Skill guidance:** From SKILL.md, "Composition Root":
> `server/src/platform/container.ts` + `server/src/adapters/*` already model ports-and-adapters correctly (prod adapters vs. `src/adapters/mocks.ts` for tests, via `ContainerOverrides`). Reinforce this existing pattern for new adapters — don't invent a second wiring mechanism.

And from examples.md, the bad pattern:
```ts
// BAD — a new adapter wired up ad hoc inside a service instead of the container
import { RealEmbedderAdapter } from "../../adapters/embedder/real.js";
const embedder = new RealEmbedderAdapter(); // second wiring point — don't do this
```

**Why it matters:**
- Multiple instantiation points make testing harder (can't override with mocks via `ContainerOverrides`)
- Violates the single-wiring principle that keeps the container as the source of truth
- Makes the dependency graph harder to understand and maintain

**Recommendation:** Wire the service (and repository if kept) in `container.ts` and inject it into the routes plugin. Pattern from the skill and existing modules:

```ts
// server/src/platform/container.ts
export function createContainer(overrides?: ContainerOverrides): Container {
  return {
    usersService: overrides?.usersService ?? new UsersService(/* db or repo */),
    // ...
  };
}

// server/src/modules/users/routes.ts
export default async function usersRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = app.container.usersService; // inject, don't instantiate
  // ...
}
```

---

### MINOR: Type Export Formatting

**Location:** `repository.ts` line 62–64

**Issue:** The type export uses a non-standard pattern:
```ts
export {
  type typeof t.users.$inferSelect as UserRow,
};
```

This works but is atypical. A clearer pattern (used elsewhere in the codebase) would be:
```ts
export type UserRow = typeof t.users.$inferSelect;
```

This is purely stylistic and does not affect functionality.

---

## What's Good

1. **Dependency direction is clean:** routes → service → repository, no reverse edges.
2. **Validation placement is correct:** Zod schemas in `routes.ts` validate shape; no business invariants in Zod refinements.
3. **Repository isolation:** Drizzle is correctly confined to `repository.ts`; the service layer depends on the repository's function surface, not the database directly.
4. **DTO patterns:** `InsertUser` and `UpdateUser` interfaces are well-defined.
5. **Error handling:** The routes layer appropriately throws `NotFoundError` for missing resources and lets the service propagate or the repository return undefined.

---

## Checklist Before Wiring into `modules/index.ts`

- [ ] Remove `service.ts` (or refactor routes to flatten the call chain)
- [ ] Wire the repository (or service, if you choose to keep it) in `container.ts` with dependency injection
- [ ] Update the type export in `repository.ts` to the clearer single-line pattern (optional, stylistic)
- [ ] Verify the module classification in LAYER_MAP.md (should be "Flat" if you remove service.ts)

---

## Summary for Review

The users module has clean layering and correct dependency direction, but it carries an unnecessary service layer that forwards calls with no logic—a violation of the graduated-layering principle. Fix by either removing the service layer (preferred for pure CRUD) or adding real business logic if requirements change. Additionally, follow the composition-root pattern by wiring the repository/service in `container.ts` and injecting into routes rather than instantiating ad hoc.
