import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { SkillSource, SkillType } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import { SkillsService } from './service.js';
import { extractFromArchive, extractFromText, ExtractionError } from './extract.js';
import { fetchUrlSafely } from './fetch-url.js';
import { COMMUNITY_CATALOG } from './community-catalog.js';

/** `/skills/:id/versions/:version` — id is a uuid, version a positive integer. */
const VersionParams = z.object({
  id: z.string().uuid(),
  version: z.coerce.number().int().positive(),
});

/** `GET /skills?include=stats` — opt-in compact per-skill stats projection. */
const ListSkillsQuery = z.object({
  include: z.enum(['stats']).optional(),
});

/**
 * A1 — skills module (owner A1).
 *   GET    /skills                        → list (workspace-scoped); ?include=stats
 *                                            attaches a compact {agent_count,
 *                                            pull_frequency, accept_rate} per skill
 *   GET    /skills/:id                    → one skill
 *   POST   /skills                        → create
 *   PUT    /skills/:id                    → update / toggle enabled (versions body changes)
 *   DELETE /skills/:id                    → delete (agent_skills links cascade)
 *   GET    /skills/:id/versions           → body-version history (newest first)
 *   GET    /skills/:id/versions/:version  → one body snapshot
 *   POST   /skills/:id/versions/:version/restore → restore as a new top version
 *   GET    /skills/:id/agents             → agents (in this workspace) using this skill
 *   GET    /skills/:id/stats              → SkillStats (findings/pull-frequency/cost
 *                                            aggregates over agents with this skill attached)
 *   POST   /skills/import/file            → upload a markdown file OR a .zip archive;
 *                                            returns an UNSAVED preview {name, description,
 *                                            body, type, source} — does not persist
 *   POST   /skills/import/url             → server-side fetch (SSRF-guarded) of a
 *                                            markdown URL; same unsaved-preview shape
 *   GET    /skills/community              → search the static community catalog
 *                                            (?q=&lang=&topic=, in-memory filter)
 *   POST   /skills/community/:slug/import → import a catalog entry directly (no
 *                                            preview step — the catalog already has
 *                                            the full body); lands disabled + needs-vetting
 *
 * Import is two-step by design for file/URL: the two routes above only preview
 * extracted content. Saving happens via the existing POST /skills (which
 * already forces enabled:false for untrusted sources) once the user
 * confirms/edits the preview client-side — no separate "confirm" route is
 * needed. Community import skips the preview step since the catalog entry's
 * body is already fully known server-side.
 */

const CreateSkillBody = z.object({
  name: z.string().min(1),
  description: z.string(),
  type: SkillType,
  source: SkillSource,
  body: z.string().min(1),
  enabled: z.boolean().optional(),
  evidence_files: z.array(z.string()).optional(),
});

const UpdateSkillBody = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  type: SkillType.optional(),
  source: SkillSource.optional(),
  body: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  evidence_files: z.array(z.string()).optional(),
  vetted: z.boolean().optional(),
});

const ImportUrlBody = z.object({ url: z.string().url() });

const CommunityQuery = z.object({
  q: z.string().optional(),
  lang: z.string().optional(),
  topic: z.string().optional(),
});

const SlugParams = z.object({ slug: z.string().min(1) });

/** Preview shape returned by the two import routes — not a persisted Skill. */
interface ImportPreview {
  name: string;
  description: string;
  body: string;
  type: 'custom';
  source: 'imported_url';
}

function toImportPreview(extracted: { name: string; description: string; body: string }): ImportPreview {
  // Default type is 'custom' — the user picks a more specific type (rubric/
  // convention/security) when editing the preview before confirming. Both
  // file and URL imports use the 'imported_url' source (the DB enum has no
  // separate "imported_file" value) so they land disabled + needs-vetting,
  // same as any other externally-sourced content.
  return { ...extracted, type: 'custom', source: 'imported_url' };
}

