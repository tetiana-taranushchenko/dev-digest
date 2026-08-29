import type { BlastRadius } from '@devdigest/shared';
import type { BriefDiffStatEntry, BriefPromptSection } from '@devdigest/reviewer-core';
import type { Container } from '../../platform/container.js';
import type { PullRow, RepoRow } from '../../db/rows.js';
import { NotFoundError } from '../../platform/errors.js';
import { IntentService } from '../intent/service.js';
import { BlastService } from '../blast/service.js';
import { extractLinkedIssueNumber } from '../intent/signals.js';
import { revisionOf } from '../context/write-safety.js';

/**
 * brief/signals.ts — Application ring (`docs/plans/pr-brief.md`, T5b).
 *
 * `gatherBriefSignals` is the EXPENSIVE, `POST`-only half of the PR Brief
 * pipeline — it receives `resolvedPaths` already computed by T5a's
 * `computeBriefStateKey` (via `contextDocs.resolveForAgent`) instead of
 * re-resolving them, and does the reads that are too costly for the cheap
 * `GET` path: `IntentService.get`, `BlastService.get`, `getPrFiles`, a
 * best-effort GitHub issue fetch, `getPrCommits`, and `contextDocs.
 * readBodies` (the only place PR Brief document BODIES — as opposed to
 * metadata — are ever read, AC-7/D1).
 *
 * Every helper below only ever reads through `container`'s facade getters
 * (`reviewRepo`, `contextDocs`, `github()`) or the existing `IntentService`/
 * `BlastService` application services — never `db`/`schema` directly.
 */

/** Mirrors `intent/signals.ts:18`'s `MAX_COMMITS` (not exported there, so
 *  redeclared locally at the same value). */
const MAX_COMMITS = 30;
/** Mirrors `intent/signals.ts:19`'s `MAX_PATHS` — the changed-path list is
 *  capped here, before it ever reaches the budget step (T5c). */
const MAX_PATHS = 100;

/** The two citation-grounding file sets T3's `groundBriefCitations` needs
 *  (AC-13/AC-14) — built here since this is where the PR's changed files and
 *  the Blast Radius result are both already in hand. */
export interface BriefAcceptedFiles {
  /** PR changed files ∪ every `file` in `BlastRadius.changed_symbols`/
   *  `downstream` (including nested `callers[].file`) ∪ every
   *  `endpoints_affected` string — AC-13's three named categories. */
  riskFiles: Set<string>;
  /** The PR's changed files only — narrower than `riskFiles` (AC-14). */
  focusFiles: Set<string>;
}

export interface BriefSignalsResult {
  /** Already in D9 priority order (highest-priority/kept-longest first):
   *  `pr` (undroppable) → `intent` → `blast` → `paths` (diff stats) →
   *  `issue` → `commits` → one `docs` section per attached document. */
  sections: BriefPromptSection[];
  /** Whether a derived intent existed for this PR (AC-3) — persisted by T6,
   *  not itself part of the state key (that's component 4 of T5a's key). */
  intentAvailable: boolean;
  /** `blast.state !== 'degraded'` — persisted by T6 as a metadata flag; does
   *  NOT gate whether the `blast` section is included (unlike `intentAvailable`,
   *  a degraded Blast result is still real, renderable data). */
  blastAvailable: boolean;
  /** `revisionOf`-based content fingerprint over the resolved document
   *  bodies — observability only, never part of the state key (S-3). */
  docsContentFingerprint: string;
  accepted: BriefAcceptedFiles;
}

/** Rank content for the `intent` section from an already-derived
 *  `PrIntentRecord` — never re-derived here (AC-3: only `.get()` is called). */
function renderIntentContent(record: {
  intent: string;
  in_scope: string[];
  out_of_scope: string[];
}): string {
  const inScope = record.in_scope.length > 0 ? record.in_scope.map((s) => `- ${s}`).join('\n') : 'none';
  const outOfScope =
    record.out_of_scope.length > 0 ? record.out_of_scope.map((s) => `- ${s}`).join('\n') : 'none';
  return `Intent: ${record.intent}\n\nIn scope:\n${inScope}\n\nOut of scope:\n${outOfScope}`;
}

/**
 * Intent signal — `IntentService.get()` only (never `.classify()`/
 * `ensureForPull`, AC-3). A `NotFoundError` (no complete intent derived yet)
 * is the one expected outcome and becomes `intentAvailable: false` with the
 * section omitted entirely; any other error propagates (this is not a
 * best-effort read like the linked issue below).
 */
