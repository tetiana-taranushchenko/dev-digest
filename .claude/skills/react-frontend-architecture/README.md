# React / Frontend Architecture — Sources

Research base behind [`SKILL.md`](SKILL.md) — where components should live, how to split
them, where constants belong, what to extract into utils/helpers, where business logic
belongs. This file holds all sources with quotes and rationale; the skill itself (short
rules with severity levels) lives in SKILL.md, code examples in [examples.md](examples.md).

Existing skills this one does NOT duplicate:
- `.claude/skills/react-best-practices/SKILL.md` — covers component purity, hooks,
  memoization, a11y, etc.; its "Code Organization" section is only 4 bullets (lines
  167-176) — that gap is what this new skill closes.
- `.claude/skills/next-best-practices/SKILL.md` — Next.js file conventions (routes,
  layout/page/error), not general component architecture.

---

## 1. Folder Structure & Colocation (where components live)

| Source | What it covers | Key takeaway |
|---|---|---|
| [Kent C. Dodds — Colocation](https://kentcdodds.com/blog/colocation) | The base colocation principle, from a well-known React educator | "Place code as close to where it's relevant as possible"; the sharper version, credited to Dan Abramov: "Things that change together should be located as close as reasonable" |
| [Kent C. Dodds — State Colocation will make your React app faster](https://kentcdodds.com/blog/state-colocation-will-make-your-react-app-faster) | Colocation applied specifically to state | Only lift state up when actually needed — otherwise it causes unnecessary re-renders |
| [bulletproof-react — project-structure.md](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md) | The most-cited production-ready React style guide on GitHub (alan2207, 30k+ stars) | Clean split: `src/{components,hooks,lib,types,utils,config,stores}` — shared across the whole app; `features/<name>/{api,components,hooks,stores,types,utils}` — everything for one feature. **Rule**: features must NOT import from each other directly (`import/no-restricted-paths` ESLint rule); dependency flow is `shared → features → app` only |
| [Josh W. Comeau — Delightful React File/Directory Structure](https://www.joshwcomeau.com/react/file-structure/) | Very practical, real examples, popular among React developers | Every component gets its own folder (`FileViewer/FileViewer.tsx`, `.helpers.ts`, `.types.ts`, `index.ts`); genuinely reusable things move to `src/hooks` or `src/utils`, not kept globally "just in case" |
| [Robin Wieruch — React Folder Structure Best Practices (2026)](https://www.robinwieruch.de/react-folder-structure/) | Regularly updated guide, explains the evolution well: file-type → feature-based → domain-driven | For small projects — group by type; for real production apps — group by feature/domain |
| [Feature-Sliced Design — official documentation](https://feature-sliced.design/docs/get-started/overview) | A formal methodology with explicit layer rules | 7 layers (`app, processes, pages, widgets, features, entities, shared`); a module on one layer can only import from layers **strictly below it** — this settles the "where's the boundary" question |
| [Next.js official documentation — Project Structure](https://nextjs.org/docs/app/getting-started/project-structure) | Primary source, current as of Next.js 16 | Files inside `app/` can be safely colocated — only what a `page.js`/`route.js` exports becomes a route. Private folders `_folder` (like our `_components`) are the officially recommended way to hold non-route UI |

**Consensus:** for a production project — group by feature/route, not by file-type
(`components/`, `hooks/`, `utils/` at the top level only for genuinely shared code). This
is already how `client/src/app/**/_components` is set up in this project.

---

## 2. Component Splitting

| Source | What it covers | Key takeaway |
|---|---|---|
| [freeCodeCamp — Separation of Concerns in React: Container/Presentational](https://www.freecodecamp.org/news/separation-of-concerns-react-container-and-presentational-components/) | The classic pattern, explained with examples | Container — state/data/business logic; Presentational — props → UI only. In modern React, a custom hook + a "dumb" component usually plays this role |
| [cekrem.github.io — Single Responsibility Principle in React](https://cekrem.github.io/posts/single-responsibility-principle-in-react/) | SRP applied specifically to React components | A component should have one reason to change; if it has several, split it |
| [Airbnb React/JSX Style Guide](https://github.com/airbnb/javascript/blob/master/react/README.md) | The best-known JS/React style guide in the industry | One React component per file (small stateless helper components in the same file are fine); PascalCase for component filenames |
| `.claude/skills/react-best-practices/SKILL.md` (already in repo) | Our own existing skill | ~200-line cap per component, max 5-7 props, helper functions extracted OUTSIDE the component body |

**Consensus:** one component = one responsibility; when a file grows (>200 lines, >5-7
props, nested ternaries), split into container (data/logic) + presentational (UI), or
into composition of smaller components.

---

## 3. Where Business Logic Belongs

| Source | What it covers | Key takeaway |
|---|---|---|
| [profy.dev — Path To A Clean(er) React Architecture: Business Logic Separation](https://profy.dev/article/react-architecture-business-logic-and-dependency-injection) | An in-depth article specifically on the business vs application logic boundary | Business logic (calculations, validation, data transforms) — pure functions with a clear input/output; application logic (tied to state/lifecycle) — custom hooks |
| [Anton Yeghiazaryan (antonyleme) — Business vs Application Logic in ReactJS](https://antonyleme.medium.com/business-vs-application-logic-how-to-separate-and-test-your-reactjs-code-4291d0c983b1) | A practical split with testing examples | Business logic (pure functions) is testable with zero component rendering — that's the actual criterion for "should this be extracted" |
| [eMoosavi — Decoupling Business Logic from UI with Custom React Hooks](https://www.emoosavi.com/blog/decoupling-business-logic-from-ui-with-custom-react-hooks) | Focused specifically on custom hooks as the business-logic layer | `components/` — UI only, `hooks/` — all stateful business logic (fetching, side effects), `services/` — API calls with no React dependency |
| `.claude/skills/react-best-practices/SKILL.md` (already in repo) | Our own skill, "Data Fetching" section | ALL data fetching lives in custom hooks, never in the component body; project's `useApiQuery`/`useApiMutation` |

**Consensus:** a UI component should be "dumb" — all state, side effects, and API calls
go into custom hooks; pure computation (no state/lifecycle) becomes standalone functions
(helpers/services) that are testable without React at all.

---

## 4. Utils/Helpers vs Hooks vs Services — the decision criterion

| Source | What it covers | Key takeaway |
|---|---|---|
| [Priyanka Daida — React Custom Hooks vs. Helper Functions](https://medium.com/@priyankadaida/react-custom-hooks-vs-helper-functions-when-to-use-both-e40167325479) | A comparison article with clear criteria | Helper function: doesn't depend on React lifecycle/state, pure, takes input → returns output (formatting, sorting, calculations). Custom hook: uses `useState`/`useEffect`/another hook internally — which is what makes it a hook |
| [thoughtbot — Custom React Hooks and When to Use Them](https://thoughtbot.com/blog/custom-react-hooks) | A respected consultancy's practical guide | Worth extracting into a hook when: (1) the parent code is more understandable with the abstraction, and (2) the abstraction is isolated enough to make sense on its own — if either condition fails, skip the hook |
| Internal project precedent — [`client/INSIGHTS.md`](../../../client/INSIGHTS.md), 2026-08-04 entry | A real precedent from dev-digest | `formatTokens`/`formatSeconds` stayed local in `RunTraceDrawer/helpers.ts` while used in one tree only; when the same formatter was needed by 3 separate trees (`PRRow`, `RunHistory`, `TraceBody`), a shared `client/src/lib/format.ts` was created instead. Rule: **extract to a shared location only once a 2nd/3rd real consumer exists**, not preemptively |

**Consensus:** the criterion isn't "where does this logically belong in theory" but (1)
is the function pure (no React state/lifecycle) → helper/util; (2) does it use
`useState`/`useEffect`/another hook internally → custom hook; (3) are there already ≥2
real consumers outside a single component tree → only then extract to shared
`lib`/`utils`, never ahead of time.

---

## 5. Where Constants Belong

| Source | What it covers | Key takeaway |
|---|---|---|
| [Robin Wieruch — React Folder Structure Best Practices (2026)](https://www.robinwieruch.de/react-folder-structure/) | Same guide, separately addresses constants | App-wide constants (routes, API endpoints, themes) — centralized `constants/`; feature-specific constants — colocate with the feature |
| [bulletproof-react — project-structure.md](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md) | Same style guide | `config/` at the top level is only for global config/env; everything else follows the same shared-vs-feature rule as code |
| Muhammed Cuma — [Organizing Your React Project: Folder and File Structure](https://muhammedcuma.medium.com/organizing-your-react-project-best-practices-for-folder-and-file-structure-a18fc664d34c) | A general overview, confirms the pattern | `constants.ts` for app-wide values; for local ones, a plain module-level `const` at the top of the component file |

**Consensus:** the same colocation rule as utils — a constant used by only one
component/feature stays a module-level `const` in that same file; a constant needed by
≥2 independent trees moves to a shared file (same precedent as `client/src/lib/format.ts`
above). A blanket "all constants in one global folder" rule doesn't hold up — it's just a
special case of the colocation rule.

---

## 6. Next.js App Router — Specifics (since this project runs on it)

This section deliberately covers **architecture only** (what lives where and why), not
performance — optimizations (images, fonts, bundling, runtime) are already covered by the
`next-best-practices` skill. Likewise, RSC directive syntax (`'use client'`, async client
component being invalid) is already in `next-best-practices/rsc-boundaries.md`; this
section is about "where code architecturally belongs," not "how to write it."

### 6.1 Folder Structure & Colocation

| Source | What it covers | Key takeaway |
|---|---|---|
| [Next.js official documentation — Project Structure](https://nextjs.org/docs/app/getting-started/project-structure) | Primary source | Private folders `_folder` (e.g. our `pulls/[number]/_components/`) are the official way to colocate UI outside the routing system; Next.js deliberately **does not enforce** structure beyond the routing files |
| [Feature-Sliced Design — Next.js App Router Guide](https://feature-sliced.design/blog/nextjs-app-router-guide) | How to combine FSD layers with the App Router | Shows how to layer feature-sliced layers (`entities`, `features`, `widgets`) on top of Next.js `app/` without conflicting with routing |
| [makerkit.dev — Next.js 16 App Router Project Structure: The Definitive Guide](https://makerkit.dev/blog/tutorials/nextjs-app-router-project-structure) | A production structure built on experience from multiple SaaS starters and "thousands of developers" (not theory — what survived production) | Route groups by purpose: `(public)` — marketing, `(internal)` — protected dashboard, `auth/` — separate with an explicit URL prefix. Inside `app/` — only routes + `_components/` + `_lib/` for that route; anything genuinely shared (components, utils, config) lives **outside** `app/`, at the project root |

### 6.2 Where Business Logic Lives in the App Router (Server Components / Actions / Route Handlers)

| Source | What it covers | Key takeaway |
|---|---|---|
| [Next.js official documentation — Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components) | Primary source, Next.js 16 | Components are server by default; `'use client'` marks a **module-graph** boundary — everything a client file imports or renders directly also becomes client. So push the boundary as low/deep as possible (e.g. `<Search />` is client, the rest of `<Layout>` stays server) instead of marking a whole subtree client for one button |
| Same document — "Interleaving Server and Client Components" | The composition pattern | A Server Component can be passed as `children`/a prop into a Client Component (e.g. `<Modal><Cart /></Modal>`) — this keeps data fetching on the server even when the interactive wrapper (a modal, tabs) is client |
| [makerkit.dev — same guide](https://makerkit.dev/blog/tutorials/nextjs-app-router-project-structure) | A concrete file pattern for business logic within a route | In a route's `_lib/`: `*.loader.ts` (server-side data fetch, React `cache()`), `*.actions.ts` (Server Actions — **thin**: validate input, call the service, `revalidatePath`), `*.service.ts` (pure, testable business logic — no Next.js specifics), `*.schema.ts` (Zod validation). Rule of thumb from the guide: "if your Server Action is longer than ~20 lines, it's probably doing too much" |
| [makerkit.dev — Server Actions vs Route Handlers: When to Use Each](https://makerkit.dev/blog/tutorials/server-actions-vs-route-handlers) | The architectural rule for choosing between them | Server Action — when **a human triggers it from this app's own UI** (a form, a click); Route Handler (`route.ts`) — when the caller **isn't this app's React code**: webhooks, mobile apps, third-party integrations, a public API |

### 6.3 Route Groups as an Architectural Tool, Not Just a URL Trick

| Source | What it covers | Key takeaway |
|---|---|---|
| [Next.js official documentation — Route Groups](https://nextjs.org/docs/app/api-reference/file-conventions/route-groups) | Primary source for the `(group)` mechanic | Groups don't affect the URL — used to organize by domain/team and to enable multiple distinct root layouts in one app |
| Search survey (Medium/dev.to, several independent authors agree) | Practical application | `(auth)`, `(admin)`, `(marketing)` as boundaries teams can work within in isolation without routing conflicts — an organizational decision, not just "how to arrange files" |

**Section 6 consensus:** this project already follows the official recommendation
(`_components` at the route level + `client/src/components/` for genuinely shared code).
What isn't explicitly formalized yet — the Server Action / Route Handler boundary ("who
calls it?") and the `*.loader/*.actions/*.service/*.schema` file pattern for business
logic within a route — is exactly what got added to SKILL.md as the Next.js-specific
extension of section 3 ("business logic").

---

## All Sources (flat list)

1. [Kent C. Dodds — Colocation](https://kentcdodds.com/blog/colocation)
2. [Kent C. Dodds — State Colocation will make your React app faster](https://kentcdodds.com/blog/state-colocation-will-make-your-react-app-faster)
3. [bulletproof-react — project-structure.md](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md)
4. [Josh W. Comeau — Delightful React File/Directory Structure](https://www.joshwcomeau.com/react/file-structure/)
5. [Robin Wieruch — React Folder Structure Best Practices (2026)](https://www.robinwieruch.de/react-folder-structure/)
6. [Feature-Sliced Design — official documentation, Overview](https://feature-sliced.design/docs/get-started/overview)
7. [Feature-Sliced Design — Layers](https://feature-sliced.design/docs/reference/layers)
8. [Feature-Sliced Design — Slices and segments](https://feature-sliced.design/docs/reference/slices-segments)
9. [Feature-Sliced Design — Next.js App Router Guide](https://feature-sliced.design/blog/nextjs-app-router-guide)
10. [freeCodeCamp — Separation of Concerns in React: Container/Presentational](https://www.freecodecamp.org/news/separation-of-concerns-react-container-and-presentational-components/)
11. [cekrem.github.io — Single Responsibility Principle in React](https://cekrem.github.io/posts/single-responsibility-principle-in-react/)
12. [Airbnb React/JSX Style Guide](https://github.com/airbnb/javascript/blob/master/react/README.md)
13. [profy.dev — Path To A Clean(er) React Architecture: Business Logic Separation](https://profy.dev/article/react-architecture-business-logic-and-dependency-injection)
14. [Anton Yeghiazaryan (antonyleme) — Business vs Application Logic in ReactJS](https://antonyleme.medium.com/business-vs-application-logic-how-to-separate-and-test-your-reactjs-code-4291d0c983b1)
15. [eMoosavi — Decoupling Business Logic from UI with Custom React Hooks](https://www.emoosavi.com/blog/decoupling-business-logic-from-ui-with-custom-react-hooks)
16. [Priyanka Daida — React Custom Hooks vs. Helper Functions](https://medium.com/@priyankadaida/react-custom-hooks-vs-helper-functions-when-to-use-both-e40167325479)
17. [thoughtbot — Custom React Hooks and When to Use Them](https://thoughtbot.com/blog/custom-react-hooks)
18. [Muhammed Cuma — Organizing Your React Project: Folder and File Structure](https://muhammedcuma.medium.com/organizing-your-react-project-best-practices-for-folder-and-file-structure-a18fc664d34c)
19. [Next.js official documentation — Project Structure](https://nextjs.org/docs/app/getting-started/project-structure)
20. [Next.js official documentation — Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components)
21. [Next.js official documentation — Route Groups](https://nextjs.org/docs/app/api-reference/file-conventions/route-groups)
22. [makerkit.dev — Next.js 16 App Router Project Structure: The Definitive Guide](https://makerkit.dev/blog/tutorials/nextjs-app-router-project-structure)
23. [makerkit.dev — Server Actions vs Route Handlers: When to Use Each](https://makerkit.dev/blog/tutorials/server-actions-vs-route-handlers)

Internal (non-web) sources checked during research:
- `.claude/skills/react-best-practices/SKILL.md` — to avoid duplicating it
- `.claude/skills/next-best-practices/SKILL.md` — to avoid duplicating it
- [`client/INSIGHTS.md`](../../../client/INSIGHTS.md), 2026-08-04 entry — a real precedent
  for the colocation-promotion rule in this project

---

## Status

Skill shipped: [`SKILL.md`](SKILL.md) (v0.1.0) + [`examples.md`](examples.md). This
README stays as the reference base — the sources and rationale behind each rule.
