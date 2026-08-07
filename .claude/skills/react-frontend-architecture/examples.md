# React / Frontend Architecture — Examples

Good/bad patterns for each rule in [SKILL.md](SKILL.md).

---

## Folder Structure & Colocation

```
BAD: grouped by file type — nothing tells you what belongs to what
src/
├── components/
│   ├── PRRow.tsx
│   ├── RunHistory.tsx
│   └── FindingsPopover.tsx
├── hooks/
│   ├── usePRRow.ts
│   └── useRunHistory.ts
└── utils/
    ├── formatPRRow.ts
    └── formatRunHistory.ts
```

```
GOOD: grouped by feature/route — colocated, one folder to delete when the feature goes
src/app/repos/[repoId]/pulls/
├── page.tsx
└── _components/
    ├── PRRow/
    │   ├── PRRow.tsx
    │   ├── PRRow.helpers.ts     # single consumer — stays local
    │   └── PRRow.test.tsx
    └── FindingsPopover/
        └── FindingsPopover.tsx

# promoted to shared only once a 2nd tree needed the same formatter:
src/lib/format.ts                # formatCost/formatTokenCount — used by PRRow, RunHistory, TraceBody
```

---

## Component Splitting

```jsx
// BAD: one component doing fetch + transform + render (>200 lines in practice)
function RunHistory({ prId }) {
  const [runs, setRuns] = useState([]);
  useEffect(() => {
    fetch(`/api/prs/${prId}/runs`).then(r => r.json()).then(setRuns);
  }, [prId]);

  const sorted = runs.sort((a, b) => b.createdAt - a.createdAt);
  const counts = { critical: 0, high: 0, medium: 0 };
  for (const r of sorted) counts[r.severity]++; // also unguarded — see react-best-practices

  return <div>{/* renders sorted + counts */}</div>;
}

// GOOD: hook owns data + derived logic, component only renders
function useRunHistory(prId) {
  const { data: runs = [] } = useApiQuery(`/api/prs/${prId}/runs`);
  const sorted = useMemo(
    () => [...runs].sort((a, b) => b.createdAt - a.createdAt),
    [runs],
  );
  return { runs: sorted, counts: tallySeverity(sorted) }; // tallySeverity: plain function, unit-testable
}

function RunHistory({ prId }) {
  const { runs, counts } = useRunHistory(prId);
  return <div>{/* renders runs + counts */}</div>;
}
```

---

## Business Logic Placement

```ts
// BAD: business rule (pure) buried inside a hook, untestable without rendering
function useCostBadge(run) {
  const [label, setLabel] = useState('');
  useEffect(() => {
    if (run.cost_usd == null) setLabel('—');
    else if (run.cost_usd < 0.01) setLabel('<$0.01');
    else setLabel(`$${run.cost_usd.toFixed(2)}`);
  }, [run.cost_usd]);
  return label;
}

// GOOD: pure function, tested with plain input/output — no render() needed
function formatCostLabel(costUsd: number | null): string {
  if (costUsd == null) return '—';
  if (costUsd < 0.01) return '<$0.01';
  return `$${costUsd.toFixed(2)}`;
}

// component just calls it during render — no hook needed at all
function CostBadge({ run }) {
  return <span>{formatCostLabel(run.cost_usd)}</span>;
}
```

---

## Constants & Utils Placement

```ts
// BAD: preemptively "global" for a value one component uses
// src/constants/severity.ts
export const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low'];
// ...only ever imported by SeverityCounters.tsx

// GOOD: stays local until a 2nd consumer shows up
// SeverityCounters/SeverityCounters.tsx
const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low'];

// once RunHistory.tsx needed the same order too, THEN promote:
// src/lib/severity.ts
export const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low'];
```

---

## Next.js App Router — Business Logic Pattern

```
BAD: everything crammed into the Server Action
app/[locale]/(internal)/boards/_lib/boards.actions.ts
  'use server'
  export async function createBoard(input) {
    // inline zod parsing, inline db query, inline auth check, inline revalidate — 80 lines
  }
```

```
GOOD: split by responsibility, Server Action stays thin
app/[locale]/(internal)/boards/_lib/
├── boards.schema.ts    # Zod input validation
├── boards.service.ts   # pure business logic — createBoard(input): Board — unit-testable, no Next.js imports
├── boards.loader.ts     # server-side reads, wrapped in React cache()
└── boards.actions.ts    # 'use server' — parse(schema, input) -> service.createBoard() -> revalidatePath()
```

```jsx
// BAD: whole layout promoted to client for one interactive element
'use client'
function Layout({ children }) {
  return (
    <nav>
      <Logo />
      <SearchBox />
    </nav>
  );
  // children (server-rendered page content) now ships as client JS too
}

// GOOD: boundary pushed down to the actual interactive leaf
function Layout({ children }) {          // stays a Server Component
  return (
    <nav>
      <Logo />
      <SearchBox />                       {/* only this file has 'use client' */}
    </nav>
  );
}
```
