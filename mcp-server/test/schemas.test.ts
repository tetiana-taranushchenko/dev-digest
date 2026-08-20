import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import {
  agentSchema,
  getBlastRadiusInputSchema,
  getConventionsInputSchema,
  getFindingsInputSchema,
  listAgentsInputSchema,
  prIdSchema,
  prSchema,
  repoIdSchema,
  repoSchema,
  runAgentOnPrInputSchema,
} from '../src/schemas.js';
import {
  GET_BLAST_RADIUS_DESCRIPTION,
  GET_CONVENTIONS_DESCRIPTION,
  GET_FINDINGS_DESCRIPTION,
  LIST_AGENTS_DESCRIPTION,
  RUN_AGENT_ON_PR_DESCRIPTION,
  SERVER_INSTRUCTIONS,
} from '../src/tools/shared-context.js';

/** Unwraps ZodOptional/ZodDefault so REQ-5's "no nested object" check inspects the real inner type. */
function unwrap(schema: z.ZodTypeAny): z.ZodTypeAny {
  let current = schema;
  while (
    current._def.typeName === z.ZodFirstPartyTypeKind.ZodOptional ||
    current._def.typeName === z.ZodFirstPartyTypeKind.ZodDefault
  ) {
    current = current._def.innerType;
  }
  return current;
}

const ALL_TOOL_SCHEMAS: Record<string, Record<string, z.ZodTypeAny>> = {
  devdigest_list_agents: listAgentsInputSchema,
  devdigest_run_agent_on_pr: runAgentOnPrInputSchema,
  devdigest_get_findings: getFindingsInputSchema,
  devdigest_get_conventions: getConventionsInputSchema,
  devdigest_get_blast_radius: getBlastRadiusInputSchema,
};

describe('field validators', () => {
  describe('repoSchema', () => {
    it.each([
      ['acme/payments-api', true],
      ['owner/name/extra', false], // extra path segment
      ['../../etc/passwd', false], // path-traversal payload
      ['https://github.com/acme/payments-api', false], // absolute URL
      ['', false], // empty string
      ['owner-only', false], // no slash at all
    ])('repo=%j -> valid=%s', (value, expectValid) => {
      expect(repoSchema.safeParse(value).success).toBe(expectValid);
    });

    it('rejects a repo longer than 200 characters', () => {
      const tooLong = `${'a'.repeat(190)}/${'b'.repeat(20)}`;
      expect(tooLong.length).toBeGreaterThan(200);
      expect(repoSchema.safeParse(tooLong).success).toBe(false);
    });
  });

  describe('prSchema', () => {
    it.each([
      [482, true],
      [1, true],
      [0, false],
      [-1, false],
      [1.5, false],
    ])('pr=%j -> valid=%s', (value, expectValid) => {
      expect(prSchema.safeParse(value).success).toBe(expectValid);
    });
  });

  describe('prIdSchema', () => {
    it('accepts a non-empty string and rejects an empty one', () => {
      expect(prIdSchema.safeParse('a23e635c-cb87-4230-8bb8-ff3fa63d1c30').success).toBe(true);
      expect(prIdSchema.safeParse('').success).toBe(false);
    });

    it('rejects a string longer than 200 characters', () => {
      expect(prIdSchema.safeParse('a'.repeat(201)).success).toBe(false);
    });
  });

  describe('repoIdSchema', () => {
    it('accepts a non-empty string and rejects an empty one', () => {
      expect(repoIdSchema.safeParse('7da92249-2b69-44ce-b4a5-a1baa62853b1').success).toBe(true);
      expect(repoIdSchema.safeParse('').success).toBe(false);
    });

    it('rejects a string longer than 200 characters', () => {
      expect(repoIdSchema.safeParse('a'.repeat(201)).success).toBe(false);
    });
  });

  describe('agentSchema', () => {
    it('accepts a non-empty string and rejects an empty one', () => {
      expect(agentSchema.safeParse('code-quality-bot').success).toBe(true);
      expect(agentSchema.safeParse('').success).toBe(false);
    });

    it('rejects a string longer than 200 characters', () => {
      expect(agentSchema.safeParse('a'.repeat(201)).success).toBe(false);
    });
  });
});

