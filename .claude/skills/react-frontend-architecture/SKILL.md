---
name: react-frontend-architecture
description: React/Next.js frontend architecture and code organization guide. Use when deciding where a component, hook, constant, util, or business-logic file should live, splitting an oversized component, structuring a new feature or route folder, or organizing Server Components/Actions/Route Handlers in a Next.js App Router app. Covers folder structure and colocation, component splitting boundaries, constants/utils placement, business-logic placement, and Next.js App Router architecture. Does not cover component purity/hooks/memoization (see react-best-practices) or RSC syntax/performance (see next-best-practices).
version: 0.2.0
---

# React / Frontend Architecture

Apply these rules when deciding where React/Next.js frontend code should live.

**Scope boundary** — this skill does not duplicate:
- `react-best-practices` — component purity, hooks correctness, memoization, a11y, render factories
- `next-best-practices` — RSC directive syntax, async APIs, metadata, image/font optimization, bundling

## Severity Levels

- **CRITICAL** — Will cause bugs, broken boundaries, or maintenance nightmares
- **HIGH** — Will cause scaling problems as the codebase grows
- **MEDIUM** — Will hurt maintainability or developer experience

## Folder Structure & Colocation (CRITICAL)

See [folder-structure.md](folder-structure.md) for:
- Feature/route-based grouping vs grouping by file type
- The colocation test and when to promote a file from local to shared
- One-directional dependency flow (`shared → feature → app`)
- Constants & utils/helpers placement (same colocation rule, file-level)

## Component Splitting (HIGH)

See [component-organization.md](component-organization.md) for:
- When to split a component (size, prop count, responsibility)
- "Thin component + custom hook" over container/presentational
- One component per file

## Business Logic Placement (CRITICAL)

See [business-logic.md](business-logic.md) for:
- Pure functions vs custom hooks — the extraction test
- What a component body should and should not contain

## Next.js App Router Architecture (HIGH)

See [nextjs-app-router.md](nextjs-app-router.md) for:
- `app/` scope vs shared code kept outside `app/`
- Server/Client boundary depth and Server+Client composition
- The loader/actions/service/schema pattern for route-level business logic
- Server Action vs Route Handler; route groups as an architecture tool

## Additional Resources

### Reference Files

- **[folder-structure.md](folder-structure.md)** — folder structure, colocation, constants/utils placement
- **[component-organization.md](component-organization.md)** — component splitting
- **[business-logic.md](business-logic.md)** — business logic placement
- **[nextjs-app-router.md](nextjs-app-router.md)** — Next.js App Router architecture
- **[examples.md](examples.md)** — good/bad folder trees, the loader/actions/service/schema pattern, component-splitting before/after
- **[README.md](README.md)** — full source list with quotes and per-topic consensus this skill was built from
