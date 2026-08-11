---
name: semver-discipline
description: Determine the semantic-version impact of public API changes in pull requests. Use when a published API, SDK, package export, OpenAPI contract, changelog, release manifest, or package version changes.
---

# Semver Discipline

Classify the externally observable change and verify that release metadata matches it.

- Require a major bump for an incompatible public contract change after `1.0.0`.
- Require a minor bump for backward-compatible new public functionality.
- Require a patch bump for backward-compatible fixes with no new public surface.
- Follow an explicit repository prerelease or `0.x` policy when the diff provides one; do not invent it.
- Report a versioning issue only when release/version metadata is in scope or the repository clearly requires it in the same PR.
- Explain which public behavior makes the chosen bump insufficient.

## Bad

```json
{ "version": "2.4.1" }
```

If the PR removes a public endpoint from `2.4.0`, report that a patch bump hides a major breaking change.

## Good

```json
{ "version": "3.0.0" }
```

Accept the major bump when the breaking change is documented for that release.

