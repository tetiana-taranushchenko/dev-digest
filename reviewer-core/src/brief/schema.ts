import { z } from 'zod';
import { RiskLevel, RiskSeverity } from '@devdigest/shared';

/**
 * LLM-facing structured-output schema for the PR Brief (AC-11).
 *
 * Structurally the same shape as `Brief` from `@devdigest/shared`
 * (`{ what, why, risk_level, risks, review_focus }`), but defined fresh here
 * rather than imported + `.extend()`-ed — mirroring the precedent set by
 * `intent/schema.ts`'s `IntentClassification`: a dedicated LLM-output schema
 * with its own length/count bounds, decoupled from whatever the
 * persisted/shared contract needs. `Brief.extend()` would only let us ADD
 * fields, not tighten `what`/`why`/`risks`/`review_focus` with bounds, so a
 * fresh definition is both the established pattern and the more direct
 * option here.
 *
 * `risk_level` and each risk's `severity` reuse the shared `RiskLevel`/
 * `RiskSeverity` enums directly — those are fixed vocabularies, not bounded
 * free text, so there is nothing to tighten by redefining them.
 */

/**
 * One risk item as classified by the model. Structurally mirrors the shared
 * `Risk` contract (`kind`/`title`/`explanation`/`severity`/`file_refs`) but,
 * like `BriefClassification` itself, is defined fresh with its own bounds
 * rather than reusing `Risk` via `.extend()`.
 */
const BriefRiskItem = z.object({
  kind: z.string().trim().min(1).max(100),
  title: z.string().trim().min(1).max(200),
  explanation: z.string().trim().min(1).max(1000),
  severity: RiskSeverity,
  /** Candidate file citations — narrowed by the grounding gate (T3), not here. */
  file_refs: z.array(z.string().trim().min(1)).max(20),
});

/**
 * One review-focus item as classified by the model. Structurally mirrors the
 * shared `ReviewFocusItem` contract, bounding `file`/`reason` length. `line`
 * is a navigation-only hint (D14) — the grounding gate (T3) validates `file`
 * against the PR's changed files but never checks `line`.
 */
const BriefReviewFocusItem = z.object({
  file: z.string().trim().min(1).max(500),
  line: z.number().int().nonnegative(),
  reason: z.string().trim().min(1).max(500),
});

export const BriefClassification = z.object({
  /** One or two sentences: what this PR does. */
  what: z.string().trim().min(1).max(500),
  /** A short paragraph: why it matters / the motivation behind it. */
  why: z.string().trim().min(1).max(2000),
  /** Model-produced overall risk tier — never derived in code (Recommendation
   *  1 of the spec explicitly declined a code-derived alternative). */
  risk_level: RiskLevel,
  /** Bounded to match the mockup's list length (max 8). */
  risks: z.array(BriefRiskItem).max(8),
  /** Bounded to match the mockup's list length (max 8). */
  review_focus: z.array(BriefReviewFocusItem).max(8),
});
export type BriefClassification = z.infer<typeof BriefClassification>;
