/**
 * Eval module constants (T5). The "turn a finding into an eval case" seed
 * name is a product decision, not incidental formatting, so it lives here
 * (greppable, single source of truth) rather than inline in `helpers.ts` —
 * same rationale as `blast/constants.ts`'s `MAX_PRIOR_PRS`. Mirrors the
 * naming scheme in the design reference's `findingToSeed`
 * (`specs/design-references/eval-pipeline/findings-turn-into-eval-case-button.jsx:30-46`).
 */

/** Prefix for a seed case name derived from a still-open (accepted-shape) finding — a positive case. */
export const EVAL_SEED_POSITIVE_PREFIX = 'must-find-';

/** Prefix for a seed case name derived from a dismissed finding — a negative case (must NOT be re-flagged). */
export const EVAL_SEED_NEGATIVE_PREFIX = 'no-';

/** Cap on the slugified finding title folded into a seeded case's name. */
export const EVAL_SEED_SLUG_MAX_LENGTH = 34;

/** Fallback slug source when a finding has no usable title. */
export const EVAL_SEED_DEFAULT_TITLE = 'finding';

/** Default review strategy for a case run when its owning agent has none
 *  configured — matches `reviews/constants.ts`'s `REVIEW_STRATEGY` value,
 *  defined locally so `eval/` doesn't reach into `reviews/`'s folder for a
 *  static literal (`onion-architecture` skill — cross-module coordination
 *  goes through `container.*`, not module-internal imports). */
export const EVAL_DEFAULT_STRATEGY = 'single-pass' as const;