describe('tool input schemas are raw objects of Zod validators (REQ-5)', () => {
  it('none of the 5 exported schemas is a z.object(...) wrapper', () => {
    for (const schema of Object.values(ALL_TOOL_SCHEMAS)) {
      expect(schema).not.toBeInstanceOf(z.ZodType);
      expect(typeof schema).toBe('object');
    }
  });

  it('every field, once unwrapped, is a primitive/enum — never a nested object', () => {
    for (const [toolName, schema] of Object.entries(ALL_TOOL_SCHEMAS)) {
      for (const [fieldName, validator] of Object.entries(schema)) {
        const inner = unwrap(validator);
        expect(
          inner instanceof z.ZodObject || inner instanceof z.ZodArray,
          `${toolName}.${fieldName} must not be a nested object/array`,
        ).toBe(false);
        expect(
          inner instanceof z.ZodString ||
            inner instanceof z.ZodNumber ||
            inner instanceof z.ZodEnum ||
            inner instanceof z.ZodBoolean,
          `${toolName}.${fieldName}'s inner type must be a primitive/enum`,
        ).toBe(true);
      }
    }
  });
});

describe('devdigest_get_blast_radius takes pr_id, required', () => {
  it('pr_id is not optional or defaulted', () => {
    for (const [fieldName, validator] of Object.entries(getBlastRadiusInputSchema)) {
      expect(
        validator._def.typeName === z.ZodFirstPartyTypeKind.ZodOptional ||
          validator._def.typeName === z.ZodFirstPartyTypeKind.ZodDefault,
        `${fieldName} must be required`,
      ).toBe(false);
    }
  });

  it('rejects a call missing pr_id', () => {
    expect(getBlastRadiusInputSchema.pr_id.safeParse(undefined).success).toBe(false);
  });
});

describe('shared field validators are reused across tools, not redefined per tool', () => {
  it('get_blast_radius reuses the exact same prId validator instance', () => {
    expect(getBlastRadiusInputSchema.pr_id).toBe(prIdSchema);
  });

  it('get_conventions reuses the exact same repoId validator instance', () => {
    expect(getConventionsInputSchema.repo_id).toBe(repoIdSchema);
  });

  it('run_agent_on_pr reuses the shared prId/agent validator instances', () => {
    expect(runAgentOnPrInputSchema.pr_id).toBe(prIdSchema);
    expect(runAgentOnPrInputSchema.agent_id).toBe(agentSchema);
  });

  it('get_findings reuses the exact same prId validator instance', () => {
    expect(getFindingsInputSchema.pr_id).toBe(prIdSchema);
  });
});

describe('devdigest_get_findings input schema', () => {
  it('pr_id is required', () => {
    expect(getFindingsInputSchema.pr_id.safeParse(undefined).success).toBe(false);
    expect(getFindingsInputSchema.pr_id.safeParse('a23e635c-cb87-4230-8bb8-ff3fa63d1c30').success).toBe(
      true,
    );
  });

  it('all_runs defaults to false and rejects a non-boolean', () => {
    expect(getFindingsInputSchema.all_runs.parse(undefined)).toBe(false);
    expect(getFindingsInputSchema.all_runs.safeParse(true).success).toBe(true);
    expect(getFindingsInputSchema.all_runs.safeParse('true').success).toBe(false);
  });
});

