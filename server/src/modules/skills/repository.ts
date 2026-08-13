import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { SkillSource, SkillType } from '@devdigest/shared';
import { INITIAL_SKILL_VERSION } from './constants.js';
import { isContentChange } from './helpers.js';

/**
 * A1 — skills data-access. Owns `skills` and `skill_versions`. Also owns the
 * skill-side reverse query over the `agent_skills` link table; the link table
 * itself is owned on the agent side (link/unlink/reorder/list-for-agent) by
 * `AgentsRepository` (see agents/repository.ts:9-11 — "shared with A1's skills
 * repository, but A2 owns the agent side"). Do not duplicate that side here.
 * Workspace-scoped throughout.
 */

import type { SkillRow, SkillVersionRow } from '../../db/rows.js';
export type { SkillRow, SkillVersionRow };

export interface InsertSkill {
  workspaceId: string;
  name: string;
  description: string;
  type: SkillType;
  source: SkillSource;
  body: string;
  enabled?: boolean;
  evidenceFiles?: string[];
}

export interface UpdateSkill {
  name?: string;
  description?: string;
  type?: SkillType;
  source?: SkillSource;
  body?: string;
  enabled?: boolean;
  evidenceFiles?: string[];
}

/** An agent (workspace-scoped) that has a given skill linked, with its order. */
export interface AgentForSkill {
  agentId: string;
  agentName: string;
  order: number;
}

export class SkillsRepository {
  constructor(private db: Db) {}

  async list(workspaceId: string): Promise<SkillRow[]> {
    return this.db.select().from(t.skills).where(eq(t.skills.workspaceId, workspaceId));
  }

  async getById(workspaceId: string, id: string): Promise<SkillRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)));
    return row;
  }

  /** Delete a skill (scoped to workspace). agent_skills links and skill_versions
   *  cascade via FK onDelete. Returns false if no such skill existed. */
  async deleteById(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
      .returning({ id: t.skills.id });
    return rows.length > 0;
  }

  /** Insert a skill AND record version 1 in skill_versions (immutable snapshot). */
  async insert(values: InsertSkill): Promise<SkillRow> {
    const [row] = await this.db
      .insert(t.skills)
      .values({
        workspaceId: values.workspaceId,
        name: values.name,
        description: values.description,
        type: values.type,
        source: values.source,
        body: values.body,
        enabled: values.enabled ?? true,
        version: INITIAL_SKILL_VERSION,
        evidenceFiles: values.evidenceFiles ?? null,
      })
      .returning();
    await this.snapshotVersion(row!.id, INITIAL_SKILL_VERSION, row!.body);
    return row!;
  }

  /**
   * Update a skill. Only a body change bumps the version and snapshots
   * skill_versions; editing name/description/type or toggling enabled does not.
   */
  async update(
    workspaceId: string,
    id: string,
    patch: UpdateSkill,
  ): Promise<SkillRow | undefined> {
    const existing = await this.getById(workspaceId, id);
    if (!existing) return undefined;

    const contentChanged = isContentChange(existing, patch);
    const nextVersion = contentChanged ? existing.version + 1 : existing.version;

    const [row] = await this.db
      .update(t.skills)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.type !== undefined ? { type: patch.type } : {}),
        ...(patch.source !== undefined ? { source: patch.source } : {}),
        ...(patch.body !== undefined ? { body: patch.body } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(patch.evidenceFiles !== undefined ? { evidenceFiles: patch.evidenceFiles } : {}),
        ...(contentChanged ? { version: nextVersion } : {}),
      })
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
      .returning();

    if (contentChanged && row) await this.snapshotVersion(row.id, nextVersion, row.body);
    return row;
  }

  private async snapshotVersion(skillId: string, version: number, body: string): Promise<void> {
    await this.db.insert(t.skillVersions).values({ skillId, version, body }).onConflictDoNothing();
  }

  // ---- skill_versions (immutable body snapshots) ---------------------------

  /** All body snapshots for a skill, newest version first. */
  async listVersions(skillId: string): Promise<SkillVersionRow[]> {
    return this.db
      .select()
      .from(t.skillVersions)
      .where(eq(t.skillVersions.skillId, skillId))
      .orderBy(desc(t.skillVersions.version));
  }

  /** A single body snapshot, or undefined if that version was never recorded. */
  async getVersion(skillId: string, version: number): Promise<SkillVersionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.skillVersions)
      .where(and(eq(t.skillVersions.skillId, skillId), eq(t.skillVersions.version, version)));
    return row;
  }

  /**
   * Restore an older version's body as a NEW top version (append-only — history
   * is never rewritten). Returns undefined if the skill or that version doesn't
   * exist in this workspace.
   */
  async restoreVersion(
    workspaceId: string,
    skillId: string,
    version: number,
  ): Promise<SkillRow | undefined> {
    const target = await this.getVersion(skillId, version);
    if (!target) return undefined;
    return this.update(workspaceId, skillId, { body: target.body });
  }

  // ---- skill-side of agent_skills (reverse of AgentsRepository's owned side) --
  // AgentsRepository already owns link/unlink/reorder/list-for-agent against
  // `agent_skills` (agents/repository.ts:189-235). This repo owns ONLY the
  // reverse read: which agents (in this workspace) use a given skill — for a
  // "used by N agents" badge / delete-guard UI. Do not duplicate link/unlink.

  /** Agents (workspace-scoped) that have this skill linked, with their order. */
  async agentsForSkill(workspaceId: string, skillId: string): Promise<AgentForSkill[]> {
    const rows = await this.db
      .select({ agentId: t.agents.id, agentName: t.agents.name, order: t.agentSkills.order })
      .from(t.agentSkills)
      .innerJoin(t.agents, eq(t.agentSkills.agentId, t.agents.id))
      .where(and(eq(t.agentSkills.skillId, skillId), eq(t.agents.workspaceId, workspaceId)));
    return rows;
  }

  /**
   * Bulk version of `agentsForSkill` — agents (workspace-scoped) linked to
   * ANY of the given skills, grouped by skillId. Added for the `GET
   * /skills?include=stats` list projection so it doesn't run one
   * agentsForSkill query per skill (N+1).
   */
  async agentsForSkills(
    workspaceId: string,
    skillIds: string[],
  ): Promise<Map<string, AgentForSkill[]>> {
    const bySkill = new Map<string, AgentForSkill[]>();
    if (skillIds.length === 0) return bySkill;
    const rows = await this.db
      .select({
        skillId: t.agentSkills.skillId,
        agentId: t.agents.id,
        agentName: t.agents.name,
        order: t.agentSkills.order,
      })
      .from(t.agentSkills)
      .innerJoin(t.agents, eq(t.agentSkills.agentId, t.agents.id))
      .where(and(inArray(t.agentSkills.skillId, skillIds), eq(t.agents.workspaceId, workspaceId)));
    for (const r of rows) {
      const list = bySkill.get(r.skillId) ?? [];
      list.push({ agentId: r.agentId, agentName: r.agentName, order: r.order });
      bySkill.set(r.skillId, list);
    }
    return bySkill;
  }
}
