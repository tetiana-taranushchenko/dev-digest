import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FetchLike } from '../src/api/client.js';
import { registerGetBlastRadiusTool } from '../src/tools/get-blast-radius.js';
import { getBlastRadiusInputSchema, runAgentOnPrInputSchema } from '../src/schemas.js';
import { GET_BLAST_RADIUS_DESCRIPTION } from '../src/tools/shared-context.js';

interface Harness {
  client: Client;
  server: McpServer;
}

async function setup(): Promise<Harness> {
  const server = new McpServer({ name: 'devdigest-test', version: '0.0.0' });
  registerGetBlastRadiusTool(server, {});

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });

  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

  return { client, server };
}

function parseResultText(result: { content: Array<{ type: string; text?: string }> }): unknown {
  const block = result.content[0];
  expect(block?.type).toBe('text');
  return JSON.parse(block!.text!);
}

describe('devdigest_get_blast_radius', () => {
  let harness: Harness;

  afterEach(async () => {
    await harness?.client.close();
  });

  it('always returns isError:false with a not_implemented stub body, echoing repo/pr, and makes no HTTP call', async () => {
    // A fetch that throws on ANY call — the stub must never invoke it (REQ-14).
    const fetchMock = vi.fn<FetchLike>(async () => {
      throw new Error('devdigest_get_blast_radius must never call fetch');
    });
    harness = await setup();

    const result = await harness.client.callTool({
      name: 'devdigest_get_blast_radius',
      arguments: { repo: 'acme/payments-api', pr: 482 },
    });

    expect(result.isError).toBe(false);
    const body = parseResultText(result as never) as {
      status: string;
      message: string;
      repo: string;
      pr: number;
    };
    expect(body.status).toBe('not_implemented');
    expect(body.repo).toBe('acme/payments-api');
    expect(body.pr).toBe(482);
    expect(body.message.length).toBeGreaterThan(0);

    // No client method / resolver / fetch was ever invoked.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('description states plainly it is not implemented yet', () => {
    expect(GET_BLAST_RADIUS_DESCRIPTION).toMatch(/not.{0,20}implement/i);
  });

  it('is registered with annotations exactly { readOnlyHint: true, destructiveHint: false }', async () => {
    harness = await setup();

    const { tools } = await harness.client.listTools();
    const tool = tools.find((t) => t.name === 'devdigest_get_blast_radius');

    expect(tool).toBeDefined();
    expect(tool!.annotations).toEqual({ readOnlyHint: true, destructiveHint: false });
    expect(tool!.description).toBe(GET_BLAST_RADIUS_DESCRIPTION);
  });

  describe('input schema parity with devdigest_run_agent_on_pr', () => {
    it('repo and pr are the identical validators used by devdigest_run_agent_on_pr, both required in both schemas', () => {
      expect(Object.keys(getBlastRadiusInputSchema).sort()).toEqual(['pr', 'repo']);

      // Both tools' schemas are built from the exact same T6 field validators
      // (`schemas.ts`'s `repoSchema` / `prSchema`), so the two tools' repo/pr
      // fields are literally the same instances — not merely similar.
      expect(getBlastRadiusInputSchema.repo).toBe(runAgentOnPrInputSchema.repo);
      expect(getBlastRadiusInputSchema.pr).toBe(runAgentOnPrInputSchema.pr);

      for (const key of ['repo', 'pr'] as const) {
        const blastField = getBlastRadiusInputSchema[key];
        const runField = runAgentOnPrInputSchema[key];

        // Neither field is optional in either schema.
        expect(blastField.isOptional()).toBe(false);
        expect(runField.isOptional()).toBe(false);
        expect(blastField.safeParse(undefined).success).toBe(false);
        expect(runField.safeParse(undefined).success).toBe(false);
      }

      // Identical parse behaviour on the same fixtures, both valid and invalid.
      expect(getBlastRadiusInputSchema.repo.safeParse('acme/payments-api').success).toBe(true);
      expect(runAgentOnPrInputSchema.repo.safeParse('acme/payments-api').success).toBe(true);
      expect(getBlastRadiusInputSchema.repo.safeParse('not-a-repo').success).toBe(false);
      expect(runAgentOnPrInputSchema.repo.safeParse('not-a-repo').success).toBe(false);

      expect(getBlastRadiusInputSchema.pr.safeParse(482).success).toBe(true);
      expect(runAgentOnPrInputSchema.pr.safeParse(482).success).toBe(true);
      expect(getBlastRadiusInputSchema.pr.safeParse(0).success).toBe(false);
      expect(runAgentOnPrInputSchema.pr.safeParse(0).success).toBe(false);
    });
  });
});
