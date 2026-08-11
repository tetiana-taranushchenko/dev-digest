import type {
  ConventionCandidate,
  ConventionCategory,
  ConventionStatus,
  Skill,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import type { ConventionRow } from '../../db/rows.js';
import { RepoRepository } from '../repos/repository.js';
import { SkillsService } from '../skills/service.js';
import type {
  ConventionSkillDraft,
  CreateConventionSkillBody,
  UpdateConventionBody,
} from './contracts.js';
import { ConventionsExtractor } from './extractor.js';
import { ConventionsRepository } from './repository.js';

function statusOf(row: ConventionRow): ConventionStatus {
  if (row.accepted && !row.rejected) return 'approved';
  if (row.rejected) return 'rejected';
  return 'pending';
}

function isGroundedRow(row: ConventionRow): boolean {
  return Boolean(
    row.evidencePath &&
      row.evidenceLine &&
      row.evidenceLine > 0 &&
      row.evidenceSnippet &&
      row.evidenceRef,
  );
}

export function toConventionDto(row: ConventionRow): ConventionCandidate {
  return {
    id: row.id,
    category: row.category as ConventionCategory,
    rule: row.rule,
    evidence_path: row.evidencePath ?? '',
    evidence_line: row.evidenceLine ?? 1,
    evidence_snippet: row.evidenceSnippet ?? '',
    evidence_ref: row.evidenceRef ?? '',
    confidence: row.confidence ?? 0,
    status: statusOf(row),
    accepted: statusOf(row) === 'approved',
  };
}

function buildSkillBody(repoFullName: string, rows: ConventionRow[]): string {
  const groups = new Map<string, ConventionRow[]>();
  for (const row of rows) {
    const category = row.category ?? 'other';
    groups.set(category, [...(groups.get(category) ?? []), row]);
  }
  const sections = [...groups.entries()].map(([category, candidates]) => {
    const rules = candidates
      .map(
        (candidate) =>
          `- ${candidate.rule}\n  Evidence: \`${candidate.evidencePath}:${candidate.evidenceLine}\``,
      )
      .join('\n');
    return `## ${category}\n\n${rules}`;
  });
  return [
    '# Repository conventions',
    '',
    `Apply these house conventions when reviewing changes in \`${repoFullName}\`. ` +
      'Flag violations and cite the offending file and line.',
    '',
    ...sections,
  ].join('\n');
}

export class ConventionsService {
  private conventions: ConventionsRepository;
  private repos: RepoRepository;
  private skills: SkillsService;
  private extractor: ConventionsExtractor;

  constructor(private container: Container) {
    this.conventions = new ConventionsRepository(container.db);
    this.repos = new RepoRepository(container.db);
    this.skills = new SkillsService(container);
    this.extractor = new ConventionsExtractor(container);
  }

  async list(workspaceId: string, repoId: string): Promise<ConventionCandidate[]> {
    await this.requireRepo(workspaceId, repoId);
    return (await this.conventions.list(workspaceId, repoId))
      .filter(isGroundedRow)
      .map(toConventionDto);
  }

  async extract(workspaceId: string, repoId: string): Promise<ConventionCandidate[]> {
    const repo = await this.requireRepo(workspaceId, repoId);
    if (!repo.clonePath) {
      throw new ValidationError('Repository is not cloned yet. Refresh it and try again.');
    }
    const candidates = await this.extractor.extract({
      workspaceId,
      repoId,
      clonePath: repo.clonePath,
      owner: repo.owner,
      name: repo.name,
    });
    const rows = await this.conventions.replaceAll(workspaceId, repoId, candidates);
    return rows.map(toConventionDto);
  }

  async update(
    workspaceId: string,
    repoId: string,
    conventionId: string,
    patch: UpdateConventionBody,
  ): Promise<ConventionCandidate> {
    await this.requireRepo(workspaceId, repoId);
    const row = await this.conventions.update(workspaceId, repoId, conventionId, patch);
    if (!row) throw new NotFoundError('Convention candidate not found');
    return toConventionDto(row);
  }

  async getSkillDraft(workspaceId: string, repoId: string): Promise<ConventionSkillDraft> {
    const repo = await this.requireRepo(workspaceId, repoId);
    const rows = (await this.conventions.listApproved(workspaceId, repoId)).filter(isGroundedRow);
    if (rows.length === 0) {
      throw new ValidationError('Approve at least one convention before creating a skill.');
    }
    return {
      name: 'repo-conventions',
      description: `House conventions extracted from ${repo.fullName}.`,
      body: buildSkillBody(repo.fullName, rows),
      enabled: true,
      candidate_count: rows.length,
      evidence_files: [
        ...new Set(
          rows
            .map((row) => row.evidencePath)
            .filter((path): path is string => Boolean(path)),
        ),
      ],
    };
  }

  async createSkill(
    workspaceId: string,
    repoId: string,
    input: CreateConventionSkillBody,
  ): Promise<Skill> {
    const draft = await this.getSkillDraft(workspaceId, repoId);
    return this.skills.create(workspaceId, {
      name: input.name,
      description: input.description,
      type: 'convention',
      source: 'extracted',
      body: input.body,
      enabled: input.enabled ?? true,
      evidence_files: draft.evidence_files,
    });
  }

  private async requireRepo(workspaceId: string, repoId: string) {
    const repo = await this.repos.getById(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repo not found');
    return repo;
  }
}
