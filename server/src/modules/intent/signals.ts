import { realpath, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { IntentSignal, IntentSource, UnifiedDiff } from '@devdigest/shared';
import type { ConfidenceSource, IntentSignalInput } from '@devdigest/reviewer-core';
import type { Container } from '../../platform/container.js';
import type { PullRow, RepoRow } from '../../db/rows.js';
import { isWithin, safeRepoPath } from '../_shared/path-safety.js';

/**
 * Signal gathering for the intent classifier (§1 of the plan). Each helper
 * below produces raw content + fetch metadata for one `IntentSignal`; this
 * module does NOT duplicate reviewer-core's per-signal char-budget
 * truncation (`assembleIntentPrompt` already enforces that) — it only
 * applies cheap defensive caps for things reviewer-core has no concept of
 * (a commit/path COUNT, or a pathologically large diff/file read).
 */

const MAX_COMMITS = 30;
const MAX_PATHS = 100;
/** Defensive read cap for the linked plan file — generous vs. its 8 000 char
 *  prompt budget so we never hold a huge file in memory just to truncate it
 *  downstream. */
const PLAN_FILE_READ_CAP = 20_000;
/** Defensive cap for the diff — generous vs. its 12 000 char prompt budget. */
const DIFF_READ_CAP = 50_000;

/** In-repo markdown plan/spec path pattern (`docs/plans/foo.md`, `specs/*.md`). */
const PLAN_FILE_RE = /(?:^|[\s(`'"])((?:docs|specs)\/[A-Za-z0-9_.\-/]+\.md)/;

/** Mirrors `OctokitGitHubClient.resolveLinkedIssue`'s regex exactly
 *  (`server/src/adapters/github/octokit.ts:128`). */
const LINKED_ISSUE_RE = /(?:closes|fixes|resolves)?\s*#(\d+)/i;

/** Any other http(s) URL in the body (rank 3, never fetched — R4/out of scope). */
const EXTERNAL_URL_RE = /https?:\/\/[^\s)]+/;

// ---- path safety (`isWithin`/`safeRepoPath` shared via
// `../_shared/path-safety.js` — see that file for the canonical
// containment-check logic) ------------------------------------------------

/** Confirm `safePath` resolves (after realpath, so no symlink escape) inside
 *  the clone root. Returns the safe repo-relative path again on success. */
async function verifyContainment(clonePath: string, safePath: string): Promise<boolean> {
  let root: string;
  try {
    root = await realpath(clonePath);
  } catch {
    return false;
  }
  const requested = resolve(root, safePath);
  if (!isWithin(root, requested)) return false;
  try {
    const actual = await realpath(requested);
    if (!isWithin(root, actual) || !(await stat(actual)).isFile()) return false;
    return true;
  } catch {
    return false;
  }
}

/** One signal's resolved outcome — the union of what `assembleIntentPrompt`
 *  needs (content + fetched) and what `deriveConfidence`/persistence need
 *  (ref/error/count). Mapped into the three narrower shapes by
 *  `gatherIntentSignals`'s caller-facing return value. */
interface ResolvedSignal {
  signal: IntentSignal;
  fetched: boolean;
  content?: string;
  ref?: string;
  error?: string;
  count?: number;
}

export interface GatheredSignals {
  /** For `classifyIntent({ signals })` → `assembleIntentPrompt`. */
  promptInputs: IntentSignalInput[];
  /** For `deriveConfidence(sources)`. */
  confidenceSources: ConfidenceSource[];
  /** For `upsertIntent`'s `sources` column (metadata only, never raw content). */
  persistedSources: IntentSource[];
}

/** Extract the first in-repo markdown plan/spec path referenced in the PR body. */
export function extractPlanFilePath(body: string): string | null {
  const match = body.match(PLAN_FILE_RE);
  return match?.[1] ?? null;
}

/** Extract the issue number from a `closes/fixes/resolves #N` reference. */
export function extractLinkedIssueNumber(body: string): number | null {
  const match = body.match(LINKED_ISSUE_RE);
  return match?.[1] ? Number(match[1]) : null;
}

/** Extract the first external (non-repo) http(s) URL referenced in the PR body. */
export function extractExternalDocUrl(body: string): string | null {
  const match = body.match(EXTERNAL_URL_RE);
  return match?.[0] ?? null;
}

/**
 * Rank 1 — read an in-repo markdown plan/spec file linked from the PR body.
 * Applies `safeRepoPath()` + realpath containment BEFORE delegating the
 * actual read to `container.git.readFile()` — no traversal, no absolute
 * paths, no symlink escape (security skill / R4 / R7).
 */
async function gatherLinkedPlanFile(
  container: Container,
  repo: RepoRow,
  body: string,
): Promise<ResolvedSignal | null> {
  const rawPath = extractPlanFilePath(body);
  if (!rawPath) return null;

  const safePath = safeRepoPath(rawPath);
  if (!safePath || !repo.clonePath) {
    return { signal: 'linked_plan_file', fetched: false, ref: rawPath, error: 'unsafe_or_unresolved_path' };
  }
  const contained = await verifyContainment(repo.clonePath, safePath);
  if (!contained) {
    return { signal: 'linked_plan_file', fetched: false, ref: safePath, error: 'path_outside_repo_clone' };
  }
  try {
    const content = await container.git.readFile({ owner: repo.owner, name: repo.name }, safePath);
    return {
      signal: 'linked_plan_file',
      fetched: true,
      ref: safePath,
      content: content.slice(0, PLAN_FILE_READ_CAP),
    };
  } catch (err) {
    return {
      signal: 'linked_plan_file',
      fetched: false,
      ref: safePath,
      error: (err as Error).message,
    };
  }
}

/**
 * Rank 2 — the GitHub issue linked via `closes/fixes/resolves #N` in the PR
 * body. Mirrors `OctokitGitHubClient.resolveLinkedIssue()`'s own regex, then
 * calls the client's public `getIssue()` (not a duplicate PR-detail fetch —
 * `resolveLinkedIssue` is private, `getIssue` is the public primitive it
 * calls internally). Best-effort: no GitHub token / API error → `fetched:
 * false`, never thrown (REQ-6).
 */
async function gatherLinkedIssue(
  container: Container,
  repo: RepoRow,
  body: string,
): Promise<ResolvedSignal | null> {
  const number = extractLinkedIssueNumber(body);
  if (number == null) return null;
  try {
    const gh = await container.github();
    const issue = await gh.getIssue({ owner: repo.owner, name: repo.name }, number);
    const content = `Title: ${issue.title}\n\n${issue.body ?? ''}`.trim();
    return { signal: 'linked_issue', fetched: true, ref: `#${issue.number}`, content };
  } catch (err) {
    return { signal: 'linked_issue', fetched: false, ref: `#${number}`, error: (err as Error).message };
  }
}

/** Rank 3 — recorded, never fetched in v1 (§1, R4 out of scope). */
function gatherExternalDocUrl(body: string): ResolvedSignal | null {
  const url = extractExternalDocUrl(body);
  if (!url) return null;
  return {
    signal: 'external_doc_url',
    fetched: false,
    ref: url,
    error: 'external_url_fetch_not_supported',
  };
}

/** Rank 6 — newest 30 commit subject lines for the PR. Goes through
 *  `reviewRepo.getPrCommits` (same seam every other data source in this file
 *  uses) rather than a direct DB query, so it stays fakeable in tests. */
async function gatherCommitMessages(container: Container, prId: string): Promise<ResolvedSignal> {
  const rows = await container.reviewRepo.getPrCommits(prId, MAX_COMMITS);
  const subjects = rows.map((r) => r.message.split(/\r?\n/)[0]?.trim() ?? '').filter(Boolean);
  return {
    signal: 'commit_messages',
    fetched: true,
    content: subjects.map((s) => `- ${s}`).join('\n'),
    count: subjects.length,
  };
}

/** Rank 7 — changed file paths (+ additions/deletions), capped at 100. */
async function gatherChangedPaths(container: Container, prId: string): Promise<ResolvedSignal> {
  const files = await container.reviewRepo.getPrFiles(prId);
  const capped = files.slice(0, MAX_PATHS);
  return {
    signal: 'changed_paths',
    fetched: true,
    content: capped.map((f) => `${f.path} (+${f.additions}/-${f.deletions})`).join('\n'),
    count: capped.length,
  };
}

/**
 * Gather all 8 signal kinds (§1) for `pull`/`repo`/`diff` (diff already
 * loaded by the caller — shared pre-work, never reloaded here). Best-effort
 * throughout: an individual signal's failure never throws (REQ-6); the
 * caller decides what to do if EVERY signal is empty.
 */
export async function gatherIntentSignals(
  container: Container,
  pull: PullRow,
  repo: RepoRow,
  diff: UnifiedDiff,
): Promise<GatheredSignals> {
  const body = pull.body ?? '';

  const [planFile, linkedIssue, commitMessages, changedPaths] = await Promise.all([
    gatherLinkedPlanFile(container, repo, body),
    gatherLinkedIssue(container, repo, body),
    gatherCommitMessages(container, pull.id),
    gatherChangedPaths(container, pull.id),
  ]);
  const externalUrl = gatherExternalDocUrl(body);

  const description: ResolvedSignal = {
    signal: 'pr_description',
    fetched: body.trim().length > 0,
    content: body,
  };
  const title: ResolvedSignal = {
    signal: 'pr_title',
    fetched: pull.title.trim().length > 0,
    content: pull.title,
  };
  const diffSignal: ResolvedSignal = {
    signal: 'diff',
    fetched: diff.raw.trim().length > 0,
    content: diff.raw.slice(0, DIFF_READ_CAP),
  };

  const resolved: ResolvedSignal[] = [
    ...(planFile ? [planFile] : []),
    ...(linkedIssue ? [linkedIssue] : []),
    ...(externalUrl ? [externalUrl] : []),
    description,
    title,
    commitMessages,
    changedPaths,
    diffSignal,
  ];

  return {
    promptInputs: resolved.map((r) => ({
      signal: r.signal,
      content: r.content ?? '',
      fetched: r.fetched,
      ...(r.error ? { error: r.error } : {}),
    })),
    confidenceSources: resolved.map((r) => ({
      signal: r.signal,
      fetched: r.fetched,
      ref: r.ref,
      error: r.error,
      content: r.content,
      count: r.count,
    })),
    persistedSources: resolved.map((r) => ({
      signal: r.signal,
      fetched: r.fetched,
      ref: r.ref ?? null,
      error: r.error ?? null,
    })),
  };
}
