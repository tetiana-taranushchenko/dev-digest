import type { Intent, LLMProvider } from '@devdigest/shared';
import { assembleIntentPrompt, type IntentSignalInput } from './prompt.js';
import { IntentClassification } from './schema.js';

export interface ClassifyIntentInput {
  /** Injected LLM provider — resolved by the caller via `resolveFeatureModel`
   *  ('review_intent') + `container.llm(provider)`. Mirrors `reviewPullRequest`,
   *  which likewise never resolves its own provider. */
  llm: LLMProvider;
  /** Model id understood by the injected provider. */
  model: string;
  /** Already-resolved signal content, in whatever order the caller gathered it
   *  (priority ordering is applied inside `assembleIntentPrompt`). */
  signals: IntentSignalInput[];
  /** Structured-output reprompt-on-error budget. Defaults to 1 (cheap classifier). */
  maxRetries?: number;
  /** OpenRouter session id, forwarded so this call groups with the review's
   *  other generations in the OpenRouter dashboard. */
  sessionId?: string;
}

export interface ClassifyIntentResult {
  /** The parsed, schema-validated intent (no confidence — REQ-4). */
  intent: Intent;
  tokensIn: number;
  tokensOut: number;
  costUsd: number | null;
  /** Raw model output, for the run trace / observability. */
  raw: string;
}

/**
 * classifyIntent — the intent-layer classifier entry point.
 *
 * One `completeStructured` call against the cheap, separately-configured
 * `review_intent` model. Zero other side effects: no persistence, no
 * logging beyond whatever `completeStructured` itself already does. Mirrors
 * the calling shape of `server/src/modules/conventions/extractor.ts`'s
 * `resolveFeatureModel` → `container.llm(provider)` →
 * `completeStructured({...})` sequence — but `resolveFeatureModel` /
 * `container.llm` are server-side concepts (they touch settings/DB), so this
 * function accepts an already-resolved `llm` + `model`, exactly like
 * `reviewPullRequest` accepts its LLM provider already resolved.
 */
export async function classifyIntent(input: ClassifyIntentInput): Promise<ClassifyIntentResult> {
  const messages = assembleIntentPrompt(input.signals);

  const res = await input.llm.completeStructured<IntentClassification>({
    model: input.model,
    schema: IntentClassification,
    schemaName: 'Intent',
    messages,
    temperature: 0,
    maxRetries: input.maxRetries ?? 1,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
  });

  return {
    intent: res.data,
    tokensIn: res.tokensIn,
    tokensOut: res.tokensOut,
    costUsd: res.costUsd,
    raw: res.raw,
  };
}
