Here's my review of the notifications module, checked against the onion-architecture rules (dependency direction, domain purity, graduated layering, validation placement, composition root).

Overall: not ready to register yet — there are two CRITICAL boundary violations that need fixing first, plus a couple of HIGH-severity issues. The shape of the module (routes/service/repository) is right, but the actual code doesn't respect the split it set up.

**CRITICAL — routes.ts imports and calls the repository directly, bypassing service.ts**

`routes.ts:11,16` does `import { NotificationsRepository } from './repository.js'` and instantiates its own `repo = new NotificationsRepository(app.container.db)`, then uses it in two places: the `CreateNotificationBody` Zod refine (`routes.ts:24`, `repo.userExists(...)`) and directly in the POST handler (`routes.ts:46`, `repo.insert(...)`). Per the skill, "`routes.ts` never imports `repository.ts` or `server/src/adapters/*` directly." The create flow needs to go through `service.ts` — add a `service.create(...)` method that does the existence check and the insert, and delete the `repo` instance and import from `routes.ts` entirely.

**CRITICAL — routes.ts builds a raw Drizzle query inline for the unread-count endpoint**

`routes.ts:5-6` imports `eq` from `drizzle-orm` and `* as t from '../../db/schema.js'` directly into the presentation layer, and `routes.ts:37-41` runs `app.container.db.select().from(t.notifications).where(...)` right in the handler, then filters the result by `userId`/`status` in JavaScript. This is a route talking to Drizzle directly (skipping both service and repository) and it's also just inefficient — it pulls every notification row for the whole workspace over the wire to count a handful of them client-side in JS. Fix: add `countUnread(workspaceId, userId)` to `repository.ts` that does the filtering in SQL (`and(eq(workspaceId), eq(userId), eq(status, 'unread'))` with a `count()`), expose it through `service.unreadCount(...)`, and have the route just call the service.

**HIGH — business invariant encoded as a Zod `.refine()`**

`routes.ts:18-26`, the `CreateNotificationBody` schema does `.refine(async (b) => repo.userExists(b.userId), { message: 'userId must reference an existing user' })`. The skill calls this out specifically: "Business/domain invariants... belong in `service.ts`, never encoded as a Zod `.refine()`." Zod here should validate shape only (`userId` is a UUID string, `kind`/`body` are non-empty strings) — that part's fine. The "does this user exist" check is a domain invariant and needs to move into `service.create()`, which calls `repo.userExists`, then throws something like `NotFoundError('User not found')` if it fails, the same way `markRead` already does for missing notifications.

**HIGH — service.ts is currently a zero-logic pass-through, but the module does have real logic — it's just sitting in the wrong file**

Right now `service.ts:12-18` is two one-line forwards to the repository (`list` → `repo.list`, `markRead` → `repo.markRead`), which is exactly the boilerplate pattern the graduated-layering rule warns against ("Don't add an empty `service.ts` that just forwards one call to `repository.ts` with zero logic in between"). But that doesn't mean this module should go flat — it does compute a derived value (the unread count) and does have a real invariant to enforce (user must exist before creating a notification), which is exactly the "yes" case for keeping `service.ts`. The fix isn't to remove `service.ts`, it's to move the two pieces of logic that currently leaked into `routes.ts` (the existence check and the count aggregation) into it, giving you `service.create()` and `service.unreadCount()` alongside the existing `list`/`markRead`.

**Worth a look before you register this, even though it's outside the onion skill's scope: `markRead` isn't scoped to workspace/user**

`repository.ts:23-30`, `markRead(id)` updates by notification id alone, with no `workspaceId`/`userId` check — `list()` two lines above it does scope by both. As written, any authenticated caller who knows or guesses a notification id could mark another user's (or another workspace's) notification as read via `PUT /notifications/:id/read`. Since `service.markRead` already has the context available from `getContext` in the route, I'd pass `workspaceId`/`userId` through and have the repository filter on all three, returning `undefined` (→ your existing `NotFoundError`) if it doesn't match.

No issues on domain purity (this module doesn't touch `reviewer-core`, correctly) or the composition root (nothing here wires an adapter interface + implementation together outside `container.ts`). `IdParams` usage on the PUT route and the Zod body shape validation are both correctly placed.

Once the create/count logic moves into `service.ts` and `repository.ts` stops being reachable from `routes.ts`, this is in good shape to register in `modules/index.ts`.
