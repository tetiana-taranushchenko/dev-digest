# Layer Map

Living reference for [SKILL.md](SKILL.md): which path in `server/`/`reviewer-core/`
belongs to which ring, and which modules carry the full `routes → service →
repository` split vs. stay flat by design. Update this file whenever a module
is added or crosses the graduated-layering line (see the skill's "Graduated
Layering by Module Complexity" section).

## Rings → paths

| Ring (innermost → outermost) | Where it lives | Role |
|---|---|---|
| Domain | `reviewer-core/src/**`, `@devdigest/shared` contracts | Pure business logic, zero framework/infra deps |
| Application | `modules/<name>/service.ts`, `constants.ts`, `helpers.ts` | Orchestration, business rules, DTO mapping |
| Infrastructure (ports/adapters) | `modules/<name>/repository.ts`, `server/src/adapters/*`, `server/src/platform/container.ts` | Drizzle data access, external system adapters, composition root |
| Presentation | `modules/<name>/routes.ts` | Fastify handler + Zod request validation, thin |

## Module classification

Registered in `server/src/modules/index.ts`. "Full split" = has `service.ts`
(and `repository.ts` if it touches the DB); "Flat" = `routes.ts` only, or
`routes.ts` + a thin helper file, correctly with no `service.ts` per the
graduated-layering rule.

| Module | Classification | Layers present | Why |
|---|---|---|---|
| `agents` | Full split | routes, service, repository, constants, helpers | Business rules around agent versioning/config |
| `reviews` | Full split | routes, service, repository (+ `repository/` sub-dir), run-executor, diff-loader, findings, constants, helpers | Core review-run orchestration — the most business-logic-heavy module |
| `repo-intel` | Full split | routes, service, repository, `pipeline/`, constants, types | Coordinates multiple data sources (graph, embeddings, ast-grep) |
| `repos` | Full split | routes, service, repository, constants, helpers | Repo lifecycle (add/remove/clone) has real coordination logic |
| `pulls` | Full split | routes, service, status (pure helpers) | `GET /repos/:id/pulls` grew real business logic (GitHub sync-on-read, diff-stat backfill, cost-window batching, severity rollup) — graduated from flat per the skill's explicit carve-out; extracted into `service.ts` |
| `intent` | Full split | routes, service, signals (pure-ish helpers) — reuses `reviews/repository.ts` (`pull.repo.ts`'s `getIntent`/`upsertIntent`/`getPrFiles`), no new repository | Coordinates several data sources (repo clone read, GitHub issue, PR row, commits, diff) and derives a value (confidence tier) before persisting |
| `smart-diff` | Full split | routes, service, classify, assemble, constants — reuses `reviews/repository.ts`, no new repository | Coordinates two data sources (`pr_files` + each agent's latest review's findings) and derives a risk-ordered grouping; no persistence |
| `skills` | Full split | routes, service, repository, stats.repo, constants, contracts, helpers, injection-scan, extract, fetch-url, community-catalog | CRUD + version history plus the trust gate for imported/community skills (untrusted-source detection, injection-risk scan before enabling) |
| `conventions` | Full split | routes, service, repository, extractor, contracts | Coordinates multiple sources (repo repository, `SkillsService`, `ConventionsExtractor`) and derives grounded convention candidates before turning accepted ones into a skill body |
| `blast` | Full split | routes, service, assemble, constants — reuses `reviews/repository.ts` (via `container.reviewRepo`), no new repository | Coordinates multiple `container.repoIntel` reads (blast radius, index state, reverse impact) in parallel and derives a risk-grouped downstream-impact view via the pure `assemble.ts`; no persistence. Mirrors `smart-diff` |
| `context` | Full split | routes, service, repository, manifest, constants, types, write-safety, write-fs | Coordinates multiple sources (repo clone walk via `repo-intel`'s `walkClone`, the two agent/skill link tables, `container.tokenizer`) and derives listing/injection-order values (token estimate, `used_by`, agent-context resolution) before returning them; `write-safety.ts` (pure name/containment rules) and `write-fs.ts` (filesystem effects, root injected) split the document-write pipeline (save/create/upload) into module-local, DB-free units `service.ts` orchestrates |
| `settings` | Flat | routes, constants, feature-models, helpers | Read/write config + BYO-key test-connection; no cross-source coordination |
| `polling` | Flat | routes only | Pure trigger-a-sync endpoint |
| `workspace` | Flat | routes only | Pure CRUD |

## Composition root

`server/src/platform/container.ts` + `server/src/adapters/*` (llm, github, git,
astgrep, secrets, tokenizer, embedder, codeindex, depgraph, auth) are the only
place interface and concrete implementation are wired together — see the
skill's "Composition Root" section.
