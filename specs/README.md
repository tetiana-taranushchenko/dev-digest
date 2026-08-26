# Specs — cross-module specifications

This top-level `specs/` directory holds Spec-Driven Development (SDD)
specifications that span **two or more** modules. Single-module specs live
next to their module instead — keep a spec as close to the code it governs
as its scope allows.

| Spec scope | Location |
|---|---|
| `server` only | `server/specs/` |
| `client` only | `client/specs/` |
| `reviewer-core` only | `reviewer-core/specs/` |
| `mcp-server` only | `mcp-server/specs/` |
| `e2e` only | `e2e/specs/` — not feature specs, `agent-browser` flow JSON instead |
| **cross-module (≥ 2 modules)** | `specs/` (here) |

## What a spec is

Specs are authored by the **`spec-creator`** agent
(`.claude/agents/spec-creator.md`).

A spec describes **what** a feature must do and **why** — the problem, goals
/ non-goals, user stories, EARS acceptance criteria, edge cases, cross-module
interactions, and contracts. It deliberately stops short of **how** to
implement it (file-by-file tasks, layers, code) — that is the
`implementation-planner` agent's Development Plan (`docs/plans/`). The
intended chain is:

```
spec-creator → spec (WHAT/WHY) → implementation-planner → plan (HOW) → implementer → code
```

## Conventions

- **File name:** `YYYY-MM-DD-<kebab-feature-name>.md`
- **Spec ID** (in the header line): `SPEC-YYYY-MM-DD-<kebab-feature-name>`
- **Status lifecycle:** `draft` → `approved` → `implemented`
- **Language:** specs are written in English (aligned with the rest of the
  repo docs).
- **Scope:** one spec, one feature. A request bundling separable features
  gets split into separate specs rather than one oversized file.
- **Traceability:** Goals are numbered `G-1`, `G-2`, ...; every acceptance
  criterion states which Goal(s) it satisfies. No orphaned Goal or AC.
- **Verification hints:** every Non-functional requirement bullet includes
  a short `(verify: ...)` note — not a full test plan, just enough that the
  requirement is checkable rather than aspirational.

A spec that replaces an earlier decision links it via the `Supersedes:`
header line. A spec that depends on or complements another, without
replacing it, links it via the `Related:` header line instead.
