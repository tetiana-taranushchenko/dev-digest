import type { ChatMessage } from '@devdigest/shared';
import type { BriefPromptSection } from '@devdigest/reviewer-core';
import type { Tokenizer } from '../../adapters/tokenizer/index.js';

/**
 * brief/budget.ts — Application ring (`docs/plans/pr-brief.md`, T5c).
 *
 * `trimToBudget` re-assembles and re-measures the FULL prompt on every
 * iteration — never the raw section text — because that's what AC-8's
 * "the Brief's model input" actually means: the system message,
 * `INJECTION_GUARD`, section labels, and `<untrusted>` wrappers all cost
 * tokens too, and a section set that fits raw can still overflow once
 * assembled. The `assemble` callback is `assembleBriefPrompt` from
 * `@devdigest/reviewer-core`, injected by the caller (`brief/service.ts`,
 * T6) rather than imported directly here, so this module stays
 * unit-testable with a trivial fake.
 */

/** D9 priority order, highest-priority (kept-longest) first — mirrors
 *  `gatherBriefSignals`' (T5b) `sections` output order exactly:
 *  `pr` (undroppable) → `intent` → `blast` → `paths` → `issue` → `commits`
 *  → `docs`. `lowestPriorityDroppable` below drops in the exact reverse:
 *  attached docs → commits → issue → paths → blast → intent. */
const DROP_PRIORITY: ReadonlyArray<BriefPromptSection['kind']> = [
  'docs',
  'commits',
  'issue',
  'diff_stats',
  'blast',
  'intent',
];

export interface BriefBudgetOk {
  ok: true;
  sections: BriefPromptSection[];
  messages: ChatMessage[];
  /** Names (T2's `BriefPromptSection.name`) of every section dropped, in
   *  drop order. */
  dropped: string[];
  tokens: number;
}

export interface BriefBudgetFailed {
  ok: false;
  /** Names of every droppable section, all of which were dropped before
   *  giving up (AC-9 / AC-28's "budget rejection" outcome). */
  dropped: string[];
  tokens: number;
}

export type BriefBudgetResult = BriefBudgetOk | BriefBudgetFailed;

/** Sums `tokenizer.count()` over every assembled message's `content` — the
 *  measurement is always taken on the fully assembled prompt, never the raw
 *  section text (this task's acceptance criterion). */
function countMessages(messages: ChatMessage[], tokenizer: Tokenizer): number {
  return messages.reduce((sum, message) => sum + tokenizer.count(message.content), 0);
}

/** The lowest-priority droppable section still present in `sections`, per
 *  `DROP_PRIORITY` (docs → commits → issue → paths → blast → intent). The
 *  undroppable `pr` section (`droppable: false`) is never a candidate. */
function lowestPriorityDroppable(sections: BriefPromptSection[]): BriefPromptSection | undefined {
  for (const kind of DROP_PRIORITY) {
    const victim = sections.find((s) => s.droppable && s.kind === kind);
    if (victim) return victim;
  }
  return undefined;
}

/**
 * Iteratively drops the lowest-priority droppable section, re-assembling
 * and re-counting the FULL prompt each time, until the assembled token
 * count fits `budgetTokens` or nothing droppable remains.
 */
export function trimToBudget(
  sections: BriefPromptSection[],
  budgetTokens: number,
  tokenizer: Tokenizer,
  assemble: (sections: BriefPromptSection[]) => ChatMessage[],
): BriefBudgetResult {
  let current = [...sections];
  let messages = assemble(current);
  let tokens = countMessages(messages, tokenizer);
  const dropped: string[] = [];

  while (tokens > budgetTokens) {
    const victim = lowestPriorityDroppable(current);
    if (!victim) return { ok: false, dropped, tokens };
    current = current.filter((s) => s !== victim);
    dropped.push(victim.name);
    messages = assemble(current);
    tokens = countMessages(messages, tokenizer);
  }

  return { ok: true, sections: current, messages, dropped, tokens };
}
