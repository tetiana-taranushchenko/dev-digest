import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { ConflictError, ValidationError } from '../src/platform/errors.js';
import type { ContextDocsFacade } from '../src/modules/context/types.js';
import type { AuthProvider } from '@devdigest/shared';

const workspaceSpy = vi.fn(async () => ({ id: 'workspace-7', name: 'Test' }));
const userSpy = vi.fn(async () => ({ id: 'user-9', email: 'test@example.com', name: 'Test' }));

const auth = {
  currentWorkspace: workspaceSpy,
  currentUser: userSpy,
} as AuthProvider;

const now = '2026-08-29T10:00:00.000Z';
const repoId = '11111111-1111-4111-8111-111111111111';
const createdFile = {
  kind: 'file' as const,
  path: '.devdigest/specs/upload.md',
  file: {
    path: '.devdigest/specs/upload.md',
    content: null,
    size: 4,
    updated_at: now,
    source: 'spec' as const,
    tokens: 1,
    used_by: 0,
  },
};

const facade = {
  listDocuments: vi.fn(async () => ({
    files: [],
    index: { status: 'done' as const, pct: 100, doc_count: 0, refreshed_at: now },
  })),
  reindex: vi.fn(async () => ({ status: 'done' as const, pct: 100, doc_count: 0, refreshed_at: now })),
  readDocument: vi.fn(),
  saveDocument: vi.fn(async () => ({ path: '.devdigest/specs/a.md', size: 1, updated_at: now, tokens: 1, revision: 'new' })),
  createEntry: vi.fn(async (_workspaceId: string, _repoId: string, input: { kind: 'file' | 'folder'; path: string }) => ({ kind: input.kind, path: input.path })),
  uploadDocument: vi.fn(async () => createdFile),
  resolveForAgent: vi.fn(async () => []),
  readBodies: vi.fn(async () => ({ resolved: [], skipped: [] })),
  statBodies: vi.fn(async () => ({ resolved: [], skipped: [] })),
  listAgentPaths: vi.fn(async () => []),
  setAgentPaths: vi.fn(async () => undefined),
  listSkillPaths: vi.fn(async () => []),
  setSkillPaths: vi.fn(async () => undefined),
  countAgentsByPath: vi.fn(async () => new Map()),
} satisfies ContextDocsFacade;

function multipart(filename: string, body: Buffer) {
  const boundary = '----devdigest-test-boundary';
  return {
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: text/markdown\r\n\r\n`),
      body,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  };
}

describe('Project Context write routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test', LOG_LEVEL: 'silent' } as NodeJS.ProcessEnv);
    app = await buildApp({ config, overrides: { auth, contextDocs: facade } });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    facade.uploadDocument.mockResolvedValue(createdFile);
    facade.saveDocument.mockResolvedValue({ path: '.devdigest/specs/a.md', size: 1, updated_at: now, tokens: 1, revision: 'new' });
  });

  afterAll(async () => {
    await app.close();
  });

  it('raises the context-upload transport cap without raising the skill-import cap', async () => {
    const body = Buffer.alloc(300 * 1024, 97);
    const contextUpload = multipart('upload.md', body);
    const contextResponse = await app.inject({
      method: 'POST',
      url: `/repos/${repoId}/context/upload`,
      ...contextUpload,
    });

    expect(contextResponse.statusCode).toBe(200);
    expect(facade.uploadDocument).toHaveBeenCalledWith('workspace-7', repoId, {
      filename: 'upload.md',
      bytes: body,
    });

    const skillUpload = multipart('SKILL.md', body);
    const skillResponse = await app.inject({ method: 'POST', url: '/skills/import/file', ...skillUpload });
    expect(skillResponse.statusCode).toBe(413);
  });

  it('rejects an upload above 400 KB before calling the service', async () => {
    const upload = multipart('too-large.md', Buffer.alloc(401 * 1024, 97));
    const response = await app.inject({ method: 'POST', url: `/repos/${repoId}/context/upload`, ...upload });

    expect(response.statusCode).toBe(413);
    expect(facade.uploadDocument).not.toHaveBeenCalled();
  });

  it('returns a distinguishable 409 for an optimistic-concurrency conflict', async () => {
    facade.saveDocument.mockRejectedValueOnce(new ConflictError('Your copy is out of date.'));
    const response = await app.inject({
      method: 'PUT',
      url: `/repos/${repoId}/context/document`,
      payload: { path: '.devdigest/specs/a.md', content: 'new', expected_revision: 'stale' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: 'conflict' } });
  });

  it('workspace-scopes listing, reading, saving, creation, reindex, and upload', async () => {
    facade.uploadDocument.mockRejectedValueOnce(new ValidationError('Only .md files can be uploaded.'));
    const requests = [
      app.inject({ method: 'GET', url: `/repos/${repoId}/context` }),
      app.inject({ method: 'GET', url: `/repos/${repoId}/context/document?path=docs%2Fa.md` }),
      app.inject({ method: 'PUT', url: `/repos/${repoId}/context/document`, payload: { path: '.devdigest/specs/a.md', content: 'x', expected_revision: 'r' } }),
      app.inject({ method: 'POST', url: `/repos/${repoId}/context/entries`, payload: { kind: 'file', path: 'a.md' } }),
      app.inject({ method: 'POST', url: `/repos/${repoId}/context/reindex` }),
      app.inject({ method: 'POST', url: `/repos/${repoId}/context/upload`, ...multipart('bad.txt', Buffer.from('x')) }),
    ];
    await Promise.all(requests);

    expect(workspaceSpy).toHaveBeenCalledTimes(6);
    expect(userSpy).toHaveBeenCalledTimes(6);
    expect(facade.listDocuments).toHaveBeenCalledWith('workspace-7', repoId);
    expect(facade.saveDocument).toHaveBeenCalledWith('workspace-7', repoId, expect.any(Object));
    expect(facade.createEntry).toHaveBeenCalledWith('workspace-7', repoId, { kind: 'file', path: 'a.md' });
  });
});
