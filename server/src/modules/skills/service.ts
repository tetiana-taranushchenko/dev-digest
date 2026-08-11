import type { Container } from '../../platform/container.js';
import type { Skill, SkillSource, SkillType } from '@devdigest/shared';
import { ValidationError } from '../../platform/errors.js';
import { UNTRUSTED_SOURCES } from './constants.js';
import { SkillsRepository } from './repository.js';
import { changeSummary, toSkillDto } from './helpers.js';
import type { SkillVersionDto } from './helpers.js';
import { SkillStatsRepository, thirtyDaysAgo } from './stats.repo.js';
import type { CompactSkillStats, SkillStats } from './contracts.js';

/**
 * A1 — skills service. Business logic for the Skills Lab: CRUD, body-version
 * history, and the trust gate for imported/community skills (they land
 * `enabled: false` and can only be flipped on with an explicit `vetted: true`
 * acknowledgement).
 */

export interface CreateSkillInput {
  name: string;
  description: string;
  type: SkillType;
  source: SkillSource;
  body: string;
  enabled?: boolean;
  evidence_files?: string[];
}

export interface UpdateSkillInput {
  name?: string;
  description?: string;
  type?: SkillType;
  source?: SkillSource;
  body?: string;
  enabled?: boolean;
  evidence_files?: string[];
  /** Required to flip `enabled: true` on an untrusted-source skill. */
  vetted?: boolean;
}

export interface AgentForSkillDto {
  agent_id: string;
  agent_name: string;
  order: number;
}

function isUntrustedSource(source: SkillSource): boolean {
  return (UNTRUSTED_SOURCES as readonly string[]).includes(source);
}

export class SkillsService {
  private repo: SkillsRepository;
  private statsRepo: SkillStatsRepository;

  constructor(container: Container) {
    this.repo = new SkillsRepository(container.db);
    this.statsRepo = new SkillStatsRepository(container.db);
  }

  async list(workspaceId: string): Promise<Skill[]> {
    const rows = await this.repo.list(workspaceId);
    return rows.map(toSkillDto);
  }

  /**
   * `list` plus a compact `{agent_count, pull_frequency, accept_rate}` per
   * skill — backs `GET /skills?include=stats`. Batches the agent-link lookup
   * and the shared pull_frequency denominator once across all skills so this
   * stays O(1) extra round-trips + O(n) cheap per-skill aggregates, instead
   * of N calls to the full `getStats` (which also computes findings/category
   * breakdowns and the cost estimate — deliberately NOT done here).
   */
  async listWithCompactStats(
    workspaceId: string,
  ): Promise<(Skill & { stats: CompactSkillStats })[]> {
    const rows = await this.repo.list(workspaceId);
    const skills = rows.map(toSkillDto);
    if (skills.length === 0) return [];

    const since = thirtyDaysAgo();
    const [agentsBySkill, prDenominator] = await Promise.all([
      this.repo.agentsForSkills(workspaceId, skills.map((s) => s.id)),
      this.statsRepo.workspacePrCount(workspaceId, since),
    ]);

    return Promise.all(
      skills.map(async (skill) => {
        const agentIds = (agentsBySkill.get(skill.id) ?? []).map((a) => a.agentId);
        const [acceptRate, prNumerator] = await Promise.all([
          this.statsRepo.acceptRate(agentIds),
          this.statsRepo.prCountForAgents(agentIds, since),
        ]);
        const pull_frequency =
          prDenominator === 0 ? null : agentIds.length === 0 ? 0 : prNumerator / prDenominator;
        return {
          ...skill,
          stats: { agent_count: agentIds.length, pull_frequency, accept_rate: acceptRate },
        };
      }),
    );
  }

  /**
   * Full stats for one skill — backs `GET /skills/:id/stats`. Workspace-
   * scoped: returns undefined when the skill isn't in this workspace (route
   * maps that to 404), mirroring `get`/`listVersions`.
   *
   * FRAMING: every number here is "findings/runs from agents that have this
   * skill attached" — never "findings this skill caused" (see contracts.ts).
   */
  async getStats(workspaceId: string, skillId: string): Promise<SkillStats | undefined> {
    const skill = await this.repo.getById(workspaceId, skillId);
    if (!skill) return undefined;

    const agentLinks = await this.repo.agentsForSkill(workspaceId, skillId);
    const agentIds = agentLinks.map((a) => a.agentId);
    const since = thirtyDaysAgo();

    const [totals, findings30d, estimatedCostByCategory, pullFrequency] = await Promise.all([
      this.statsRepo.findingTotals(agentIds),
      this.statsRepo.findings30d(agentIds, since),
      this.statsRepo.estimatedCostByCategory(agentIds),
      this.statsRepo.pullFrequency(workspaceId, agentIds, since),
    ]);

    const actedOn = totals.accepted + totals.dismissed;
    const acceptRate = actedOn === 0 ? null : totals.accepted / actedOn;

    return {
      skill_id: skill.id,
      skill_name: skill.name,
      agent_count: agentIds.length,
      agents: [...agentLinks]
        .sort((a, b) => a.order - b.order)
        .map((a) => ({ id: a.agentId, name: a.agentName })),
      pull_frequency: pullFrequency,
      accept_rate: acceptRate,
      accepted: totals.accepted,
      dismissed: totals.dismissed,
      pending: totals.pending,
      findings_30d: findings30d.total,
      findings_by_category: findings30d.byCategory,
      estimated_cost_by_category: estimatedCostByCategory,
    };
  }