export default async function skillsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new SkillsService(app.container);

  app.get('/skills', { schema: { querystring: ListSkillsQuery } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    if (req.query.include === 'stats') return service.listWithCompactStats(workspaceId);
    return service.list(workspaceId);
  });

  app.get('/skills/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const skill = await service.get(workspaceId, req.params.id);
    if (!skill) throw new NotFoundError('Skill not found');
    return skill;
  });

  app.post('/skills', { schema: { body: CreateSkillBody } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const skill = await service.create(workspaceId, req.body);
    reply.status(201);
    return skill;
  });

  app.put(
    '/skills/:id',
    { schema: { params: IdParams, body: UpdateSkillBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const skill = await service.update(workspaceId, req.params.id, req.body);
      if (!skill) throw new NotFoundError('Skill not found');
      return skill;
    },
  );

  app.delete('/skills/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const ok = await service.delete(workspaceId, req.params.id);
    if (!ok) throw new NotFoundError('Skill not found');
    return { ok: true };
  });

  app.get('/skills/:id/versions', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const versions = await service.listVersions(workspaceId, req.params.id);
    if (!versions) throw new NotFoundError('Skill not found');
    return versions;
  });

  app.get(
    '/skills/:id/versions/:version',
    { schema: { params: VersionParams } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const version = await service.getVersion(workspaceId, req.params.id, req.params.version);
      if (!version) throw new NotFoundError('Skill version not found');
      return version;
    },
  );

  app.post(
    '/skills/:id/versions/:version/restore',
    { schema: { params: VersionParams } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const skill = await service.restoreVersion(workspaceId, req.params.id, req.params.version);
      if (!skill) throw new NotFoundError('Skill or version not found');
      return skill;
    },
  );

  app.get('/skills/:id/agents', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const agents = await service.agentsForSkill(workspaceId, req.params.id);
    if (!agents) throw new NotFoundError('Skill not found');
    return agents;
  });

  app.get('/skills/:id/stats', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const stats = await service.getStats(workspaceId, req.params.id);
    if (!stats) throw new NotFoundError('Skill not found');
    return stats;
  });

  // ---- import (preview only — nothing here persists) -----------------------

  app.post('/skills/import/file', async (req) => {
    const file = await req.file();
    if (!file) throw new ValidationError('No file provided');
    const buf = await file.toBuffer();
    const isArchive = file.filename.toLowerCase().endsWith('.zip');
    try {
      const extracted = isArchive ? extractFromArchive(buf) : extractFromText(buf);
      return toImportPreview(extracted);
    } catch (err) {
      if (err instanceof ExtractionError) throw new ValidationError(err.message);
      throw err;
    }
  });

  app.post('/skills/import/url', { schema: { body: ImportUrlBody } }, async (req) => {
    const buf = await fetchUrlSafely(req.body.url);
    try {
      return toImportPreview(extractFromText(buf));
    } catch (err) {
      if (err instanceof ExtractionError) throw new ValidationError(err.message);
      throw err;
    }
  });

  // ---- community catalog (static fixture — no live search/crawling) -------

  app.get('/skills/community', { schema: { querystring: CommunityQuery } }, async (req) => {
    const { q, lang, topic } = req.query;
    const needle = q?.trim().toLowerCase();
    return COMMUNITY_CATALOG.filter((entry) => {
      if (needle && !`${entry.name} ${entry.desc}`.toLowerCase().includes(needle)) return false;
      if (lang && lang !== 'any' && entry.lang !== lang) return false;
      if (topic && !entry.topics.includes(topic)) return false;
      return true;
    });
  });

  app.post(
    '/skills/community/:slug/import',
    { schema: { params: SlugParams } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const entry = COMMUNITY_CATALOG.find((e) => e.slug === req.params.slug);
      if (!entry) throw new NotFoundError('Community skill not found');
      const skill = await service.create(workspaceId, {
        name: entry.name,
        description: entry.desc,
        type: entry.type,
        source: 'community',
        body: entry.body,
      });
      reply.status(201);
      return skill;
    },
  );
}
