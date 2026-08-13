# Next.js App Router Architecture

Where code lives in the App Router. Architecture only — not performance
(`next-best-practices` covers images/fonts/bundling/runtime) and not RSC directive
syntax (`next-best-practices/rsc-boundaries.md`).

## Next.js App Router Architecture (HIGH)

- Keep `app/` for routing + colocated route-scoped code (`_components/`, `_lib/`) only; put anything shared across routes outside `app/` (`client/src/components/`, `client/src/lib/`)
- Push the `'use client'` boundary as deep as possible — it marks a module-graph boundary, so everything a client file imports or renders directly also ships to the client. Mark the smallest interactive leaf (e.g. a search box), not the layout that contains it
- Compose Server and Client Components by passing a Server Component as `children`/props into a Client Component (e.g. an interactive `<Modal>` wrapping a server-fetched `<Cart>`), instead of promoting the whole subtree to client just for one interactive wrapper
- Inside a route's `_lib/`, split business logic by responsibility, not by dumping it in one file: a loader (server-side data fetch), actions (Server Actions — thin: validate input, call the pure logic, revalidate), the pure business logic itself (framework-agnostic, unit-testable), and a schema (input validation). If a Server Action's body is doing more than validate-call-revalidate, extract the logic out of it
- Choose Server Action vs Route Handler by "who calls it": a human through this app's own UI (a form, a click) → Server Action; anything that isn't this app's React code (webhook, external client, third-party integration, public API consumer) → Route Handler (`route.ts`)
- Route groups (`(name)`) are an organizational/architectural tool, not just a URL trick — use them to give a domain or team an isolated subtree (e.g. `(admin)`, `(marketing)`) without affecting URLs, not only to share a layout
