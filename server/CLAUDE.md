# server (@devdigest/api)

## Before answering

Search `server/docs/`, `server/specs/`, and `server/INSIGHTS.md` first — the answer may already be there.

## Conventions (not obvious from code)

- `src/vendor/shared/` mirrors `client/src/vendor/shared/` — not auto-synced; diff both sides before assuming a contract matches.

## Do-not-touch

- `src/vendor/shared/` and `src/db/migrations/` — never hand-edit without coordination.

## Use when

- API map, commands, env vars → read [`server/README.md`](README.md)
- Deep-dives (adapters, DI, review context) → read [`server/docs/`](docs/README.md)
- Specifications → read [`server/specs/`](specs/README.md)
- Findings/insights → read [`server/INSIGHTS.md`](INSIGHTS.md)
