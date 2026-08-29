import type { BriefDrop, Risk, ReviewFocusItem } from '@devdigest/shared';
import type { BriefClassification } from './schema.js';

/**
 * Citation grounding for the Brief (AC-13/AC-14/AC-16) — a **separate**
 * mechanical gate from `../grounding.ts`'s diff-finding gate (D2), reusing
 * its "file-membership index, keep/drop with a recorded reason" shape
 * without importing or modifying that do-not-touch file.
 *
 * Two accepted-file sets, deliberately different in breadth:
 * - `riskFiles` (AC-13): the PR's changed files ∪ every blast-radius file
 *   (changed_symbols + downstream, including nested callers) ∪ every
 *   endpoints_affected string — assembled by the caller.
 * - `focusFiles` (AC-14): the PR's changed files ONLY — narrower, because
 *   review-focus items are meant to point reviewers at real diff hunks, not
 *   at anything merely blast-radius-adjacent.
 *
 * `review_focus[].line` is never validated (D14) — navigation-only hint.
 * Every risk/every review-focus item dropping is a valid outcome; this
 * never throws (AC-16) — it always returns (possibly empty) `kept` arrays.
 */

export interface GroundBriefCitationsAccepted {
  riskFiles: Set<string>;
  focusFiles: Set<string>;
}

export interface GroundBriefCitationsResult {
  kept: {
    risks: Risk[];
    review_focus: ReviewFocusItem[];
  };
  dropped: BriefDrop[];
}

export function groundBriefCitations(
  candidate: BriefClassification,
  accepted: GroundBriefCitationsAccepted,
): GroundBriefCitationsResult {
  const keptRisks: Risk[] = [];
  const keptFocus: ReviewFocusItem[] = [];
  const dropped: BriefDrop[] = [];

  for (const risk of candidate.risks) {
    const survivingRefs: string[] = [];
    for (const file of risk.file_refs) {
      if (accepted.riskFiles.has(file)) {
        survivingRefs.push(file);
      } else {
        dropped.push({
          kind: 'risk_citation',
          label: risk.title,
          file,
          reason: `file '${file}' not found among the PR's changed files, blast-radius files, or affected endpoints`,
        });
      }
    }

    if (survivingRefs.length === 0) {
      dropped.push({
        kind: 'risk',
        label: risk.title,
        file: null,
        reason: `all of risk '${risk.title}''s file citations were dropped`,
      });
      continue;
    }

    keptRisks.push({ ...risk, file_refs: survivingRefs });
  }

  for (const item of candidate.review_focus) {
    if (accepted.focusFiles.has(item.file)) {
      keptFocus.push(item);
    } else {
      dropped.push({
        kind: 'review_focus',
        label: item.file,
        file: item.file,
        reason: `file '${item.file}' is not among the PR's changed files`,
      });
    }
  }

  return { kept: { risks: keptRisks, review_focus: keptFocus }, dropped };
}
