# client (@devdigest/web)

## Before answering

Search `client/docs/`, `client/specs/`, and `client/INSIGHTS.md` first — the answer may already be there.

## Conventions (not obvious from code)

- `src/vendor/shared/` mirrors `server/src/vendor/shared/` — not auto-synced; diff both sides before assuming a contract matches.

## Do-not-touch

- `src/vendor/ui/` and `src/vendor/shared/` — vendored/mirrored; edit deliberately and check the other side.

## Use when

- Route map, commands → read [`client/README.md`](README.md)
- Deep-dives → read [`client/docs/`](docs/README.md)
- UI/flow specifications → read [`client/specs/`](specs/README.md)
- Findings/insights → read [`client/INSIGHTS.md`](INSIGHTS.md)
