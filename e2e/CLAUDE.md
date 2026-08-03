# e2e (@devdigest/e2e)

## Before answering

Search `e2e/docs/`, `e2e/specs/`, and `e2e/INSIGHTS.md` first — the answer may already be there.

## Conventions (not obvious from code)

- Locators are deterministic only (`--url`, `--text`, `find role|text|label`); we never use the AI `chat` command.

## Do-not-touch

- No `chat`/AI locator commands — flows must stay deterministic and key-free; don't introduce a non-deterministic locator to fix a flaky step.
- Never `docker compose down -v` to "reset" — it deletes every imported repo and review from your dev DB, not just the e2e run's state.

## Use when

- How to write flows, coverage → read [`e2e/README.md`](README.md)
- Deep-dives → read [`e2e/docs/`](docs/README.md)
- The flow specifications themselves → read [`e2e/specs/`](specs/README.md)
- Findings/insights → read [`e2e/INSIGHTS.md`](INSIGHTS.md)
