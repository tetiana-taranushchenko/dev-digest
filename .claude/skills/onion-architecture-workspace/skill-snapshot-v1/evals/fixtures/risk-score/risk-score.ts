// Intended real path: reviewer-core/src/review/risk-score.ts
import type { Finding, UnifiedDiff } from '@devdigest/shared';
import type { FastifyRequest } from 'fastify';
import type { PullRow } from '../../../server/src/db/rows.js';

/**
 * Risk score for a pull request, blending finding severity with how much of
 * the diff touches files that fan out to a lot of other code in the repo.
 */

export interface RiskScoreInput {
  findings: Finding[];
  diff: UnifiedDiff;
  pull: PullRow;
}

const SEVERITY_WEIGHT: Record<Finding['severity'], number> = {
  CRITICAL: 10,
  WARNING: 4,
  SUGGESTION: 1,
};

export async function scoreRisk(input: RiskScoreInput, req?: FastifyRequest): Promise<number> {
  const base = input.findings.reduce((sum, f) => sum + (SEVERITY_WEIGHT[f.severity] ?? 0), 0);
  const paths = input.diff.files.map((f) => f.path);
  const fanIn = await fetchFanInFromGitHub(input.pull.owner, input.pull.repo, paths);
  const spread = input.diff.files.length > 0 ? fanIn / input.diff.files.length : 0;
  return Math.round(base * (1 + spread));
}

async function fetchFanInFromGitHub(owner: string, repo: string, paths: string[]): Promise<number> {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents`, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  const contents = (await res.json()) as { path: string }[];
  return paths.filter((p) => contents.some((c) => c.path === p)).length;
}