async function gatherIntent(
  container: Container,
  workspaceId: string,
  prId: string,
): Promise<{ section: BriefPromptSection | null; available: boolean }> {
  try {
    const record = await new IntentService(container).get(workspaceId, prId);
    return {
      available: true,
      section: { name: 'intent', droppable: true, kind: 'intent', content: renderIntentContent(record) },
    };
  } catch (err) {
    if (err instanceof NotFoundError) return { available: false, section: null };
    throw err;
  }
}

/**
 * Summary text built ONLY from `changed_symbols`/`downstream`/`state`/
 * `index_status` — never `blast.summary` (AC-4, which `BlastService.get`
 * always sets to `''` today but this must not rely on that).
 */
function renderBlastContent(blast: BlastRadius): string {
  const symbols =
    blast.changed_symbols.length > 0
      ? blast.changed_symbols.map((s) => `- ${s.kind} ${s.name} (${s.file})`).join('\n')
      : 'none';
  const downstream =
    blast.downstream.length > 0
      ? blast.downstream
          .map((d) => {
            const parts = [`${d.caller_count} caller(s)`];
            if (d.endpoints_affected.length > 0) parts.push(`endpoints: ${d.endpoints_affected.join(', ')}`);
            if (d.crons_affected.length > 0) parts.push(`crons: ${d.crons_affected.join(', ')}`);
            return `- ${d.symbol} (${d.file}): ${parts.join(', ')}`;
          })
          .join('\n')
      : 'none';
  return [
    `State: ${blast.state} (index: ${blast.index_status})`,
    `Changed symbols:\n${symbols}`,
    `Downstream impact:\n${downstream}`,
  ].join('\n\n');
}

/** Blast signal — always included (a `degraded` result is still real data,
 *  unlike a missing intent row); `blastAvailable` is reported separately for
 *  T6 to persist as metadata. */
async function gatherBlast(
  container: Container,
  workspaceId: string,
  prId: string,
): Promise<{ section: BriefPromptSection; available: boolean; blast: BlastRadius }> {
  const blast = await new BlastService(container).get(workspaceId, prId);
  return {
    available: blast.state !== 'degraded',
    blast,
    section: { name: 'blast', droppable: true, kind: 'blast', content: renderBlastContent(blast) },
  };
}

/** Diff-stats signal — `{path, additions, deletions}` only, NEVER `patch`
 *  (AC-5): the mapping below only ever reads those three fields off each
 *  row, so there is no code path that could leak a hunk body even by
 *  accident. Returns the full (uncapped) file list alongside the capped
 *  section so `buildAcceptedFiles` can use the PR's real changed-file set
 *  while the prompt-facing section stays capped at `MAX_PATHS`. */
async function gatherDiffStats(
  container: Container,
  prId: string,
): Promise<{ section: BriefPromptSection; files: BriefDiffStatEntry[] }> {
  const rows = await container.reviewRepo.getPrFiles(prId);
  const files: BriefDiffStatEntry[] = rows.map((r) => ({
    path: r.path,
    additions: r.additions,
    deletions: r.deletions,
  }));
  return {
    files,
    section: { name: 'paths', droppable: true, kind: 'diff_stats', files: files.slice(0, MAX_PATHS) },
  };
}

/**
 * Linked-issue signal — reuses `extractLinkedIssueNumber` (`../intent/
 * signals.js`) against `pull.body`, then `container.github().getIssue(...)`,
 * best-effort exactly like `intent/signals.ts`'s `gatherLinkedIssue`
 * (`intent/signals.ts:150-165`): no reference in the body, no GitHub token,
 * or an API error all resolve to `null` (section omitted), never thrown.
 */
async function gatherIssue(
  container: Container,
  repo: RepoRow,
  body: string,
): Promise<BriefPromptSection | null> {
  const number = extractLinkedIssueNumber(body);
  if (number == null) return null;
  try {
    const gh = await container.github();
    const issue = await gh.getIssue({ owner: repo.owner, name: repo.name }, number);
    const content = `Title: ${issue.title}\n\n${issue.body ?? ''}`.trim();
    return { name: 'issue', droppable: true, kind: 'issue', content };
  } catch {
    return null;
  }
}

/** Commit-messages signal — newest `MAX_COMMITS` subject lines, mirroring
 *  `intent/signals.ts`'s `gatherCommitMessages`. */
