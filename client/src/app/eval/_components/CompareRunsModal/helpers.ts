/** helpers.ts — pure data-shaping helpers for CompareRunsModal (T14). No
 *  server calls, no React. */

import type { CiFailOn, EvalRunRecord, Provider, ReviewStrategy } from "@devdigest/shared";
import type { AgentVersionSnapshot } from "../EvalOwnerDetail/helpers";
import type { UpdateAgentInput } from "../../../../lib/hooks/agents";

/**
 * Re-exported, not redeclared — `EvalOwnerDetail/helpers.ts` (T13) already
 * defines the canonical local `AgentVersionSnapshot` interface (the plan's
 * own T13 notes originally described it as living here, in T14's
 * `CompareRunsModal/helpers.ts`, but T13 runs *before* T14 in the plan's
 * dependency graph, so `CompareRunsModal/**` didn't exist yet when T13 was
 * implemented — T13's implementer left an explicit deviation note in
 * `EvalOwnerDetail/helpers.ts` documenting this and instructing T14 to
 * import from there instead of declaring a second, different type). Still
 * **not** an import from `@devdigest/shared` — the client's vendored copy
 * of the shared contracts doesn't have this type (see
 * `docs/plans/eval-pipeline.md`'s Contract changes note).
 */
export type { AgentVersionSnapshot };

/**
 * The agent-version config snapshot in effect for a given run's `ran_at` —
 * the same "latest version whose `created_at <= ran_at`" rule AC-46 uses
 * (`EvalOwnerDetail/helpers.ts`'s `inferVersionLabel`), just returning the
 * full snapshot instead of a formatted label string. This ~15-line lookup
 * is intentionally duplicated here rather than imported: `CompareRunsModal/**`
 * (T14) and `EvalOwnerDetail/**` (T13) are two different tasks' owned
 * paths, and promoting a two-line-different variant of the same loop into a
 * shared module is out of scope for either — the same "duplicating a few
 * lines is cheaper than a cross-task shared facade" tradeoff the plan
 * itself makes server-side (`docs/plans/eval-pipeline.md`, Risks &
 * Mitigations, the `diff-loader.ts` note).
 */
export function matchVersionSnapshot(
  ranAt: string,
  versions: AgentVersionSnapshot[],
): AgentVersionSnapshot | null {
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
  return best;
}

/**
 * Orders two selected runs chronologically — old first, new second. AC-34's
 * "old → new" delta direction and the design reference's `a`/`b` naming
 * (`specs/design-references/eval-pipeline/screen_skills-eval-dashboard-compare-modal.jsx:316-317`)
 * both assume this order.
 */
export function orderRuns(runs: [EvalRunRecord, EvalRunRecord]): [EvalRunRecord, EvalRunRecord] {
  const [a, b] = runs;
  return new Date(a.ran_at).getTime() <= new Date(b.ran_at).getTime() ? [a, b] : [b, a];
}

/** Fraction (0..1) -> whole percent — same convention as
 *  `EvalOwnerDetail/helpers.ts`'s `pct` (colocated per-tree, not shared —
 *  see that file's own comment for the precedent). */
export function pct(fraction: number): number {
  return Math.round(fraction * 100);
}

/** `null`/`undefined` cost -> em dash, else `$X.XXXX` — same convention as
 *  `EvalOwnerDetail/helpers.ts`'s `formatCost`. */
export function formatCost(costUsd: number | null | undefined): string {
  return costUsd == null ? "—" : `$${costUsd.toFixed(4)}`;
}

/**
 * The Promote patch body for `PUT /agents/:id` (AC-41), narrowed from the
 * local `AgentVersionSnapshot.config`'s plain-`string` `provider`/
 * `strategy`/`ci_fail_on` (the plan's own T14-notes shape, mirroring the
 * server's wire type without importing its enums — see this file's
 * `AgentVersionSnapshot` re-export comment) back to the enum types
 * `useUpdateAgent`'s `patch` expects. Safe: these values always originated
 * from the server's real `AgentVersionConfig` (enum-backed at that end),
 * this just restores the narrower type client-side. Deliberately omits
 * `skills` — `UpdateAgentBody` doesn't accept it (T14 notes); that's the
 * separate `POST /agents/:id/skills` call.
 */
export function toAgentUpdatePatch(config: AgentVersionSnapshot["config"]): UpdateAgentInput["patch"] {
  return {
    provider: config.provider as Provider,
    model: config.model,
    system_prompt: config.system_prompt,
    output_schema: config.output_schema,
    strategy: config.strategy as ReviewStrategy,
    ci_fail_on: config.ci_fail_on as CiFailOn,
    repo_intel: config.repo_intel,
  };
}

export interface DiffToken {
  text: string;
  kind: "same" | "add" | "del";
}

/**
 * Word-level diff between two system prompts (AC-34) — LCS over
 * whitespace-split tokens. Mirrors the design reference's `diffTokens`
 * (`screen_skills-eval-dashboard-compare-modal.jsx:286-301`) and the same
 * LCS tradeoff `SkillEditor/_components/VersionsTab/helpers.ts`'s
 * line-level `diffLines` documents: good enough for prompt-length text, not
 * intended for huge documents.
 */
export function diffWords(oldText: string, newText: string): DiffToken[] {
  const a = oldText.split(/(\s+)/);
  const b = newText.split(/(\s+)/);
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const out: DiffToken[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ text: a[i]!, kind: "same" });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      out.push({ text: a[i]!, kind: "del" });
      i++;
    } else {
      out.push({ text: b[j]!, kind: "add" });
      j++;
    }
  }
  while (i < n) out.push({ text: a[i++]!, kind: "del" });
  while (j < m) out.push({ text: b[j++]!, kind: "add" });
  return out;
}
