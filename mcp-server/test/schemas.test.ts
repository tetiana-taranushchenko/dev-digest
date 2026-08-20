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

describe('devdigest_get_blast_radius keeps repo + pr both required', () => {
  it('neither repo nor pr is optional or defaulted', () => {
    for (const [fieldName, validator] of Object.entries(getBlastRadiusInputSchema)) {
      expect(
        validator._def.typeName === z.ZodFirstPartyTypeKind.ZodOptional ||
          validator._def.typeName === z.ZodFirstPartyTypeKind.ZodDefault,
        `${fieldName} must be required`,
      ).toBe(false);
    }
  });

  it('rejects a call missing pr, and one missing repo', () => {
    expect(getBlastRadiusInputSchema.repo.safeParse(undefined).success).toBe(false);
    expect(getBlastRadiusInputSchema.pr.safeParse(undefined).success).toBe(false);
  });
});

describe('shared field validators are reused across tools, not redefined per tool', () => {
  it('get_blast_radius reuses the exact same repo/pr validator instances', () => {
    expect(getBlastRadiusInputSchema.repo).toBe(repoSchema);
    expect(getBlastRadiusInputSchema.pr).toBe(prSchema);
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

  it('SERVER_INSTRUCTIONS is copied verbatim from the plan', () => {
    expect(SERVER_INSTRUCTIONS).toBe(
      'DevDigest is a local-first AI PR review tool. A repo is identified as ' +
        '"owner/name" (its GitHub full name). A PR is identified by its GitHub ' +
        'number within that repo. An agent is a configured reviewer (a model + ' +
        'system prompt); look one up with devdigest_list_agents. A run is one ' +
        'execution of one agent against one PR, identified by a run_id. A finding ' +
        'is one issue an agent found, with a severity (CRITICAL/WARNING/SUGGESTION), ' +
        'a file, and a line range.',
    );
  });

  it('each of the 5 tool descriptions is exactly one sentence', () => {
    expect(LIST_AGENTS_DESCRIPTION).toBe(
      'List the reviewer agents configured in this DevDigest workspace (id, name, ' +
        'model, enabled) — call this first to get a valid agent id for ' +
        'devdigest_run_agent_on_pr (do not guess or invent one); takes no arguments.',
    );
    expect(RUN_AGENT_ON_PR_DESCRIPTION).toBe(
      'Run one reviewer agent on a pull request and return the result in one call ' +
        '(triggers the review, waits up to ~5 min, and returns the verdict and ' +
        "findings — or, past ~5 min, {status:'still_running', run_id}, in which case " +
        'call devdigest_get_findings with the same pr_id later); Args: pr_id (the ' +
        "PR's internal DevDigest id, NOT the GitHub PR number, e.g. " +
        '"a23e635c-cb87-4230-8bb8-ff3fa63d1c30"), agent_id (an id from ' +
        'devdigest_list_agents — do not guess it).',
    );
    expect(GET_FINDINGS_DESCRIPTION).toBe(
      'Get the latest review verdict and findings for a pull request, grouped by ' +
        'agent — Args: pr_id (the same internal DevDigest id devdigest_run_agent_on_pr ' +
        'takes, e.g. "a23e635c-cb87-4230-8bb8-ff3fa63d1c30"), all_runs (optional ' +
        "boolean, default false, pass true for every run per agent instead of just " +
        "each agent's latest); each entry in the result's reviews array is one " +
        "agent's run ('running' has no findings yet, 'failed'/'cancelled' carries an " +
        "error, 'done' carries verdict/summary/score/findings with id/review_id " +
        'always included for the accept/dismiss endpoints), and if pr_id has no ' +
        'review runs at all the result names devdigest_run_agent_on_pr as the fix.',
    );
    expect(GET_CONVENTIONS_DESCRIPTION).toBe(
      "Get this repository's extracted coding conventions (category, rule, " +
        "evidence_ref, confidence, accepted) to check or justify a finding against " +
        "the repo's house rules — Args: repo_id (the repo's internal DevDigest id, " +
        'e.g. "7da92249-2b69-44ce-b4a5-a1baa62853b1" — not its "owner/name"); if ' +
        'none have been extracted yet, the result points at the Conventions page.',
    );
    expect(GET_BLAST_RADIUS_DESCRIPTION).toBe(
      '⚠️ STUB — not yet implemented, will eventually map which files/symbols a ' +
        "PR's changes affect elsewhere in the repo (reads repo-intel) — Args: repo " +
        "(owner/name), pr (the GitHub PR number), both required so the contract " +
        "won't change later; always returns {status:'not_implemented', ...} with no " +
        'real data, so do not rely on its output.',
    );
  });

  it('the glossary sentence content appears in SERVER_INSTRUCTIONS and in none of the 5 tool descriptions', () => {
    const glossarySentences = [
      'A repo is identified as',
      'A PR is identified by its GitHub',
      'An agent is a configured reviewer',
      'A run is one execution of one agent against one PR',
      'A finding is one issue an agent found',
      'CRITICAL/WARNING/SUGGESTION',
    ];

    for (const sentence of glossarySentences) {
      expect(SERVER_INSTRUCTIONS).toContain(sentence);
    }

    for (const [toolName, description] of Object.entries(toolDescriptions)) {
      for (const sentence of glossarySentences) {
        expect(description, `${toolName} must not repeat the glossary`).not.toContain(sentence);
      }
    }
  });

  it('each description gives usage guidance (a "use this / call this" style clue)', () => {
    const usageGuidancePattern =
      /call this|use this|identify it (either|by)|args:|do not rely|do not guess/i;
    for (const [toolName, description] of Object.entries(toolDescriptions)) {
      expect(description, `${toolName} should state when/how to use it`).toMatch(
        usageGuidancePattern,
      );
    }
  });

  it('each description contains a concrete example or illustrative format hint', () => {
    const examplePattern =
      /e\.g\.|\([a-z_]+\/[a-z_]+\)|\{[^}]*:[^}]*\}|:\s*['"][^'"]+['"]|devdigest_(list_agents|run_agent_on_pr|get_findings|get_conventions|get_blast_radius)/i;
    for (const [toolName, description] of Object.entries(toolDescriptions)) {
      expect(description, `${toolName} should give an example`).toMatch(examplePattern);
    }
  });

  it('every timeout mention is written "~5 min" and the literal string "90" never appears (REQ-7)', () => {
    expect(SERVER_INSTRUCTIONS).not.toContain('90');
    for (const description of Object.values(toolDescriptions)) {
      expect(description).not.toContain('90');
    }
    expect(RUN_AGENT_ON_PR_DESCRIPTION).toContain('~5 min');
  });

  it('each of the 5 tool descriptions is exactly one sentence (a single terminal period, "e.g."/"..." aside)', () => {
    for (const [toolName, description] of Object.entries(toolDescriptions)) {
      const periodCount = description.replace(/e\.g\./g, '').replace(/\.\.\./g, '').split('.').length - 1;
      expect(periodCount, `${toolName} should have exactly one sentence-ending period`).toBe(1);
      expect(description.trim().endsWith('.'), `${toolName} should end with a period`).toBe(true);
    }
  });
});