async function gatherCommits(container: Container, prId: string): Promise<BriefPromptSection> {
  const rows = await container.reviewRepo.getPrCommits(prId, MAX_COMMITS);
  const subjects = rows.map((r) => r.message.split(/\r?\n/)[0]?.trim() ?? '').filter(Boolean);
  return {
    name: 'commits',
    droppable: true,
    kind: 'commits',
    content: subjects.map((s) => `- ${s}`).join('\n'),
  };
}

/**
 * Document-body signal — the only place PR Brief document BODIES are read
 * (AC-7, D1), via `contextDocs.readBodies` (never `listDocuments`, which
 * sets `content: null` by design). Returns one `docs`-kind section PER
 * resolved document (not one combined section) — `assembleBriefPrompt`
 * (`reviewer-core/src/brief/prompt.ts:78,104`) increments a `docIndex`
 * counter per `docs` section it renders (`spec-0`, `spec-1`, ...), which
 * only makes sense if multiple `docs` sections can appear; this also lets
 * T5c's budget trimmer drop oversized documents one at a time instead of
 * all-or-nothing. `docsContentFingerprint` is computed here via `revisionOf`
 * (observability column only — never part of the state key, S-3).
 */
async function gatherDocs(
  container: Container,
  repo: RepoRow,
  resolvedPaths: string[],
): Promise<{ sections: BriefPromptSection[]; docsContentFingerprint: string }> {
  const result = await container.contextDocs.readBodies(repo.clonePath ?? '', resolvedPaths);
  const sections: BriefPromptSection[] = result.resolved.map((doc) => ({
    name: `doc:${doc.path}`,
    droppable: true,
    kind: 'docs',
    content: doc.body,
  }));
  const docsContentFingerprint = [...result.resolved]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((doc) => `${doc.path}:${revisionOf(doc.body)}`)
    .join(',');
  return { sections, docsContentFingerprint };
}

/** AC-13/AC-14's two accepted-file sets, built from data already gathered
 *  above (the PR's full changed-file list + the Blast Radius result) —
 *  never re-fetched. */
function buildAcceptedFiles(files: BriefDiffStatEntry[], blast: BlastRadius): BriefAcceptedFiles {
  const focusFiles = new Set(files.map((f) => f.path));
  const riskFiles = new Set(focusFiles);
  for (const symbol of blast.changed_symbols) riskFiles.add(symbol.file);
  for (const downstream of blast.downstream) {
    riskFiles.add(downstream.file);
    for (const caller of downstream.callers) riskFiles.add(caller.file);
    for (const endpoint of downstream.endpoints_affected) riskFiles.add(endpoint);
  }
  return { riskFiles, focusFiles };
}

/**
 * Gather every PR Brief signal (§ T5b) for `pull`/`repo`/`agentId`, using
 * `resolvedPaths` as already resolved by T5a's `computeBriefStateKey` rather
 * than re-resolving them. `POST`-only — never call this from the cheap `GET`
 * path (`brief/service.ts`, T6).
 */
export async function gatherBriefSignals(
  container: Container,
  workspaceId: string,
  pull: PullRow,
  repo: RepoRow,
  /** Part of the documented T5b signature. Not read directly here —
   *  `resolvedPaths` already carries the agent-scoped resolution T5a
   *  computed via `contextDocs.resolveForAgent(agentId)`, so it is not
   *  re-derived from `agentId` in this function. */
  agentId: string,
  resolvedPaths: string[],
): Promise<BriefSignalsResult> {
  const body = pull.body ?? '';

  const [intentOutcome, blastOutcome, diffStats, issueSection, commitsSection, docsOutcome] =
    await Promise.all([
      gatherIntent(container, workspaceId, pull.id),
      gatherBlast(container, workspaceId, pull.id),
      gatherDiffStats(container, pull.id),
      gatherIssue(container, repo, body),
      gatherCommits(container, pull.id),
      gatherDocs(container, repo, resolvedPaths),
    ]);

  const prSection: BriefPromptSection = {
    name: 'pr',
    droppable: false,
    kind: 'pr',
    title: pull.title,
    body,
  };

  const sections: BriefPromptSection[] = [
    prSection,
    ...(intentOutcome.section ? [intentOutcome.section] : []),
    blastOutcome.section,
    diffStats.section,
    ...(issueSection ? [issueSection] : []),
    commitsSection,
    ...docsOutcome.sections,
  ];

  return {
    sections,
    intentAvailable: intentOutcome.available,
    blastAvailable: blastOutcome.available,
    docsContentFingerprint: docsOutcome.docsContentFingerprint,
    accepted: buildAcceptedFiles(diffStats.files, blastOutcome.blast),
  };
}
