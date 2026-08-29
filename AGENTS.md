# DevDigest — agent guide

Local-first AI PR reviewer. Course starter: works end to end; each lesson adds one feature.

## Before answering

Always search the relevant package's `docs/`, `specs/`, and `INSIGHTS.md` for what the
user asks about FIRST — these are curated and may already answer it — then read code.

## Conventions (not obvious from code)

- NOT a monorepo workspace — each package has its own `package.json`/lockfile; cross-package code is shared via tsconfig path aliases.
- Modules are registered statically in `server/src/modules/index.ts` (no filesystem autoload).
- ESM: relative imports carry the `.js` extension.

## Do-not-touch

- `server/src/vendor/shared/` and `server/src/db/migrations/` — never hand-edit without coordination.

## Use when

- Stack, commands, architecture, how to run → read [README.md](README.md)
- Working inside a package → read that package's `AGENTS.md`: [`server/AGENTS.md`](server/AGENTS.md), [`client/AGENTS.md`](client/AGENTS.md), [`reviewer-core/AGENTS.md`](reviewer-core/AGENTS.md), [`e2e/AGENTS.md`](e2e/AGENTS.md)
- Agent prompt templates → read [`docs/agent-prompts/`](docs/agent-prompts/)
- Custom subagent roster and usage → read [`.claude/agents/README.md`](.claude/agents/README.md)
- How those subagents performed in past multi-agent sessions → read [`.claude/agents/WORKFLOW_INSIGHTS.md`](.claude/agents/WORKFLOW_INSIGHTS.md) (written manually via `/workflow-retro`)
