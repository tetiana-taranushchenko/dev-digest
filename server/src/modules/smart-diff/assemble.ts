import type { ProposedSplit, SmartDiff, SmartDiffFile, SmartDiffGroup, SmartDiffRole } from '@devdigest/shared';
import { classifyPath } from './classify.js';
import { MAX_PROPOSED_SPLITS, ROLE_ORDER, SPLIT_MIN_FILES_PER_GROUP, SPLIT_TOO_BIG_LINES } from './constants.js';

/**
 * Smart Diff — pure assembler (`assemble.ts`, T3).
 *
 * Turns persisted `pr_files` rows + a per-path finding-line map into the
 * `SmartDiff` contract shape. No I/O, no `this`, no LLM — `pseudocode_summary`
 * is always `null` (REQ-6). Roles come from `classifyPath` (T2); grouping
 * order, `too_big`, and `proposed_splits` thresholds all come from
 * `constants.ts` (REQ-2).
 */

/** Minimal shape `assembleSmartDiff` needs from a `pr_files` row. */
export interface SmartDiffInputFile {
  path: string;
  additions: number;
  deletions: number;
}

interface ClassifiedFile {
  file: SmartDiffInputFile;
  role: SmartDiffRole;
}

function lineCount(file: SmartDiffInputFile): number {
  return file.additions + file.deletions;
}

/** Sorted-ascending, de-duplicated finding lines for one file. */
function sortedUniqueLines(lines: readonly number[] | undefined): number[] {
  if (!lines || lines.length === 0) return [];
  return [...new Set(lines)].sort((a, b) => a - b);
}

/** First path segment for `proposed_splits` grouping; `(root)` for top-level files. */
function firstPathSegment(path: string): string {
  const segments = path.replace(/\\/g, '/').split('/').filter((segment) => segment.length > 0);
  return segments.length > 1 ? segments[0]! : '(root)';
}

function toSmartDiffFile(file: SmartDiffInputFile, findingLinesByPath: Map<string, number[]>): SmartDiffFile {
  return {
    path: file.path,
    pseudocode_summary: null,
    additions: file.additions,
    deletions: file.deletions,
    finding_lines: sortedUniqueLines(findingLinesByPath.get(file.path)),
  };
}

/** Finding count desc -> (additions + deletions) desc -> path asc — fully deterministic. */
function compareFiles(a: SmartDiffFile, b: SmartDiffFile): number {
  if (b.finding_lines.length !== a.finding_lines.length) {
    return b.finding_lines.length - a.finding_lines.length;
  }
  const aLines = a.additions + a.deletions;
  const bLines = b.additions + b.deletions;
  if (bLines !== aLines) return bLines - aLines;
  return a.path.localeCompare(b.path);
}

function buildGroups(classified: ClassifiedFile[], findingLinesByPath: Map<string, number[]>): SmartDiffGroup[] {
  const byRole = new Map<SmartDiffRole, SmartDiffFile[]>();
  for (const { file, role } of classified) {
    const smartDiffFile = toSmartDiffFile(file, findingLinesByPath);
    const bucket = byRole.get(role);
    if (bucket) bucket.push(smartDiffFile);
    else byRole.set(role, [smartDiffFile]);
  }

  const groups: SmartDiffGroup[] = [];
  for (const role of ROLE_ORDER) {
    const files = byRole.get(role);
    if (!files || files.length === 0) continue;
    groups.push({ role, files: [...files].sort(compareFiles) });
  }
  return groups;
}

function buildProposedSplits(coreAndWiring: SmartDiffInputFile[]): ProposedSplit[] {
  const splitGroups = new Map<string, { files: string[]; lines: number }>();
  for (const file of coreAndWiring) {
    const name = firstPathSegment(file.path);
    const group = splitGroups.get(name);
    if (group) {
      group.files.push(file.path);
      group.lines += lineCount(file);
    } else {
      splitGroups.set(name, { files: [file.path], lines: lineCount(file) });
    }
  }

  return [...splitGroups.entries()]
    .filter(([, group]) => group.files.length >= SPLIT_MIN_FILES_PER_GROUP)
    .sort((a, b) => b[1].lines - a[1].lines || a[0].localeCompare(b[0]))
    .slice(0, MAX_PROPOSED_SPLITS)
    .map(([name, group]) => ({ name, files: group.files }));
}

export function assembleSmartDiff(
  files: SmartDiffInputFile[],
  findingLinesByPath: Map<string, number[]>,
): SmartDiff {
  const classified: ClassifiedFile[] = files.map((file) => ({ file, role: classifyPath(file.path) }));

  const groups = buildGroups(classified, findingLinesByPath);

  const totalLines = files.reduce((sum, file) => sum + lineCount(file), 0);

  const coreAndWiring = classified.filter(({ role }) => role !== 'boilerplate').map(({ file }) => file);
  const coreAndWiringLines = coreAndWiring.reduce((sum, file) => sum + lineCount(file), 0);
  const tooBig = coreAndWiringLines > SPLIT_TOO_BIG_LINES;

  return {
    groups,
    split_suggestion: {
      too_big: tooBig,
      total_lines: totalLines,
      proposed_splits: tooBig ? buildProposedSplits(coreAndWiring) : [],
    },
  };
}
