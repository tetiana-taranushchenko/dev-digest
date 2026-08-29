Took a pass through routes.ts / service.ts / repository.ts. Overall the CRUD shape is fine, but there's one bug I'd block on before it goes into `modules/index.ts`, plus a handful of things worth tightening.

**Blocker: `markRead` isn't scoped to workspace/user — an IDOR.**

In `service.ts`, `markRead(id)` just forwards to `repository.ts`'s `markRead`, which does:

```ts
.where(eq(t.notifications.id, id))
```

Nothing checks that the notification belongs to the caller's workspace or user. Compare that to `routes.ts`'s `PUT /notifications/:id/read` handler — it doesn't even call `getContext(...)` to get a `workspaceId`/`userId` in the first place, unlike `GET /notifications` and the unread-count handler right above it. So today, any authenticated caller who can guess or enumerate a notification id can flip another workspace's notification to `read`. That's the one I'd actually fix before merging — needs a `where(and(eq(id, ...), eq(workspaceId, ...), eq(userId, ...)))` (or at least workspace-scoped), and the route needs to fetch context and pass it down.

**Same shape of problem on create: `userId` isn't checked against the caller's workspace.**

The Zod schema's `.refine` in `routes.ts` (lines 18–26) checks `repo.userExists(b.userId)`, but `userExists` in `repository.ts` is a bare `SELECT id FROM users WHERE id = ?` — it doesn't take `workspaceId` at all. So the check only proves the user exists *somewhere*, not that they're in the caller's workspace. As written, a caller in workspace A can create a notification targeted at a user in workspace B. Worth scoping that query too, same as `list`.

**Layering is inconsistent across the four operations — and one of them skips the repository entirely.**

Look at how each handler in `routes.ts` gets its data:
- `list` → goes through `service.list` → `repo.list` (proper)
- `markRead` → goes through `service.markRead` → `repo.markRead` (proper, modulo the scoping bug above)
- `create` (POST) → calls `repo.insert(...)` directly, bypassing `service` entirely
- `unread-count` → doesn't even use the repository — it does a raw `app.container.db.select().from(t.notifications).where(eq(workspaceId, ...))` inline in the route, importing `eq` and the schema directly (lines 5, 6, 37–41)

That's three different access patterns in one 60-line file. Practically, it means: (a) `routes.ts` now imports `drizzle-orm` and the raw schema, which the service/repository split was presumably meant to keep out of the route layer; (b) any future cross-cutting logic added to `service` (audit logging, event emission, whatever) silently won't apply to create or the count, because they don't go through it; (c) two separate `NotificationsRepository` instances get constructed (`routes.ts` line 16, and again inside `service.ts`'s constructor) that both just wrap the same `db` handle — harmless today, but a sign the wiring isn't settled. I'd pick one shape — either the service is the only thing routes talk to (and gets a `create`/`unreadCount` method), or, if this module is intentionally kept thin (routes → repo, no service), drop `service.ts` and make that consistent. Right now it's neither.

**Unread-count query is doing it the hard way.**

Related to the above: it pulls every notification row for the whole workspace (`.select()` with no column list, no user filter) and then filters down to the caller's unread ones in JS (line 41). For a badge count that's a lot of wasted I/O and serialization — full row bodies for every user in the workspace, every time the topbar polls. This should be a `count()` aggregate scoped by `workspaceId + userId + status = 'unread'` in the repository, both for the perf and so the "what counts as unread" logic lives in one place instead of being reimplemented ad hoc in the route.

**Async `.refine` calling the DB during body validation — double-check this actually runs.**

`CreateNotificationBody`'s `.refine(async (b) => repo.userExists(b.userId), ...)` in `routes.ts` does a DB round-trip as part of schema validation. A couple of things worth confirming rather than assuming: whether `fastify-type-provider-zod`'s validation path actually awaits async refinements (some setups call `.parse()` rather than `.parseAsync()`, in which case an async refine either throws or silently doesn't get awaited — worth a quick test hitting POST with a bad `userId` to confirm you get the 400 you expect, not a 500 or a false pass). Separately, since `notifications.userId` presumably has (or should have) an FK constraint against `users`, you may not need the app-level existence check at all — letting the DB reject the insert with a constraint error avoids the extra query and the TOCTOU gap between the check and the insert.

**Smaller things:**
- `list` has no pagination/limit. Fine for a first cut, but a long-lived user is going to accumulate rows indefinitely and this will return all of them.
- None of the routes declare a `schema.response`, only `body`/`params`. Worth adding if the rest of the codebase does — otherwise whatever columns `select()` happens to return (internal/future columns included) go straight to the client.
- `PUT /notifications/:id/read` — minor, but this reads more like a partial update (`PATCH`) than a full resource replace. Not a blocker, just a nit.

Net: I'd fix the `markRead` workspace scoping before this goes live — that's a real cross-tenant write. The `create`-time user/workspace check and the layering inconsistency I'd want addressed too, but they're not as sharp. The unread-count query and the async-refine question are worth a look but wouldn't hold up registration on their own.
