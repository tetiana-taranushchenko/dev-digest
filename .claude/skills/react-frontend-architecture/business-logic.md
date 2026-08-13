# Business Logic Placement

Where business logic lives: pure functions vs custom hooks, and what belongs in a
component body.

## Business Logic Placement (CRITICAL)

- Pure business logic (calculations, validation, data transforms, formatting) → plain functions with explicit input → output, zero React APIs inside
- The test for "is this a plain function": it must be testable with zero component rendering. If a test needs `render()` to exercise it, it isn't a pure function
- Stateful logic tied to component lifecycle (data fetching, subscriptions, effects, event coordination) → custom hooks, never inline in a component body
- A component body should read as: call hook(s) → derive/render JSX. No inline API calls, no inline validation rules, no inline data transforms inside JSX
- Extraction test for "hook vs plain function": if the code calls `useState`/`useEffect`/another hook internally, it IS a hook and must be named `useX`; if it doesn't, it's a plain function — don't wrap it in a hook "for consistency"
