import type { ChatMessage } from '@devdigest/shared';
import { INJECTION_GUARD, wrapUntrusted } from '../prompt.js';

/**
 * PR Brief prompt assembly (T2).
 *
 * A **new, dedicated** function — does not reuse the generic `assemblePrompt`
 * — so that AC-5's "never a diff hunk body" constraint is structurally
 * obvious rather than routed through a generically-named `diff` field: the
 * `diff_stats` section kind below only ever carries `{path, additions,
 * deletions}`, so there is no field a caller could put a hunk body into even
 * by mistake.
 *
 * `assembleBriefPrompt` takes an **already-ordered, already-filtered**
 * section array — it does no dropping of its own. The budget trimmer
 * (server-side `brief/budget.ts`, T5c) calls it repeatedly with
 * progressively smaller inputs and measures the real assembled result.
 */

/** One file's diff statistics — never a hunk/patch body (AC-5). */
export interface BriefDiffStatEntry {
  path: string;
  additions: number;
  deletions: number;
}

interface BriefPromptSectionBase {
  /** Stable identifier for this section, used to report which section a
   *  budget-based drop removed (server-side `brief/budget.ts`, T5c). */
  name: string;
  /** Whether the budget trimmer (T5c) may drop this section. PR title/body
   *  is never droppable. */
  droppable: boolean;
}

export type BriefPromptSection =
  | (BriefPromptSectionBase & { kind: 'pr'; title: string; body: string })
  | (BriefPromptSectionBase & { kind: 'diff_stats'; files: BriefDiffStatEntry[] })
  | (BriefPromptSectionBase & { kind: 'intent'; content: string })
  | (BriefPromptSectionBase & { kind: 'blast'; content: string })
  | (BriefPromptSectionBase & { kind: 'issue'; content: string })
  | (BriefPromptSectionBase & { kind: 'commits'; content: string })
  | (BriefPromptSectionBase & { kind: 'docs'; content: string });

const SYSTEM_PROMPT =
  'You are a PR-brief generator. Given the available signals about a pull request ' +
  '(its title/description, diff statistics, derived intent, blast radius, a linked ' +
  'issue, commit messages, and attached project-context documents), produce: (1) a ' +
  'short "what" summary of the change, (2) a short "why" summary of its motivation, ' +
  '(3) an overall risk_level (low/medium/high), (4) a bounded list of specific risks, ' +
  'each citing the file(s) it applies to, and (5) a bounded list of review-focus ' +
  'items — a file, a line, and a reason a reviewer should look there. Not every ' +
  "signal will be present — work with what you're given. Every citation (a risk's " +
  'file_refs, a review-focus file) MUST name a file actually present in the diff ' +
  'statistics or blast radius below — never invent a path.\n\n' +
  INJECTION_GUARD;

function renderDiffStats(files: BriefDiffStatEntry[]): string {
  const totals = files.reduce(
    (acc, f) => ({ additions: acc.additions + f.additions, deletions: acc.deletions + f.deletions }),
    { additions: 0, deletions: 0 },
  );
  const lines = files.map((f) => `${f.path}: +${f.additions} -${f.deletions}`);
  lines.push(`Total: +${totals.additions} -${totals.deletions}`);
  return lines.join('\n');
}

/**
 * Build the Brief classifier's chat messages from already-resolved,
 * already-ordered sections. Every section's content is untrusted (PR-author-
 * or repo-derived) and is delimiter-wrapped with `wrapUntrusted`; the shared
 * `INJECTION_GUARD` is appended to the system message exactly like
 * `assemblePrompt` does.
 */
export function assembleBriefPrompt(sections: BriefPromptSection[]): ChatMessage[] {
  const system = SYSTEM_PROMPT;
  const blocks: string[] = [];
  let docIndex = 0;

  for (const section of sections) {
    switch (section.kind) {
      case 'pr': {
        const content = `Title: ${section.title}\n\n${section.body}`;
        blocks.push(`## PR\n${wrapUntrusted('pr', content)}`);
        break;
      }
      case 'diff_stats': {
        blocks.push(`## Diff statistics\n${wrapUntrusted('diff-stats', renderDiffStats(section.files))}`);
        break;
      }
      case 'intent':
        blocks.push(`## Derived intent\n${wrapUntrusted('intent', section.content)}`);
        break;
      case 'blast':
        blocks.push(`## Blast radius\n${wrapUntrusted('blast', section.content)}`);
        break;
      case 'issue':
        blocks.push(`## Linked issue\n${wrapUntrusted('issue', section.content)}`);
        break;
      case 'commits':
        blocks.push(`## Commit messages\n${wrapUntrusted('commits', section.content)}`);
        break;
      case 'docs': {
        const label = `spec-${docIndex++}`;
        blocks.push(`## Project context (${label})\n${wrapUntrusted(label, section.content)}`);
        break;
      }
    }
  }

  const user =
    blocks.length > 0
      ? blocks.join('\n\n')
      : 'No signals were available for this PR. Return your best-effort, most conservative assessment.';

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}
