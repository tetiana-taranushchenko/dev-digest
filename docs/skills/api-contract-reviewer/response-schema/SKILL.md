---
name: response-schema
description: Check backward compatibility of public API response shapes in pull requests. Use when response DTOs, serializers, schemas, examples, field names, types, nullability, requiredness, nesting, enums, or status-specific bodies change.
---

# Response Schema

Trace changed response construction and compare the externally observable schema.

- Flag removed or renamed response fields.
- Flag type, format, enum, nullability, or nesting changes that make previously valid client parsing fail.
- Flag optional fields becoming unconditionally required from the consumer's perspective.
- Treat additive optional fields as compatible unless strict schemas or signatures in the diff prove otherwise.
- Check implementation, runtime validator, OpenAPI schema, and examples for drift.
- Cite the exact changed response line and name the affected client assumption.

## Bad

```ts
return { userId: user.id, displayName: user.name };
// Before returned: { id: string, name: string }
```

Report both field renames as one coherent response-schema breaking change.

## Good

```ts
return { id: user.id, name: user.name, displayName: user.name };
```

Do not report the additive field when existing fields keep their types and meaning.