describe('shared-context.ts (REQ-11)', () => {
  const toolDescriptions = {
    devdigest_list_agents: LIST_AGENTS_DESCRIPTION,
    devdigest_run_agent_on_pr: RUN_AGENT_ON_PR_DESCRIPTION,
    devdigest_get_findings: GET_FINDINGS_DESCRIPTION,
    devdigest_get_conventions: GET_CONVENTIONS_DESCRIPTION,
    devdigest_get_blast_radius: GET_BLAST_RADIUS_DESCRIPTION,
  };

  it('SERVER_INSTRUCTIONS matches the current id-based tool contracts', () => {
    expect(SERVER_INSTRUCTIONS).toBe(
      'DevDigest is a local-first AI PR reviewer. Repositories and pull requests use ' +
        'their internal repo_id and pr_id in tool calls. Use devdigest_list_agents to ' +
        'get valid agent_id values. A finding is a review issue with a severity, file, ' +
        'and line range.',
    );
  });

  it('the 5 tool descriptions match their expected text', () => {
    expect(LIST_AGENTS_DESCRIPTION).toBe(
      'Lists configured reviewer agents and their IDs, models, and enabled status. ' +
        'Use an enabled agent_id with devdigest_run_agent_on_pr.',
    );
    expect(RUN_AGENT_ON_PR_DESCRIPTION).toBe(
      'Runs one reviewer agent on a PR and waits up to ~5 min for its verdict and findings. ' +
        'Requires an internal pr_id (not the GitHub number) and an agent_id from ' +
        'devdigest_list_agents. If still running, retry devdigest_get_findings later ' +
        'with the same pr_id.',
    );
    expect(GET_FINDINGS_DESCRIPTION).toBe(
      'Returns review status, verdict, and findings for a PR, grouped by agent. ' +
        "Requires the PR's internal pr_id; set all_runs=true to include every run " +
        'instead of only the latest per agent.',
    );
    expect(GET_CONVENTIONS_DESCRIPTION).toBe(
      "Returns a repository's extracted coding conventions and supporting evidence. " +
        "Requires the repository's internal repo_id (not owner/name); use this to check " +
        'findings against project rules.',
    );
    expect(GET_BLAST_RADIUS_DESCRIPTION).toBe(
      "Returns a PR's changed symbols and their downstream callers, HTTP endpoints, " +
        'and cron jobs from the persisted repo-intel index. Requires the PR\'s internal ' +
        'pr_id and may return ok, empty, partial, or degraded based on index coverage.',
    );
  });

  it('keeps shared identifiers and finding terminology in the server instructions', () => {
    expect(SERVER_INSTRUCTIONS).toMatch(/internal repo_id and pr_id/);
    expect(SERVER_INSTRUCTIONS).toMatch(/devdigest_list_agents.*agent_id/s);
    expect(SERVER_INSTRUCTIONS).toMatch(/finding.*severity, file.*line range/s);
  });

  it('keeps the non-obvious call contract in each compact description', () => {
    expect(LIST_AGENTS_DESCRIPTION).toMatch(/agent_id.*devdigest_run_agent_on_pr/);
    expect(RUN_AGENT_ON_PR_DESCRIPTION).toMatch(/internal pr_id.*agent_id/s);
    expect(RUN_AGENT_ON_PR_DESCRIPTION).toMatch(/devdigest_get_findings.*same pr_id/s);
    expect(GET_FINDINGS_DESCRIPTION).toMatch(/internal pr_id.*all_runs=true/s);
    expect(GET_CONVENTIONS_DESCRIPTION).toMatch(/internal repo_id \(not owner\/name\)/);
    expect(GET_BLAST_RADIUS_DESCRIPTION).toMatch(/internal pr_id.*ok, empty, partial, or degraded/s);
  });

  it('every timeout mention is written "~5 min" and the literal string "90" never appears (REQ-7)', () => {
    expect(SERVER_INSTRUCTIONS).not.toContain('90');
    for (const description of Object.values(toolDescriptions)) {
      expect(description).not.toContain('90');
    }
    expect(RUN_AGENT_ON_PR_DESCRIPTION).toContain('~5 min');
  });

  it('each of the 5 tool descriptions is written as a few short sentences (not one dense run-on sentence)', () => {
    for (const [toolName, description] of Object.entries(toolDescriptions)) {
      const periodCount = description.replace(/e\.g\./g, '').replace(/\.\.\./g, '').split('.').length - 1;
      expect(periodCount, `${toolName} should have 2-4 sentence-ending periods`).toBeGreaterThanOrEqual(2);
      expect(periodCount, `${toolName} should have 2-4 sentence-ending periods`).toBeLessThanOrEqual(4);
      expect(description.trim().endsWith('.'), `${toolName} should end with a period`).toBe(true);
      expect(description.length, `${toolName} should stay compact`).toBeLessThanOrEqual(260);
    }
  });
});
