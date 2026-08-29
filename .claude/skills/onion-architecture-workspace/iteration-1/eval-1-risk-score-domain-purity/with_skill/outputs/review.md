Thanks for getting this in front of me before wiring it into `run.ts` — good call, because as it stands this can't drop into `reviewer-core` without some rework. A few things, roughly in order of how much they'd cost you later:

**1. `PullRow` import breaks reviewer-core's dependency direction (CRITICAL)**

```ts
import type { PullRow } from '../../../server/src/db/rows.js';
```

`reviewer-core` is the domain ring — it's never allowed to import from `server/src/db` (or `server/src/adapters`, `server/src/modules`, or any Fastify/Drizzle type). That's called out explicitly in the onion-architecture skill as an existing invariant, not a soft guideline, and this file crosses it directly by pulling in a Drizzle-inferred row type. Even though it's a type-only import, it still couples the domain package to `server`'s DB schema — if that schema shifts, reviewer-core breaks, and reviewer-core becomes unusable/untestable outside a server context.

Fix: don't pass a `PullRow` in. Define a small local input type in `risk-score.ts` (e.g. `{ owner: string; repo: string }` or whatever subset you actually use) and have the `server` caller map its `PullRow` down to that shape before calling `scoreRisk`. That mapping is exactly application-layer work and belongs in `modules/reviews/service.ts` (or wherever `run.ts` is invoked from), not here.

**2. `FastifyRequest` import (CRITICAL, same rule)**

```ts
import type { FastifyRequest } from 'fastify';
...
export async function scoreRisk(input: RiskScoreInput, req?: FastifyRequest): Promise<number> {
```

Same invariant, and this one's easier to fix because `req` is dead — it's never read anywhere in the function body. Just drop the parameter. A domain function in reviewer-core should never know Fastify exists, even as an unused optional.

**3. The live GitHub fetch is the real architectural problem (CRITICAL — domain purity)**

```ts
async function fetchFanInFromGitHub(owner: string, repo: string, paths: string[]): Promise<number> {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents`, ...);
```

Per the skill, reviewer-core's domain logic is allowed exactly one side effect: an *injected* `LLMProvider` (see `reviewer-core/src/index.ts` and how `review/run.ts` takes `llm: LLMProvider` rather than constructing a client itself). This function does a raw, un-injected `fetch` to the GitHub API from inside the domain layer. That's a second side effect, and it's not even behind an interface — it's a hardcoded network call, so `scoreRisk` can't be unit-tested without hitting real GitHub (or monkey-patching global `fetch`), and it can't be swapped for a mock in tests the way the rest of reviewer-core is designed to be.

The skill spells this out almost exactly for this situation: "If new domain logic needs something from outside (a DB read, a GitHub call), that's a signal it belongs in a `service.ts` (application ring) that calls the domain function, not in the domain function itself." So: the GitHub call needs to move out of `reviewer-core` entirely. Have the `server`-side service fetch whatever "fan-in"/centrality data it needs (ideally via the existing `server/src/adapters/github` adapter — there's already one wired through `container.ts`, see point 4) and pass the *result* into `scoreRisk` as plain data. `scoreRisk` itself should become a pure function: `(findings, diff, fanInData) => number`.

**4. Even server-side, this shouldn't be a raw `fetch` (composition-root / MEDIUM, once you move it)**

Once you relocate the GitHub call to the application/service layer, don't hand-roll a second `fetch(...)` to the GitHub API — `server/src/adapters/github` already exists and is wired through `platform/container.ts` as the one sanctioned GitHub client (with whatever auth/rate-limit handling it has). A second ad-hoc client is exactly the "second wiring mechanism" the Composition Root rule warns against. Add a method there (or to `repo-intel`'s existing graph/index data, which sounds like a much better source for "fan-in" than an unauthenticated root-directory listing — see next point) instead of introducing a bare `fetch`.

**5. Not an architecture issue, but worth fixing before this ships: the fan-in calculation doesn't compute fan-in**

`fetchFanInFromGitHub` hits `GET /repos/{owner}/{repo}/contents` — that's a listing of the repo's *root directory* — and then just checks whether each touched path string-matches an entry in that root listing. That's basically "does this top-level path exist," not "how many other files depend on/import this file," which is what "centrality" implies in the docstring. It's also unauthenticated, so it'll rate-limit fast under any real load. Given `repo-intel` already builds a dependency graph (per `LAYER_MAP.md`, it "coordinates graph, embeddings, ast-grep"), that's almost certainly the right source for a real fan-in/centrality number — worth routing through that instead of a GitHub contents call.

**Net**: before this wires into `run.ts`, I'd restructure `scoreRisk` to be a pure function over `(findings, diff, fanIn: number)` with no imports outside `@devdigest/shared` and reviewer-core's own types, and push the "go get fan-in data" step (ideally from `repo-intel`'s graph, not a raw GitHub contents call) into the calling service. Happy to look again once that split's done.