  async get(workspaceId: string, id: string): Promise<Skill | undefined> {
    const row = await this.repo.getById(workspaceId, id);
    return row ? toSkillDto(row) : undefined;
  }

  async delete(workspaceId: string, id: string): Promise<boolean> {
    return this.repo.deleteById(workspaceId, id);
  }

  async create(workspaceId: string, input: CreateSkillInput): Promise<Skill> {
    const untrusted = isUntrustedSource(input.source);
    if (untrusted && input.enabled === true) {
      throw new ValidationError(
        'Untrusted-source skills must be vetted before they can be enabled',
      );
    }
    const row = await this.repo.insert({
      workspaceId,
      name: input.name,
      description: input.description,
      type: input.type,
      source: input.source,
      body: input.body,
      enabled: untrusted ? false : (input.enabled ?? true),
      evidenceFiles: input.evidence_files,
    });
    return toSkillDto(row);
  }

  async update(
    workspaceId: string,
    id: string,
    patch: UpdateSkillInput,
  ): Promise<Skill | undefined> {
    const existing = await this.repo.getById(workspaceId, id);
    if (!existing) return undefined;

    const effectiveSource = (patch.source ?? existing.source) as SkillSource;
    const enablingNow = patch.enabled === true && !existing.enabled;
    if (isUntrustedSource(effectiveSource) && enablingNow && patch.vetted !== true) {
      throw new ValidationError('This skill is from an untrusted source — vet it before enabling');
    }

    const row = await this.repo.update(workspaceId, id, {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.type !== undefined ? { type: patch.type } : {}),
      ...(patch.source !== undefined ? { source: patch.source } : {}),
      ...(patch.body !== undefined ? { body: patch.body } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      ...(patch.evidence_files !== undefined ? { evidenceFiles: patch.evidence_files } : {}),
    });
    return row ? toSkillDto(row) : undefined;
  }

  /**
   * Body-version history for a skill, newest first. Workspace-scoped: returns
   * undefined when the skill isn't in this workspace (route maps that to 404).
   */
  async listVersions(
    workspaceId: string,
    skillId: string,
  ): Promise<SkillVersionDto[] | undefined> {
    const skill = await this.repo.getById(workspaceId, skillId);
    if (!skill) return undefined;
    const rows = await this.repo.listVersions(skillId);
    // rows are newest-first; the next array entry is the previous (older) version.
    return rows.map((row, i) => ({
      skill_id: row.skillId,
      version: row.version,
      body: row.body,
      summary: changeSummary(rows[i + 1]?.body, row.body),
      created_at: row.createdAt.toISOString(),
    }));
  }

  /** A single body snapshot. Returns undefined if the skill/version isn't found. */
  async getVersion(
    workspaceId: string,
    skillId: string,
    version: number,
  ): Promise<SkillVersionDto | undefined> {
    const skill = await this.repo.getById(workspaceId, skillId);
    if (!skill) return undefined;
    const row = await this.repo.getVersion(skillId, version);
    if (!row) return undefined;
    const prevRow = await this.repo.getVersion(skillId, version - 1);
    return {
      skill_id: row.skillId,
      version: row.version,
      body: row.body,
      summary: changeSummary(prevRow?.body, row.body),
      created_at: row.createdAt.toISOString(),
    };
  }

  /** Restore an older version's body as a new top version (append-only). */
  async restoreVersion(
    workspaceId: string,
    skillId: string,
    version: number,
  ): Promise<Skill | undefined> {
    const row = await this.repo.restoreVersion(workspaceId, skillId, version);
    return row ? toSkillDto(row) : undefined;
  }

  /** Agents (in this workspace) that currently use this skill. */
  async agentsForSkill(
    workspaceId: string,
    id: string,
  ): Promise<AgentForSkillDto[] | undefined> {
    const skill = await this.repo.getById(workspaceId, id);
    if (!skill) return undefined;
    const rows = await this.repo.agentsForSkill(workspaceId, id);
    return rows.map((r) => ({ agent_id: r.agentId, agent_name: r.agentName, order: r.order }));
  }
}
