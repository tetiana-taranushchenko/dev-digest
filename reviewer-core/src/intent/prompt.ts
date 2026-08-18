import type { ChatMessage, IntentSignal } from '@devdigest/shared';
import { INJECTION_GUARD, wrapUntrusted } from '../prompt.js';

/**
 * One signal's already-resolved content plus its fetch outcome, as gathered
 * by a caller (server-side `modules/intent/signals.ts`, T7 — not this task).
 *
 * `IntentSource` (`@devdigest/shared`) only carries fetch METADATA
 * (`signal`/`fetched`/`ref`/`error`) — it's the persisted/UI-facing shape.
 * `assembleIntentPrompt` additionally needs the actual signal TEXT to build
 * the prompt, so this local type adds `content`. reviewer-core stays free of
 * any DB/GitHub/fs/HTTP import — this module only transforms already-resolved
 * strings into chat messages, exactly like `reviewPullRequest` does for
 * `skills`/`specs` today (`reviewer-core/src/review/run.ts`).
 */
export interface IntentSignalInput {
  signal: IntentSignal;
  /** Resolved text content. Ignored when `fetched` is false. */
  content: string;
  fetched: boolean;
  /** Reason the signal could not be fetched (e.g. `external_url_fetch_not_supported`). */
  error?: string;
}

/**
 * Priority order (rank 1-8, §1 of the plan) and per-signal char budget. Ranks
 * 1-2 are the "explicit documentation" tier; ranks 4-8 are "indirect".
 * `external_doc_url` (rank 3) is recorded but never fetched in v1, hence its
 * 0 budget — it never contributes prompt content, only a source entry
 * (handled by the caller, not here).
 */
const SIGNAL_PRIORITY: IntentSignal[] = [
  'linked_plan_file',
  'linked_issue',
  'external_doc_url',
  'pr_description',
  'pr_title',
  'commit_messages',
  'changed_paths',
  'diff',
];

const SIGNAL_CHAR_BUDGETS: Record<IntentSignal, number> = {
  linked_plan_file: 8_000,
  linked_issue: 4_000,
  external_doc_url: 0,
  pr_description: 4_000,
  pr_title: 300,
  commit_messages: 2_000,
  changed_paths: 2_000,
  diff: 2_000,
};

const SYSTEM_PROMPT =
  'You are a PR-intent classifier. Given the available signals about a pull request ' +
  '(a linked plan/spec, a linked issue, its description, its title, commit messages, ' +
  'changed file paths, and its diff), derive: (1) a one-line summary of what this PR ' +
  'is intended to do, (2) a short list of what is in scope, and (3) a short list of ' +
  'what is explicitly out of scope. Not every signal will be present — work with what ' +
  "you're given.\n" +
  'When signals conflict, prefer the linked plan/spec, then the linked issue, then the ' +
  'description; treat the diff as evidence of what changed, not of why. Do not report a ' +
  'confidence score or any measure of certainty — that is derived separately, outside ' +
  'this call.\n\n' +
  INJECTION_GUARD;

/** Truncate to a signal's documented char budget (§1). A 0 budget yields ''. */
function truncateToBudget(content: string, budget: number): string {
  if (budget <= 0) return '';
  return content.length > budget ? content.slice(0, budget) : content;
}

/**
 * Build the classifier's chat messages from already-resolved signal content,
 * in priority order, each pre-truncated to its documented char budget. Only
 * signals that were fetched and have non-empty (post-truncation) content
 * produce an `<untrusted>` block — unfetched/empty signals (including
 * `external_doc_url`, whose budget is 0) are silently skipped here; their
 * unfetched status is still representable via `IntentSource` for
 * `deriveConfidence` and the persisted/UI sources list, just not part of the
 * prompt itself.
 */
export function assembleIntentPrompt(signals: IntentSignalInput[]): ChatMessage[] {
  const bySignal = new Map(signals.map((s) => [s.signal, s]));

  const blocks: string[] = [];
  for (const signal of SIGNAL_PRIORITY) {
    const input = bySignal.get(signal);
    if (!input || !input.fetched) continue;
    const truncated = truncateToBudget(input.content, SIGNAL_CHAR_BUDGETS[signal]);
    if (truncated.trim().length === 0) continue;
    blocks.push(wrapUntrusted(signal, truncated));
  }

  const user =
    blocks.length > 0
      ? `Derive the PR intent from these signals (highest priority first):\n\n${blocks.join('\n\n')}`
      : 'No signals were available for this PR. Return your best-effort, most conservative assessment.';

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: user },
  ];
}
