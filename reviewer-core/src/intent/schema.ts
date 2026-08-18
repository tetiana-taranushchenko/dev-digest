import { z } from 'zod';

/**
 * LLM-facing structured-output schema for the intent classifier.
 *
 * Structurally the same shape as `Intent` from `@devdigest/shared`
 * (`{ intent, in_scope, out_of_scope }`), but defined fresh here rather than
 * imported + `.extend()`-ed, mirroring the precedent set by
 * `server/src/modules/conventions/contracts.ts`'s `ConventionExtraction`
 * (the closest existing cheap-classifier structured-output schema in this
 * codebase): a dedicated LLM-output schema with its own length/count bounds,
 * decoupled from whatever the persisted/shared contract needs. Extending
 * `Intent` via `.extend()` would only let us ADD fields, not tighten the
 * existing `intent`/`in_scope`/`out_of_scope` field definitions with bounds,
 * so a fresh definition is both the established pattern and the more direct
 * option here.
 *
 * Deliberately has NO `confidence` field — per REQ-4, confidence is a
 * discrete tier derived deterministically in code from which signals were
 * available (`./confidence.ts`), never self-reported by the model. Since
 * this schema IS the classifier's structured-output target, omitting the
 * field here is what makes that guarantee structural rather than a
 * convention someone could forget.
 */
export const IntentClassification = z.object({
  /** One-line summary of what the PR is intended to do. */
  intent: z.string().trim().min(1).max(300),
  /** What the PR's changes are meant to cover. */
  in_scope: z.array(z.string().trim().min(1)).min(1).max(8),
  /** What is explicitly NOT covered by this PR (used to flag scope creep). */
  out_of_scope: z.array(z.string().trim().min(1)).min(1).max(8),
});
export type IntentClassification = z.infer<typeof IntentClassification>;
