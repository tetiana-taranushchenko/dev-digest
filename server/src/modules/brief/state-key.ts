import { createHash } from 'node:crypto';
import type { Container } from '../../platform/container.js';

/**
 * brief/state-key.ts — Application ring (`docs/plans/pr-brief.md`, T5a).
 * Coordinates `ReviewRepository.getIntent`, `ContextDocsFacade.
 * resolveForAgent`/`statBodies`, and `RepoIntel.getIndexState` through the
 * container's facade getters only — never `db`/`schema` directly.
 *
 * `computeBriefStateKey` is the ONLY place the PR Brief's composite state
 * key is built. Both the `GET` and `POST /pulls/:id/brief` handlers
 * (`brief/service.ts`, T6) call this same function before doing anything
 * else, so the two paths can never compute the key differently and present
 * a stale Brief as current (AC-19). See "The state key" in the plan's
 * Architecture Notes for the full rationale behind each component and the
 * `mtimeMs + size` exception to `revisionOf` (S-3).
 */

/** The subset of `pull_requests` columns the state key needs (already
 *  loaded by the caller — no extra query here). */
export interface BriefStatePull {
  id: string;
  headSha: string;
  title: string;
  body: string | null;
}

/** The subset of `repos` columns the state key needs. */
export interface BriefStateRepo {
  id: string;
  clonePath: string | null;
}

export interface ComputeBriefStateKeyInput {
  container: Container;
  pull: BriefStatePull;
  repo: BriefStateRepo;
  agentId: string;
}

export interface BriefStateKeyResult {
  /** Opaque SHA-256 over all 7 components, in fixed order (see below). */
  stateKey: string;
  /** Component 6 alone — persisted separately for debugging (T6). */
  docsMetaFingerprint: string;
  /** Component 5's resolved path list — reused by T5b so it never
   *  re-resolves what this function already computed. */
  resolvedPaths: string[];
  /** Whether a (possibly partial) intent row exists for this PR. */
  intentAvailable: boolean;
  /** Component 7's `lastIndexedSha` alone — persisted separately (T6). */
  indexSha: string;
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Builds the 7-component composite state key (AC-17, AC-18, AC-19, D7, D10):
 *
 * 1. `head_sha`                       — `pull.headSha`
 * 2. `agent_id`                       — `agentId`
 * 3. `sha256(title || '\n' || body)`  — `pull.title`/`pull.body`
 * 4. intent marker                    — `reviewRepo.getIntent(pull.id)`
 * 5. attached-doc path list           — `contextDocs.resolveForAgent(agentId)`
 * 6. docs metadata fingerprint        — `contextDocs.statBodies(...)` (S-1)
 * 7. index state                      — `repoIntel.getIndexState(repo.id)`
 *
 * Components are joined with a single space, in this exact order, then the
 * whole joined string is SHA-256'd once — not each component individually
 * (component 3 is the one component that is itself pre-hashed, so the PR's
 * raw title/body text never appears in the joined string).
 */
export async function computeBriefStateKey(
  input: ComputeBriefStateKeyInput,
): Promise<BriefStateKeyResult> {
  const { container, pull, repo, agentId } = input;

  const [intentRow, resolvedPaths, indexState] = await Promise.all([
    container.reviewRepo.getIntent(pull.id),
    container.contextDocs.resolveForAgent(agentId),
    container.repoIntel.getIndexState(repo.id),
  ]);

  // `clonePath` may be null (repo never cloned) — `statBodies` treats an
  // unresolvable root the same way `readBodies` does: every path is
  // reported skipped, never thrown, so the fingerprint below degrades to
  // "no resolved docs" instead of failing the whole key computation.
  const statResult = await container.contextDocs.statBodies(repo.clonePath ?? '', resolvedPaths);
  const docsMetaFingerprint = [...statResult.resolved]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((doc) => `${doc.path}:${doc.mtimeMs}:${doc.size}`)
    .join(',');

  const components = [
    pull.headSha,
    agentId,
    sha256Hex(`${pull.title}\n${pull.body ?? ''}`),
    intentRow ? `${intentRow.headSha}:${intentRow.generated_at}` : 'none',
    resolvedPaths.join('\n'),
    docsMetaFingerprint,
    `${indexState.lastIndexedSha}:${indexState.updatedAt.toISOString()}`,
  ];

  return {
    stateKey: sha256Hex(components.join(' ')),
    docsMetaFingerprint,
    resolvedPaths,
    intentAvailable: intentRow !== undefined,
    indexSha: indexState.lastIndexedSha,
  };
}
