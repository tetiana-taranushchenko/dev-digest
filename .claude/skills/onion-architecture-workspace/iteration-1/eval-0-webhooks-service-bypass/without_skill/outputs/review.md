Read through all four files. Here's my review.

**The big one: `routes.ts` bypasses the service layer.**

In `routes.ts` you do:

```ts
const service = new WebhooksService(app.container, process.env.WEBHOOK_SECRET ?? '');
const repo = new WebhooksRepository(app.container.db);
...
const existing = await repo.findByDeliveryId(deliveryId);
if (existing) { ... }
```

You're instantiating `WebhooksRepository` directly in the route and using it for the dedup check, then separately calling into `service.handleDelivery`, which *also* builds its own `WebhooksRepository` internally and does its own `findByDeliveryId` check. That's two repository instances doing the same lookup, and it means the route handler contains real business logic (dedup) instead of just delegating to the service. Routes should only ever talk to the service — the service is what should own "is this a duplicate delivery," not the route. Pull the dedup check out of `routes.ts` entirely and let `service.handleDelivery` be the single source of truth for it (which it already is, so just delete the routes.ts copy).

That duplication also creates a real ordering bug: the routes.ts dedup check runs **before** signature verification. So an unauthenticated caller can POST with a guessed/observed `x-github-delivery` value and get a `200 { ok: true, deduped: true }` back without ever passing HMAC verification — you're doing a DB lookup keyed on attacker-controlled input ahead of any auth. Low severity given delivery IDs are opaque GUIDs, but it's the kind of thing that shouldn't be possible given the shape of the code.

**Signature verification is being computed over the wrong bytes.**

In `routes.ts`:

```ts
const raw = JSON.stringify(req.body);
```

`req.body` here is the *already-parsed* object from Fastify's JSON parser. Re-serializing it with `JSON.stringify` does not reliably reproduce the exact byte sequence GitHub signed — key order, whitespace, unicode escaping, number formatting can all differ. That means `HmacWebhookVerifier.verify` in `hmac-verifier.ts` will be checking a signature against payload bytes that may not match what GitHub actually sent, so legitimate webhooks can fail verification (or worse, edge cases where re-serialization happens to normalize things in a way that masks tampering). You need the raw request body — typically via a Fastify content-type parser that captures the raw buffer/string before JSON parsing (e.g. `addContentTypeParser('application/json', { parseAs: 'string' }, ...)` and stash it on the request), and sign/verify against that, not against `req.body`.

**Errors thrown from `service.ts` will surface as 500s.**

```ts
if (!this.verifier.verify(rawPayload, signature)) {
  throw new Error('invalid signature');
}
...
if (workspace.length === 0) throw new Error('unknown workspace');
```

These are plain `Error`s with no status code attached. Unless there's a global error handler mapping error messages to status codes (I don't see one here), an invalid signature will come back as a generic 500 instead of 401, and an unknown workspace will also 500 instead of 400/404. GitHub's webhook redelivery/backoff behavior treats 5xx very differently from 4xx, so this matters functionally, not just cosmetically. Worth introducing typed errors (or your existing app-error convention, if there is one) that the route/error handler can map to proper statuses.

**`service.ts` mixes an injected `container.db` with a directly-imported `db` singleton.**

The constructor takes `container: Container` and uses `container.db` to build the repository, but then `handleDelivery` does:

```ts
import { db } from '../../db/client.js';
...
const workspace = await db.select().from(t.workspaces).where(eq(t.workspaces.id, payload.workspace_id));
```

— querying the global `db` import directly instead of `this.container.db`. That's inconsistent dependency injection: the service is only partially testable/mockable, since this one query reaches around the injected dependency straight to the module-level singleton. Also, this is a raw Drizzle query sitting in the service rather than behind a repository method — if `WebhooksRepository` (or a small `WorkspacesRepository`) grew a `findById`, the service would stay free of table/schema knowledge and could be tested with a fake repo instead of a real `db`.

**Secret falls back to an empty string.**

```ts
new WebhooksService(app.container, process.env.WEBHOOK_SECRET ?? '')
```

If `WEBHOOK_SECRET` isn't set, you silently proceed with an HMAC key of `''` rather than failing at startup. That's a foot-gun — a misconfigured deploy would "work" (accepting/rejecting signatures against an empty-key HMAC) instead of loudly refusing to boot. I'd fail fast here (throw if the env var is missing) rather than defaulting.

**Dedup is check-then-insert, not atomic.**

Both `routes.ts` and `service.ts` do `findByDeliveryId` then later `insert`. Two concurrent redeliveries of the same `x-github-delivery` (GitHub does retry) can both pass the "not found" check before either insert lands. `repository.ts`'s `insert` doesn't guard against this — worth adding a unique constraint on `deliveryId` in the schema (if not already there — I can't see `db/schema.ts` from here, so worth double-checking) and using `.onConflictDoNothing()` (or catching the conflict) in `repository.insert`, returning the existing row on conflict instead of assuming `insert(...).returning()` always yields a row. Note the `row!` non-null assertion in `repository.ts` would silently lie about the return type the moment you add conflict handling, so update it alongside.

**No validation on the parsed payload shape.**

`service.ts` does `JSON.parse(rawPayload)` and immediately trusts `payload.workspace_id` with no shape check. A malformed or unexpected event body would throw an unhandled/unclear error rather than a clean 400. Worth a small zod schema for at least the fields you actually read.

**Minor nit in `hmac-verifier.ts`.**

This one's mostly solid — length check before `timingSafeEqual` (avoids the throw-on-mismatched-length footgun) and a proper constant-time comparison. One small robustness gap: `signatureHeader.replace('sha256=', '')` doesn't verify the header actually starts with `sha256=` — a header without that prefix just passes through unchanged and gets compared as-is. It'll still correctly fail verification in practice, but I'd add an explicit `startsWith('sha256=')` check and bail early for clarity/defense-in-depth, since right now it's relying on comparison-failure rather than an explicit rejection.

**Summary of what I'd fix before wiring this in:** get rid of the direct repository access in `routes.ts` (route → service only), fix the raw-body capture for signature verification, turn the service's thrown `Error`s into something status-code-aware, make `service.ts` consistently use the injected `container.db` (and move the workspace lookup behind a repository method), fail startup if `WEBHOOK_SECRET` is missing, and add conflict-safe dedup at the DB layer. The HMAC adapter itself is close to right and just needs the raw-body fix upstream to actually verify anything correctly.
