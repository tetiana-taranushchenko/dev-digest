---
name: deprecation-policy
description: Enforce safe deprecation of public HTTP APIs and SDK contracts in pull requests. Use when routes, fields, parameters, methods, exports, or response variants are being replaced, marked obsolete, or removed.
---

# Deprecation Policy

Require a migration path before a public contract disappears.

- Prefer retaining the old contract as an adapter to the replacement during a documented deprecation window.
- Require a visible deprecation signal appropriate to the surface: OpenAPI `deprecated`, response headers, SDK annotation, documentation, or changelog entry.
- Require the replacement and migration guidance to be explicit.
- Flag a silent removal or rename even when the replacement is technically better.
- Do not demand deprecation for private, unreleased, experimental, or already-expired contracts when the diff proves that status.
- Cite the removal line and describe the smallest compatible transition.

## Bad

```ts
app.delete('/v1/reports/:id', removeReport); // old GET route was simply deleted
```

Report the silent removal when existing consumers still depend on `GET /v1/reports/:id`.

## Good

```ts
app.get('/v1/reports/:id', deprecatedReportAdapter);
app.get('/v2/reports/:id', getReport);
```

Accept this when the old route signals deprecation and delegates to the supported behavior.

