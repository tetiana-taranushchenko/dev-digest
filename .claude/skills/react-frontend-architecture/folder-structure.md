# Folder Structure & Colocation

Where files and folders live: feature-based grouping, colocation, and when to promote
something from local to shared.

## Folder Structure & Colocation (CRITICAL)

- Group by feature/route, not by file type — a top-level `components/`, `hooks/`, or `utils/` folder holds ONLY code shared across ≥2 features
- Colocate: a component, its hooks, its helpers, and its types live inside the feature/route directory that owns them, not scattered across parallel `components/`, `hooks/`, `utils/` trees
- "Things that change together belong together" — this is the single test for where a file goes
- Features/routes must NOT import from each other directly — compose them at the app/route level instead
- Dependency flow is one-directional: `shared → feature → app`; never the reverse, never feature-to-feature
- Promote a file from local to shared only when a second real, independent consumer appears — never preemptively "just in case"
- In this repo: `client/src/app/**/_components/` is the colocation mechanism (Next.js private folder); `client/src/components/` and `client/src/lib/` are the shared tier — see [`client/INSIGHTS.md`](../../../client/INSIGHTS.md) 2026-08-04 entry for the promotion rule in practice

## Constants & Utils/Helpers Placement (HIGH)

- Default to colocation: a constant or helper used by exactly one component/feature stays a module-level `const`/function in that same file
- Promote to a shared `lib/`, `utils/`, or `constants` file only once a second independent consumer (a different component tree/feature) needs the same thing — not before
- This is the same colocation rule as folder structure, applied at file granularity — there is no separate "put all constants in one global file" rule
- Before creating a new shared util/constants file, grep for an existing one that already covers the need — reuse over duplication
