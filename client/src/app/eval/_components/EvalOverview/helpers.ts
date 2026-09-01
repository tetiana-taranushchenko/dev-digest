/** helpers.ts — pure data-shaping helpers for EvalOverview (T12). No server
 *  calls, no React — cross-references the overview's `EvalDashboard[]`
 *  (T8's `useEvalOverview`) against the already-loaded agents/skills lists
 *  (`useAgents`/`useSkills`), mirroring
 *  `../../../../components/eval-tab/EvalsTab/helpers.ts`'s `isOrphanOwner`
 *  (same AC-39 pattern; kept as its own small copy here per the plan's "no
 *  new endpoint" note — this tree has no other consumer to share it with). */

import type { Agent, EvalDashboard, EvalOwnerKind, Skill } from "@devdigest/shared";

export interface ResolvedOwner {
  /** `null` when `orphaned` — render `OWNER_DELETED_LABEL` instead. */
  name: string | null;
  model: string | null;
  orphaned: boolean;
}

/** AC-39 — resolve one overview row's display name against the workspace's
 *  current agents/skills; `orphaned` when `owner_id` no longer resolves to
 *  either (the owner was deleted but its eval cases were not
 *  cascade-deleted, per AC-39's own no-cascade requirement). */
export function resolveOwner(
  ownerKind: EvalOwnerKind | null,
  ownerId: string | null,
  agents: Agent[],
  skills: Skill[],
): ResolvedOwner {
  if (ownerKind === "agent") {
    const agent = agents.find((a) => a.id === ownerId);
    return agent ? { name: agent.name, model: agent.model, orphaned: false } : { name: null, model: null, orphaned: true };
  }
  if (ownerKind === "skill") {
    const skill = skills.find((sk) => sk.id === ownerId);
    return skill ? { name: skill.name, model: null, orphaned: false } : { name: null, model: null, orphaned: true };
  }
  // owner_kind/owner_id are only null for a scoped (non-overview) dashboard
  // read; the overview array never contains one (`eval/service.ts#getOverview`
  // builds it from distinct owners), but the shared `EvalDashboard` type
  // still allows it — treat it as orphaned defensively rather than crash.
  return { name: null, model: null, orphaned: true };
}

/** AC-43 — total eval cases the workspace-wide "Run all agents" bulk run
 *  will execute, excluding orphaned owners' cases (AC-39 — they're excluded
 *  from any "Run all evals"/"Run all agents" bulk action). */
export function totalRunnableCases(overview: EvalDashboard[], agents: Agent[], skills: Skill[]): number {
  return overview
    .filter((d) => !resolveOwner(d.owner_kind, d.owner_id, agents, skills).orphaned)
    .reduce((sum, d) => sum + d.cases_total, 0);
}

/** ISO timestamp -> locale string, falling back to the raw ISO string on a
 *  bad date (same pattern as `ReviewRunAccordion.tsx`/`ContextView/helpers.ts`);
 *  `null`/`undefined` (no runs yet) renders via `NEVER_RUN_LABEL` instead. */
export function formatRanAt(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}
