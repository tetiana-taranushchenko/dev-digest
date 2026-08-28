import type { LLMProvider } from '@devdigest/shared';
import { assembleBriefPrompt, type BriefPromptSection } from './prompt.js';
import { BriefClassification } from './schema.js';

export interface GenerateBriefInput {
  /** Injected LLM provider — resolved by the caller via
   *  `resolveFeatureModel('risk_brief')` + `container.llm(provider)`. Mirrors
   *  `classifyIntent`, which likewise never resolves its own provider. */
  llm: LLMProvider;
  /** Model id understood by the injected provider. */
  model: string;
  /** Already-ordered, already-budget-trimmed sections (server-side
   *  `brief/signals.ts` + `brief/budget.ts`). */
  sections: BriefPromptSection[];
  /** OpenRouter session id, forwarded so this call groups with the PR's
   *  other generations in the OpenRouter dashboard. */
  sessionId?: string;
}

export interface GenerateBriefResult {
  brief: BriefClassification;
  tokensIn: number;
  tokensOut: number;
  costUsd: number | null;
  /** From `StructuredResult.attempts` — the billed-generation count. Should
   *  always be `1` given `maxRetries: 0` below, short of a transport error
   *  that `transportRetries: 0` doesn't fully eliminate the possibility of. */
  attempts: number;
  /** Raw model output, for the run trace / observability. */
  raw: string;
}

/**
 * generateBrief — the Brief-layer classifier entry point (AC-11).
 *
 * Exactly **one** `completeStructured` call, with `maxRetries: 0` (hard-
 * coded, not caller-overridable — no reprompt-on-schema-failure loop) and
 * `transportRetries: 0` (T1b — no transport-level retry-on-429/5xx layer
 * either). Together these are what make "exactly one billed generation"
 * actually true rather than only true in the happy path — a deliberate
 * divergence from `classifyIntent`, which defaults to `maxRetries: 1` and
 * passes no `transportRetries` override. A schema-invalid or transient-error
 * response here surfaces as a caller-visible failure (AC-28) instead of a
 * silent reprompt/retry.
 */
export async function generateBrief(input: GenerateBriefInput): Promise<GenerateBriefResult> {
  const messages = assembleBriefPrompt(input.sections);

  const res = await input.llm.completeStructured<BriefClassification>({
    model: input.model,
    schema: BriefClassification,
    schemaName: 'Brief',
    messages,
    temperature: 0,
    maxRetries: 0,
    transportRetries: 0,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
  });

  return {
    brief: res.data,
    tokensIn: res.tokensIn,
    tokensOut: res.tokensOut,
    costUsd: res.costUsd,
    attempts: res.attempts,
    raw: res.raw,
  };
}
