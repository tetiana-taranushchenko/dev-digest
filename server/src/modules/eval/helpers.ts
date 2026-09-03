import type { EvalCase, UnifiedDiff } from '@devdigest/shared';
import { sliceDiff } from '@devdigest/reviewer-core';
import type { Container } from '../../platform/container.js';
import { parseUnifiedDiff } from '../../adapters/index.js';
import { ValidationError } from '../../platform/errors.js';
import type { FindingRow, PullRow, RepoRow } from '../../db/rows.js';
import type { EvalCaseRow } from './repository.js';
import {
  EVAL_SEED_DEFAULT_TITLE,
  EVAL_SEED_NEGATIVE_PREFIX,
  EVAL_SEED_POSITIVE_PREFIX,
  EVAL_SEED_SLUG_MAX_LENGTH,
} from './constants.js';

/**
 * Pure/near-pure helpers for `eval/service.ts` (T5). No route/DB access of
 * its own beyond what's explicitly injected (`Container`) — everything here
 * is a small, independently-reasoned-about step the service composes.
 */

// ===========================================================================
// DTO mapping
// ===========================================================================

/** `eval_cases` row → the public `EvalCase` shape (`knowledge.ts:73-84`). */
export function toEvalCaseDto(row: EvalCaseRow): EvalCase {
  return {
    id: row.id,
    owner_kind: row.ownerKind,
    owner_id: row.ownerId,
    name: row.name,
    input_diff: row.inputDiff ?? '',
    input_files: row.inputFiles,
    input_meta: row.inputMeta,
    expected_output: row.expectedOutput,
    notes: row.notes,
  };
}

// ===========================================================================
// owner_id shape validation (AC-3)
// ===========================================================================

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Cheap shape check — `eval_cases.owner_id` is a bare uuid column with no FK
 *  (`eval.ts:13`), so this is the only place a malformed id gets caught. */
export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

// ===========================================================================
// Diff loading for "Turn into eval case" (AC-27)
// ===========================================================================

/**
 * Load a PR's unified diff for seeding — mirrors `reviews/diff-loader.ts`'s
 * two branches (real `git diff`, falling back to reconstructing from
 * persisted `pr_files` patches) without importing that file directly, since
 * it's `reviews`-module-private (Implementation Recommendations #4 /
 * T5 notes).
 */
export async function loadDiffForEval(container: Container, pull: PullRow, repo: RepoRow): Promise<UnifiedDiff> {
  try {
    const diff = await container.git.diff({ owner: repo.owner, name: repo.name }, pull.base, pull.headSha);
    if (diff.files.length > 0) return diff;
  } catch {
    /* fall through to pr_files reconstruction */
  }
  const files = await container.reviewRepo.getPrFiles(pull.id);
  const parts: string[] = [];
  for (const f of files) {
    if (!f.patch) continue;
    parts.push(`diff --git a/${f.path} b/${f.path}`);
    parts.push(`--- a/${f.path}`);
    parts.push(`+++ b/${f.path}`);
    parts.push(f.patch);
  }
  return parseUnifiedDiff(parts.join('\n'));
}

/**
 * Slice a PR diff down to one finding's file for a seeded case's
 * `input_diff`, and REJECT the seed (Implementation Recommendations #4) when
 * the slice didn't actually narrow to that file. `sliceDiff`
 * (`reviewer-core/src/review/reduce.ts:58-72`) silently falls back to the
 * WHOLE raw diff when `path` doesn't match any `diff --git … b/<path>` line
 * and isn't found in `diff.files` either — a "seed with everything" failure
 * mode the spec's own Edge Cases section requires catching at seed time, not
 * run time. Verified cheaply: the slice must still start with this file's own
 * `diff --git a/<file> b/<file>` header.
 */
export function sliceDiffForSeed(diff: UnifiedDiff, file: string): string {
  const sliced = sliceDiff(diff, file);
  const expectedHeader = `diff --git a/${file} b/${file}`;
  if (!sliced.startsWith(expectedHeader)) {
    throw new ValidationError(
      `Cannot seed an eval case for "${file}": its diff could not be narrowed to that file`,
    );
  }
  return sliced;
}

// ===========================================================================
// Seed content (AC-27/28) — mirrors the design reference's `findingToSeed`
// ===========================================================================

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, EVAL_SEED_SLUG_MAX_LENGTH);
}

/** Seed case name — `must-find-<slug>` for a positive case, `no-<slug>` for a
 *  negative one (a dismissed finding), matching the design reference's
 *  `findingToSeed` naming 1:1. */
export function buildSeedCaseName(finding: Pick<FindingRow, 'title' | 'dismissedAt'>): string {
  const slug = slugify(finding.title || EVAL_SEED_DEFAULT_TITLE);
  const prefix = finding.dismissedAt != null ? EVAL_SEED_NEGATIVE_PREFIX : EVAL_SEED_POSITIVE_PREFIX;
  return `${prefix}${slug}`;
}

/**
 * A seeded case's `expected_output` — `[]` when the finding was dismissed
 * (negative case: the agent must NOT re-flag it), else one entry carrying
 * enough shape for `scorer.ts`'s matching plus the informational fields
 * (severity/category/title) it passes through unused (AC-44).
 */
export function buildExpectedOutputFromFinding(
  finding: Pick<FindingRow, 'dismissedAt' | 'severity' | 'category' | 'title' | 'file' | 'startLine' | 'endLine'>,
): unknown[] {
  if (finding.dismissedAt != null) return [];
  return [
    {
      severity: finding.severity,
      category: finding.category,
      title: finding.title,
      file: finding.file,
      start_line: finding.startLine,
      end_line: finding.endLine,
    },
  ];
}
