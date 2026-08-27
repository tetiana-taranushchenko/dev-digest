import type { Container } from '../../platform/container.js';
import type {
  Agent,
  AgentSkillLink,
  AgentVersion,
  AttachedContextDoc,
  CiFailOn,
  ContextSource,
  ModelInfo,
  Provider,
  ReviewStrategy,
} from '@devdigest/shared';
import { AgentsRepository } from './repository.js';
import { toAgentDto, toAgentVersionDto } from './helpers.js';
import { scanForInjectionRisk } from '../skills/injection-scan.js';
import { ValidationError } from '../../platform/errors.js';
import { RepoRepository } from '../repos/repository.js';
import { CONTEXT_FOLDERS } from '../repo-intel/constants.js';

/**
 * A2 — agents service. Business logic for the Agents tab + Agent Editor.
 * Provider/model selection uses the LLM adapter's dynamic model list.
 *
 * An Agent = provider + model + system_prompt + linked skills + output_schema +
 * enabled. Config changes are versioned via `agent_versions` (repository).
 */

// Re-exported for backwards compatibility; implementation lives in ./helpers.
export { toAgentDto } from './helpers.js';

export interface CreateAgentInput {
  name: string;
  description?: string;
  provider: Provider;
  model: string;
  system_prompt: string;
  output_schema?: unknown;
  strategy?: ReviewStrategy;
  ci_fail_on?: CiFailOn;
  repo_intel?: boolean;
  enabled?: boolean;
}

export interface UpdateAgentInput {
  name?: string;
  description?: string;
  provider?: Provider;
  model?: string;
  system_prompt?: string;
  output_schema?: unknown;
  strategy?: ReviewStrategy;
  ci_fail_on?: CiFailOn;
  repo_intel?: boolean;
  enabled?: boolean;
}

export class AgentsService {
  private repo: AgentsRepository;
  private repos: RepoRepository;

  constructor(private container: Container) {
    this.repo = new AgentsRepository(container.db);
    this.repos = new RepoRepository(container.db);
  }

  async list(workspaceId: string): Promise<Agent[]> {
    const rows = await this.repo.list(workspaceId);
    const skillCounts = await this.repo.countSkillsByAgent(rows.map((row) => row.id));
    return rows.map((row) => ({ ...toAgentDto(row), skill_count: skillCounts.get(row.id) ?? 0 }));
  }

  async get(workspaceId: string, id: string): Promise<Agent | undefined> {
    const row = await this.repo.getById(workspaceId, id);
    return row ? toAgentDto(row) : undefined;
  }

  /** Delete an agent (and its versions/skill-links, via cascade). */
  async delete(workspaceId: string, id: string): Promise<boolean> {
    return this.repo.deleteById(workspaceId, id);
  }

  async create(workspaceId: string, input: CreateAgentInput, userId?: string): Promise<Agent> {
    const row = await this.repo.insert({
      workspaceId,
      name: input.name,
      description: input.description,
      provider: input.provider,
      model: input.model,
      systemPrompt: input.system_prompt,
      outputSchema: input.output_schema,
      ...(input.strategy !== undefined ? { strategy: input.strategy } : {}),
      ...(input.ci_fail_on !== undefined ? { ciFailOn: input.ci_fail_on } : {}),
      ...(input.repo_intel !== undefined ? { repoIntel: input.repo_intel } : {}),
      enabled: input.enabled,
      createdBy: userId ?? null,
    });
    return toAgentDto(row);
  }

  async update(
    workspaceId: string,
    id: string,
    patch: UpdateAgentInput,
  ): Promise<Agent | undefined> {
    const row = await this.repo.update(workspaceId, id, {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.provider !== undefined ? { provider: patch.provider } : {}),
      ...(patch.model !== undefined ? { model: patch.model } : {}),
      ...(patch.system_prompt !== undefined ? { systemPrompt: patch.system_prompt } : {}),
      ...(patch.output_schema !== undefined ? { outputSchema: patch.output_schema } : {}),
      ...(patch.strategy !== undefined ? { strategy: patch.strategy } : {}),
      ...(patch.ci_fail_on !== undefined ? { ciFailOn: patch.ci_fail_on } : {}),
      ...(patch.repo_intel !== undefined ? { repoIntel: patch.repo_intel } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    });
    return row ? toAgentDto(row) : undefined;
  }

  /**
   * Config history for an agent, newest version first. Workspace-scoped: returns
   * undefined when the agent isn't in this workspace (the route maps that to 404)
   * so version snapshots can't be read across tenants.
   */
  async listVersions(workspaceId: string, agentId: string): Promise<AgentVersion[] | undefined> {
    const agent = await this.repo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    const rows = await this.repo.listVersions(agentId);
    return rows.map(toAgentVersionDto);
  }

  /**
   * A single config snapshot for an agent. Returns undefined when the agent isn't
   * in this workspace OR that version was never recorded (route → 404).
   */
  async getVersion(
    workspaceId: string,
    agentId: string,
    version: number,
  ): Promise<AgentVersion | undefined> {
    const agent = await this.repo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    const row = await this.repo.getVersion(agentId, version);
    return row ? toAgentVersionDto(row) : undefined;
  }

  /** Linked skills for an agent as AgentSkillLink[] (ordered). */
  async skillLinks(agentId: string): Promise<AgentSkillLink[]> {
    const links = await this.repo.linkedSkills(agentId);
    return links.map((l) => ({ agent_id: agentId, skill_id: l.skill.id, order: l.order }));
  }

