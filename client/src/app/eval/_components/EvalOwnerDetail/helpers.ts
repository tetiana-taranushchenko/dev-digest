/** helpers.ts — pure data-shaping helpers for EvalOwnerDetail (T13). No
 *  server calls, no React. */

/**
 * Mirrors the server's real `AgentVersion`/`AgentVersionConfig` shape
 * (`server/src/vendor/shared/contracts/knowledge.ts:251-257`) but is a
 * **local** interface, not an import from `@devdigest/shared` — the
 * client's vendored copy of the shared contracts doesn't have this type
 * (pre-existing drift between `client/src/vendor/shared` and
 * `server/src/vendor/shared`; see `docs/plans/eval-pipeline.md`'s Contract
 * changes note — fixing it would mean editing the do-not-touch
 * `client/src/vendor/shared/**`, out of scope for this plan).
 *
 * Deviation from the plan's T13/T14 notes: the plan describes this type as
 * "the local interface defined in T14" (`CompareRunsModal/helpers.ts`),
 * with T13 importing it from there instead of declaring a second one.
 * T13 runs *before* T14 in the plan's own dependency graph (T13 -> T14,
 * "T14 needs the run-selection state T13 introduces"), so
 * `CompareRunsModal/**` does not exist yet when this task runs, and it
 * isn't in T13's owned paths either. The canonical definition therefore
 * lives here instead — T14's implementer should import
 * `AgentVersionSnapshot` from this file rather than redeclaring it.
 */
export interface AgentVersionSnapshot {
  agent_id: string;
  version: number;
  config: {
    provider: string;
    model: string;
    system_prompt: string;
    output_schema: unknown;
    strategy: string;
    ci_fail_on: string;
    repo_intel: boolean;
    skills: string[];
  };
  created_at: string;
}

/**
 * AC-46 — one recent-run row's inferred agent-version label: the latest
 * version snapshot whose `created_at` is at or before this run's `ran_at`
 * (`agent_versions` timeline, `GET /agents/:id/versions`,
 * `server/src/modules/agents/routes.ts:129-133`), formatted as `"v{n}"`.
 * `null` (rendered as `NO_VERSION_LABEL`) when no snapshot qualifies — the
 * run predates every known version, or `ran_at`/every `created_at` fails
 * to parse.
 */
export function inferVersionLabel(ranAt: string, versions: AgentVersionSnapshot[]): string | null {
  const ranAtMs = new Date(ranAt).getTime();
  if (Number.isNaN(ranAtMs)) return null;

  let best: AgentVersionSnapshot | null = null;
  let bestCreatedMs = -Infinity;
  for (const version of versions) {
    const createdMs = new Date(version.created_at).getTime();
    if (Number.isNaN(createdMs) || createdMs > ranAtMs) continue;
    if (createdMs > bestCreatedMs) {
      best = version;
      bestCreatedMs = createdMs;
    }
  }
  return best ? `v${best.version}` : null;
}

/** Fraction (0..1) -> whole percent, same convention as
 *  `EvalOverview/_components/OwnerRow.tsx`'s local `pct`. */
export function pct(fraction: number): number {
  return Math.round(fraction * 100);
}

/** Fraction delta -> percentage-point delta with 2-decimal precision, same
 *  convention as `EvalsTab/_components/MetricStrip.tsx`'s local `deltaPct`. */
export function deltaPct(fraction: number): number {
  return Math.round(fraction * 100 * 100) / 100;
}

/** `null`/`undefined` cost (no findings run, or a case run pre-dating cost
 *  tracking) renders as an em dash rather than "$NaN"/"$null". */
export function formatCost(costUsd: number | null | undefined): string {
  return costUsd == null ? "—" : `$${costUsd.toFixed(2)}`;
}
