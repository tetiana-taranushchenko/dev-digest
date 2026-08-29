/**
 * @devdigest/reviewer-core — the review engine.
 *
 * Pure review logic shared by the server (local reviews in the studio) and the
 * agent-runner (CI). NO database, GitHub, or filesystem access; the only side
 * effect is an LLM call through an INJECTED LLMProvider (so it is mock-testable).
 *
 * Consumers wire it via a tsconfig path alias (`@devdigest/reviewer-core` →
 * `../reviewer-core/src`) and consume the TypeScript source directly (tsx in
 * dev, vitest in tests, @vercel/ncc bundle in the runner). The package itself
 * never emits JS — its `build` is a type-check.
 */

// Prompt assembly + prompt-injection hardening.
export {
  assemblePrompt,
  wrapUntrusted,
  INJECTION_GUARD,
  type PromptParts,
  type AssembledPrompt,
  type IntentPromptSlot,
  type PromptSectionSummary,
  type PromptAssemblySummary,
} from './prompt.js';

// Citation grounding — the mandatory mechanical gate for diff findings.
export { groundFindings, groundingSummary, type GroundingResult } from './grounding.js';

// Structured-output helpers (Zod → JSON Schema + parse-with-repair).
export {
  toJsonSchema,
  extractJson,
  parseWithRepair,
  type JsonSchema,
  type ParseResult,
} from './llm/structured.js';

// Map-reduce helpers (reduce partials, slice a file's diff).
export { reduceReviews, sliceDiff } from './review/reduce.js';

// The engine entry point: given (diff + resolved agent inputs + LLM) → grounded Review.
export {
  reviewPullRequest,
  DEFAULT_MAP_THRESHOLD_LINES,
  DEFAULT_REVIEW_MAX_RETRIES,
  type ReviewInput,
  type ReviewOutcome,
  type ReviewEvent,
  type PromptAssemblyEvent,
  type ReviewStrategy,
  type ReviewMode,
} from './review/run.js';

// Output: grounded Review → GitHubReviewPayload (body + inline comments + event).
export {
  toReviewPayload,
  gateTriggered,
  countBlockers,
  type ToReviewOptions,
} from './output/to-review.js';

// The single OpenAI-compatible structured provider (OpenRouter), shared by the
// CI runner and the server's openrouter path. Owns session grouping + guards.
export { OpenRouterProvider, type OpenRouterProviderOptions } from './llm/openrouter.js';

// Intent layer — cheap, separate-model classifier that derives a PR's
// intent/scope from the strongest available signals, plus the deterministic,
// code-derived confidence tier (REQ-4). Pure domain logic: no DB, GitHub, or
// fs access — the caller (server, T7) resolves signal content and the LLM
// provider before calling in.
export { IntentClassification } from './intent/schema.js';
export { assembleIntentPrompt, type IntentSignalInput } from './intent/prompt.js';
export {
  classifyIntent,
  type ClassifyIntentInput,
  type ClassifyIntentResult,
} from './intent/classify.js';
export {
  deriveConfidence,
  type ConfidenceSource,
  type ConfidenceResult,
} from './intent/confidence.js';

// Brief layer — one-LLM-call PR brief (`what`/`why`/`risk_level`/`risks`/
// `review_focus`, AC-11). Pure domain logic: no DB, GitHub, or fs access —
// the caller (server, T5b/T6) gathers signal content and resolves the LLM
// provider before calling in.
export { BriefClassification } from './brief/schema.js';
export {
  assembleBriefPrompt,
  type BriefPromptSection,
  type BriefDiffStatEntry,
} from './brief/prompt.js';
export {
  generateBrief,
  type GenerateBriefInput,
  type GenerateBriefResult,
} from './brief/classify.js';
export {
  groundBriefCitations,
  type GroundBriefCitationsAccepted,
  type GroundBriefCitationsResult,
} from './brief/grounding.js';
