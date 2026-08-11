---
name: breaking-change
description: Detect removed, renamed, or incompatibly changed public HTTP API contracts in pull requests. Use when reviewing route paths, methods, parameters, status codes, headers, request bodies, exported API types, or generated API specifications.
---

# Breaking Change

Compare every changed public contract before and after the diff.

- Flag a removed or renamed route, method, parameter, request field, status code, or required header when existing callers can no longer make the same request successfully.
- Flag a newly required request value unless a backward-compatible default exists.
- Flag a changed meaning under the same public name.
- Do not flag private helpers, additive optional fields, or internal refactors that preserve observable behavior.
- Cite the changed line and explain the concrete request an existing client can no longer make.

## Bad

```ts
// Before: GET /users/:id
app.get('/users/:userId/profile', handler); // silently replaces the public route
```

Report this as a breaking change because callers of `GET /users/:id` now receive 404.

## Good

```ts
app.get('/users/:id', legacyHandler); // retained during migration
app.get('/users/:userId/profile', handler);
```

Do not report this when the original contract remains functional.

