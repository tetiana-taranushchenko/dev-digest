import type { IntentConfidence, IntentSignal, IntentSource } from '@devdigest/shared';

/**
 * Input to `deriveConfidence`: an `IntentSource` (`@devdigest/shared`) plus
 * the actual resolved content for that signal, when known.
 *
 * The base `IntentSource` contract only carries fetch METADATA
 * (`signal`/`fetched`/`ref`/`error`) — that's deliberate, it's the shape
 * persisted on the `pr_intent` row and surfaced in the UI's sources line, and
 * it should never leak raw PR text. But the `medium` tier's rule ("≥ 200
 * non-whitespace chars after stripping markdown noise") needs to inspect the
 * `pr_description` content length, and the `high` tier needs to confirm a
 * rank-1/2 source's content is non-empty — metadata alone can't answer
 * either. So this local type augments `IntentSource` with an optional
 * `content` (for the length checks) and an optional `count` (so the `low`
 * tier's generated reason can say "6 commit messages" instead of just
 * "commit messages", matching the plan's example). Both fields are read-only
 * inputs to this pure function; neither is ever echoed back in the result —
 * `confidence_reason` is built from signal names/paths/counts only, never
 * raw content, so it stays safe to render directly in the UI tooltip.
 */
export interface ConfidenceSource extends IntentSource {
  /** Resolved text content for this signal, when available. */
  content?: string;
  /** Item count for list-like signals (commit messages, changed paths). */
  count?: number;
}

export interface ConfidenceResult {
  confidence: IntentConfidence;
  confidence_reason: string;
}

/** Rank 1-2, the "explicit documentation" tier (§1 of the plan). */
const DOC_SIGNALS: IntentSignal[] = ['linked_plan_file', 'linked_issue'];

const MEDIUM_MIN_NON_WHITESPACE_CHARS = 200;

/** Strip `[text](url)` link syntax and `- [ ]`/`- [x]` checklist markers. */
function stripMarkdownNoise(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*-\s*\[[ xX]\]\s*/gm, '');
}

function nonWhitespaceLength(text: string): number {
  return text.replace(/\s/g, '').length;
}

function joinWithAnd(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0]!;
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

/**
 * Deterministic, code-derived confidence tier (REQ-4) — never a
 * model-self-reported number. Pure function of the resolved sources; no I/O.
 *
 * Rules (§1 of the plan):
 * - `high`: at least one rank-1 (`linked_plan_file`) or rank-2
 *   (`linked_issue`) source with `fetched: true` AND non-empty content.
 * - `medium`: no fetched doc, but `pr_description` is present with ≥ 200
 *   non-whitespace chars after stripping markdown link/checklist noise.
 * - `low`: everything else — title/commits/paths/diff only, or a linked doc
 *   that failed to fetch.
 */
export function deriveConfidence(sources: ConfidenceSource[]): ConfidenceResult {
  const bySignal = new Map(sources.map((s) => [s.signal, s]));

  const docSource = DOC_SIGNALS.map((signal) => bySignal.get(signal)).find(
    (s): s is ConfidenceSource => !!s && s.fetched && !!s.content && s.content.trim().length > 0,
  );
  if (docSource) {
    const label = docSource.signal === 'linked_plan_file' ? 'the linked plan/spec' : 'the linked issue';
    const reason = docSource.ref ? `Derived from ${docSource.ref}.` : `Derived from ${label}.`;
    return { confidence: 'high', confidence_reason: reason };
  }

  const description = bySignal.get('pr_description');
  if (description?.fetched && description.content) {
    const stripped = stripMarkdownNoise(description.content);
    if (nonWhitespaceLength(stripped) >= MEDIUM_MIN_NON_WHITESPACE_CHARS) {
      return {
        confidence: 'medium',
        confidence_reason: 'No linked plan or ticket; derived from the PR description.',
      };
    }
  }

  const failedDoc = DOC_SIGNALS.some((signal) => {
    const s = bySignal.get(signal);
    return !!s && !s.fetched;
  });

  const usedParts: string[] = [];
  const diff = bySignal.get('diff');
  if (diff?.fetched) usedParts.push('the diff');
  const commits = bySignal.get('commit_messages');
  if (commits?.fetched) {
    usedParts.push(
      commits.count != null
        ? `${commits.count} commit message${commits.count === 1 ? '' : 's'}`
        : 'commit messages',
    );
  }
  const paths = bySignal.get('changed_paths');
  if (paths?.fetched) usedParts.push('changed paths');
  const title = bySignal.get('pr_title');
  if (title?.fetched) usedParts.push('the PR title');

  const prefix = failedDoc ? 'A linked plan or ticket failed to fetch' : 'No linked plan or ticket';
  const reason =
    usedParts.length > 0
      ? `${prefix}; inferred from ${joinWithAnd(usedParts)}.`
      : `${prefix}; insufficient signal to determine intent confidently.`;

  return { confidence: 'low', confidence_reason: reason };
}
