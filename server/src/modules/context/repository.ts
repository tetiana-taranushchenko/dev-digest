import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * Context-docs data-access — owns the two link tables `agent_context_docs`
 * and `skill_context_docs` (`db/schema/context-docs.ts`), modelled on
 * `agentSkills` (`agents/repository.ts:189-251`). Each table stores an
 * ordered, repo-relative document PATH only — never a body (REQ-2) — so this
 * repository's entire function surface deals in plain strings/numbers/Maps,
 * never a Drizzle row type. `service.ts` (T7) is the only consumer; no
 * business logic (token estimates, dedupe, resolution) lives here.
 */
export class ContextDocsRepository {
  constructor(private db: Db) {}

  // ---- agent_context_docs ---------------------------------------------------

  /** Paths attached to an agent, ordered by `"order"` ASC (AC-8). */
  async listAgentPaths(agentId: string): Promise<string[]> {
    const rows = await this.db
      .select({ path: t.agentContextDocs.path })
      .from(t.agentContextDocs)
      .where(eq(t.agentContextDocs.agentId, agentId))
      .orderBy(asc(t.agentContextDocs.order));
    return rows.map((r) => r.path);
  }

  /**
   * Replace the full set of attached paths for an agent with `paths`, in one
   * transaction: delete-all then re-insert with `order` = array index. An
   * empty array simply clears the attachment set.
   */
  async setAgentPaths(agentId: string, paths: string[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(t.agentContextDocs).where(eq(t.agentContextDocs.agentId, agentId));
      if (paths.length === 0) return;
      await tx
        .insert(t.agentContextDocs)
        .values(paths.map((path, order) => ({ agentId, path, order })));
    });
  }

  // ---- skill_context_docs ----------------------------------------------------

  /** Paths attached to a skill, ordered by `"order"` ASC (AC-8). */
  async listSkillPaths(skillId: string): Promise<string[]> {
    const rows = await this.db
      .select({ path: t.skillContextDocs.path })
      .from(t.skillContextDocs)
      .where(eq(t.skillContextDocs.skillId, skillId))
      .orderBy(asc(t.skillContextDocs.order));
    return rows.map((r) => r.path);
  }

  /**
   * Replace the full set of attached paths for a skill with `paths`, in one
   * transaction: delete-all then re-insert with `order` = array index. An
   * empty array simply clears the attachment set.
   */
  async setSkillPaths(skillId: string, paths: string[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(t.skillContextDocs).where(eq(t.skillContextDocs.skillId, skillId));
      if (paths.length === 0) return;
      await tx
        .insert(t.skillContextDocs)
        .values(paths.map((path, order) => ({ skillId, path, order })));
    });
  }

  // ---- used_by (AC-1) ---------------------------------------------------------

  /**
   * How many distinct agents in `workspaceId` actually have each path in
   * their assembled `## Project context` — direct attachments PLUS every
   * path attached to a skill that's linked to the agent AND enabled (a
   * disabled skill's docs are never injected, so they don't count as
   * "used"), matching the injection logic in `reviews/run-executor.ts`. An
   * agent that reaches a path both ways (direct AND via a linked skill)
   * counts once, not twice — deduped per (path, agentId) before counting.
   */
  async countAgentsByPath(workspaceId: string): Promise<Map<string, number>> {
    const direct = await this.db
      .select({ path: t.agentContextDocs.path, agentId: t.agentContextDocs.agentId })
      .from(t.agentContextDocs)
      .innerJoin(t.agents, eq(t.agentContextDocs.agentId, t.agents.id))
      .where(eq(t.agents.workspaceId, workspaceId));

    const viaSkill = await this.db
      .select({ path: t.skillContextDocs.path, agentId: t.agentSkills.agentId })
      .from(t.skillContextDocs)
      .innerJoin(t.skills, eq(t.skillContextDocs.skillId, t.skills.id))
      .innerJoin(t.agentSkills, eq(t.agentSkills.skillId, t.skillContextDocs.skillId))
      .innerJoin(t.agents, eq(t.agentSkills.agentId, t.agents.id))
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.skills.enabled, true)));

    const agentIdsByPath = new Map<string, Set<string>>();
    for (const row of [...direct, ...viaSkill]) {
      const agentIds = agentIdsByPath.get(row.path) ?? new Set<string>();
      agentIds.add(row.agentId);
      agentIdsByPath.set(row.path, agentIds);
    }
    return new Map([...agentIdsByPath].map(([path, agentIds]) => [path, agentIds.size]));
  }
}