  /**
   * Set / reorder the agent's linked skills. If `skillIds` is provided, replaces
   * the whole set in that order. Returns the resulting ordered links.
   *
   * Every skill in the requested set is re-scanned for injection/self-declared-
   * danger content on every call (not just when newly added) — a skill's body
   * can change after it was linked, so a stale "safe at link time" check
   * wouldn't catch that. Throws before writing anything if any skill is risky.
   */
  async setSkills(
    workspaceId: string,
    agentId: string,
    skillIds: string[],
  ): Promise<AgentSkillLink[] | undefined> {
    const agent = await this.repo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    await this.assertSkillsSafe(workspaceId, skillIds);
    await this.repo.setSkills(agentId, skillIds);
    return this.skillLinks(agentId);
  }

  /** Link a single skill (append or set order) — additive to existing links. */
  async linkSkill(
    workspaceId: string,
    agentId: string,
    skillId: string,
    order?: number,
  ): Promise<AgentSkillLink[] | undefined> {
    const agent = await this.repo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    await this.assertSkillsSafe(workspaceId, [skillId]);
    const existing = await this.repo.linkedSkills(agentId);
    const resolvedOrder = order ?? existing.length;
    await this.repo.linkSkill(agentId, skillId, resolvedOrder);
    return this.skillLinks(agentId);
  }

  /**
   * Block attaching a skill whose body looks like a prompt-injection attempt
   * or plainly declares itself malicious/dangerous. Unknown skill ids are
   * left for the normal FK/not-found flow to handle, not this check.
   */
  private async assertSkillsSafe(workspaceId: string, skillIds: string[]): Promise<void> {
    for (const skillId of skillIds) {
      const skill = await this.container.skillsRepo.getById(workspaceId, skillId);
      if (!skill) continue;
      const scan = scanForInjectionRisk(skill.body);
      if (scan.risky) {
        throw new ValidationError(
          `Cannot attach "${skill.name}" — its body looks unsafe (${scan.reason}). Edit the skill to remove the risky content, then try again.`,
        );
      }
    }
  }

  /**
   * Attached context documents for an agent (T9, `docs/plans/project-context.md`,
   * AC-6/AC-9). Ordered exactly as stored (`agent_context_docs."order"` ASC).
   * Each entry is resolved fresh against the first connected repo in the
   * workspace that has a clone on disk — an agent isn't bound to one repo, so
   * this mirrors the app's single-connected-repo usage pattern rather than
   * requiring a repo id on this route. A path that no longer resolves (clone
   * missing entirely, or the file itself deleted/moved) is reported with
   * `resolved: false` rather than dropped from the list (AC-9).
   */
  async agentContextDocs(workspaceId: string, agentId: string): Promise<AttachedContextDoc[]> {
    const paths = await this.container.contextDocs.listAgentPaths(agentId);
    if (paths.length === 0) return [];

    const repos = await this.repos.list(workspaceId);
    const clonedRepo = repos.find((r) => r.clonePath);
    if (!clonedRepo?.clonePath) {
      return paths.map((path) => ({
        path,
        source: classifyContextSource(path),
        tokens: null,
        resolved: false,
      }));
    }

    const { resolved } = await this.container.contextDocs.readBodies(clonedRepo.clonePath, paths);
    const bodyByPath = new Map(resolved.map((doc) => [doc.path, doc.body]));
    return paths.map((path) => {
      const body = bodyByPath.get(path);
      return {
        path,
        source: classifyContextSource(path),
        tokens: body !== undefined ? this.container.tokenizer.count(body) : null,
        resolved: body !== undefined,
      };
    });
  }

  /**
   * Replace the agent's attached-document set, in order — paths only, never
   * bodies (AC-6, AC-8). Unlike `POST /agents/:id/skills` (which supports
   * both "set the whole ordered list" and "link one more" in a single
   * endpoint), this is a plain `PUT`: it always replaces the full ordered set,
   * with no partial/append variant, because the spec calls for `PUT` here —
   * a deliberate difference from the skills sibling, not an oversight.
   */
  async setAgentContextDocs(
    workspaceId: string,
    agentId: string,
    paths: string[],
  ): Promise<AttachedContextDoc[] | undefined> {
    const agent = await this.repo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    await this.container.contextDocs.setAgentPaths(agentId, paths);
    return this.agentContextDocs(workspaceId, agentId);
  }

  /**
   * Dynamic model list from the provider adapter's /models. Degrades gracefully
   * to [] if the provider key is not configured (the editor still renders).
   */
  async listModels(provider: Provider): Promise<ModelInfo[]> {
    try {
      const llm = await this.container.llm(provider);
      return await llm.listModels();
    } catch {
      return [];
    }
  }
}

const CONTEXT_FOLDER_TO_SOURCE: Record<(typeof CONTEXT_FOLDERS)[number], ContextSource> = {
  specs: 'spec',
  docs: 'docs',
  insights: 'insights',
};

/**
 * Classify an attached path's `source` from its top-level folder, mirroring
 * `context/service.ts`'s `classifyFolder` + `FOLDER_TO_SOURCE` (not reused
 * directly — that function is unexported and `context/service.ts` isn't an
 * owned path for this task). `.devdigest/specs/` counts as an instance of
 * `specs/`, same as document discovery. Classification is purely path-text
 * based (no clone read needed) so it stays correct even for an unresolved
 * (deleted/moved) attachment; an unrecognised shape defensively falls back to
 * `docs` since `AttachedContextDoc.source` isn't nullable.
 */
function classifyContextSource(relPath: string): ContextSource {
  const [first, second] = relPath.split('/');
  if (first === '.devdigest' && second === 'specs') return 'spec';
  if (first && (CONTEXT_FOLDERS as readonly string[]).includes(first)) {
    return CONTEXT_FOLDER_TO_SOURCE[first as (typeof CONTEXT_FOLDERS)[number]];
  }
  return 'docs';
}
