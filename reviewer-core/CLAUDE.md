# reviewer-core (@devdigest/reviewer-core)

## Before answering

Search `reviewer-core/docs/`, `reviewer-core/specs/`, and `reviewer-core/INSIGHTS.md` first — the answer may already be there.

## Conventions (not obvious from code)

- Contracts (`Review`, `Finding`, `Verdict`) come from `@devdigest/shared` — never duplicated here.

## Do-not-touch

- `grounding.ts`'s citation gate — the safety mechanism against hallucinated line references; loosening it needs explicit sign-off.

## Use when

- Pipeline, public API, commands → read [`reviewer-core/README.md`](README.md)
- Deep-dives → read [`reviewer-core/docs/`](docs/README.md)
- Specifications → read [`reviewer-core/specs/`](specs/README.md)
- Findings/insights → read [`reviewer-core/INSIGHTS.md`](INSIGHTS.md)
- Wrapping up non-trivial work in this package → run the `engineering-insights` skill; it only appends to [`reviewer-core/INSIGHTS.md`](INSIGHTS.md) if something genuinely new and non-obvious came up, otherwise it does nothing
