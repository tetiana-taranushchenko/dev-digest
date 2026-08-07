# Component Splitting

When and how to split a React component into smaller pieces.

## Component Splitting (HIGH)

- Split a component when: it exceeds ~200 lines, takes >5-7 props, has nested ternaries, or has more than one reason to change
- Prefer "thin component + custom hook" over class-era container/presentational: the hook owns state/data/side effects, the component only turns props into JSX
- One component per file; small colocated stateless sub-components in the same file are fine
- If a component mixes "fetch/compute" concerns with "render" concerns, that's the split line — extract the fetch/compute into a hook, keep render in the component
