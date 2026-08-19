import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import {
  agentSchema,
  checkFindingsIdentifier,
  getBlastRadiusInputSchema,
  getConventionsInputSchema,
  getFindingsInputSchema,
  listAgentsInputSchema,
  prSchema,
  repoSchema,
  runAgentOnPrInputSchema,
  runIdSchema,
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

  describe('agentSchema', () => {
    it('accepts a non-empty string and rejects an empty one', () => {
      expect(agentSchema.safeParse('code-quality-bot').success).toBe(true);
      expect(agentSchema.safeParse('').success).toBe(false);
    });

    it('rejects a string longer than 200 characters', () => {
      expect(agentSchema.safeParse('a'.repeat(201)).success).toBe(false);
    });
  });

  describe('runIdSchema', () => {
    it('accepts a non-empty string and rejects an empty one', () => {
      expect(runIdSchema.safeParse('run_abc123').success).toBe(true);
      expect(runIdSchema.safeParse('').success).toBe(false);
    });

    it('rejects a string longer than 200 characters', () => {
      expect(runIdSchema.safeParse('a'.repeat(201)).success).toBe(false);
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
  it('run_agent_on_pr, get_conventions and get_blast_radius reuse the exact same repo/pr validator instances', () => {
    expect(runAgentOnPrInputSchema.repo).toBe(repoSchema);
    expect(getConventionsInputSchema.repo).toBe(repoSchema);
    expect(getBlastRadiusInputSchema.repo).toBe(repoSchema);
    expect(runAgentOnPrInputSchema.pr).toBe(prSchema);
    expect(getBlastRadiusInputSchema.pr).toBe(prSchema);
  });

  it("get_findings' optional repo/pr unwrap to the exact same shared validator instances", () => {
    expect(unwrap(getFindingsInputSchema.repo)).toBe(repoSchema);
    expect(unwrap(getFindingsInputSchema.pr)).toBe(prSchema);
  });

  it('get_findings.repo/pr and the required repo/pr share identical parse behaviour on the same fixtures', () => {
    const fixtures = ['acme/payments-api', 'owner/name/extra', '../../etc/passwd', ''];
    for (const fixture of fixtures) {
      expect(getFindingsInputSchema.repo.safeParse(fixture).success).toBe(
        repoSchema.safeParse(fixture).success,
      );
    }
  });
});

describe('devdigest_get_findings input schema', () => {
  it('run_id, repo and pr are all optional at the schema level (REQ-5/REQ-8)', () => {
    expect(getFindingsInputSchema.run_id.safeParse(undefined).success).toBe(true);
    expect(getFindingsInputSchema.repo.safeParse(undefined).success).toBe(true);
    expect(getFindingsInputSchema.pr.safeParse(undefined).success).toBe(true);
  });

  it('response_format defaults to concise and rejects an unknown value', () => {
    expect(getFindingsInputSchema.response_format.parse(undefined)).toBe('concise');
    expect(getFindingsInputSchema.response_format.safeParse('concise').success).toBe(true);
    expect(getFindingsInputSchema.response_format.safeParse('detailed').success).toBe(true);
    expect(getFindingsInputSchema.response_format.safeParse('verbose').success).toBe(false);
  });

  it('offset defaults to 0 and rejects a negative value', () => {
    expect(getFindingsInputSchema.offset.parse(undefined)).toBe(0);
    expect(getFindingsInputSchema.offset.safeParse(-1).success).toBe(false);
  });

  it('limit defaults to 25 and rejects 0 or values above 100', () => {
    expect(getFindingsInputSchema.limit.parse(undefined)).toBe(25);
    expect(getFindingsInputSchema.limit.safeParse(0).success).toBe(false);
    expect(getFindingsInputSchema.limit.safeParse(101).success).toBe(false);
    expect(getFindingsInputSchema.limit.safeParse(100).success).toBe(true);
    expect(getFindingsInputSchema.limit.safeParse(1).success).toBe(true);
  });
});

describe('checkFindingsIdentifier (cross-field guard, REQ-8)', () => {
  it('accepts run_id alone', () => {
    const result = checkFindingsIdentifier({ run_id: 'run_abc123' });
    expect(result).toEqual({ ok: true, mode: 'run_id', run_id: 'run_abc123' });
  });

  it('accepts repo + pr together', () => {
    const result = checkFindingsIdentifier({ repo: 'acme/payments-api', pr: 482 });
    expect(result).toEqual({ ok: true, mode: 'repo_pr', repo: 'acme/payments-api', pr: 482 });
  });

  it('rejects both run_id and repo+pr given, naming both call shapes and that they are mutually exclusive', () => {
    const result = checkFindingsIdentifier({
      run_id: 'run_abc123',
      repo: 'acme/payments-api',
      pr: 482,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/mutually exclusive/i);
      expect(result.message).toMatch(/run_id/);
      expect(result.message).toMatch(/repo/);
      expect(result.message).toMatch(/\bpr\b/);
    }
  });

  it('rejects neither run_id nor repo+pr given, naming both call shapes', () => {
    const result = checkFindingsIdentifier({});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/run_id/);
      expect(result.message).toMatch(/repo/);
      expect(result.message).toMatch(/\bpr\b/);
    }
  });

  it('rejects repo without pr, naming the pairing requirement and the run_id alternative', () => {
    const result = checkFindingsIdentifier({ repo: 'acme/payments-api' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/together/i);
      expect(result.message).toMatch(/run_id/);
    }
  });

  it('rejects pr without repo, naming the pairing requirement and the run_id alternative', () => {
    const result = checkFindingsIdentifier({ pr: 482 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/together/i);
      expect(result.message).toMatch(/run_id/);
    }
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

  it('each of the 5 tool descriptions is copied verbatim from the plan', () => {
    expect(LIST_AGENTS_DESCRIPTION).toBe(
      'List the reviewer agents configured in this DevDigest workspace (id, name, ' +
        'model, enabled). Call this first to get a valid agent id for ' +
        'devdigest_run_agent_on_pr — do not guess or invent agent ids. Takes no ' +
        'arguments.',
    );
    expect(RUN_AGENT_ON_PR_DESCRIPTION).toBe(
      'Run one reviewer agent on a pull request and return the result — this ' +
        'single call triggers the review, waits for it to finish (up to ~2 min), ' +
        'and returns the verdict and findings; you do not need to poll. Args: repo ' +
        '(owner/name, e.g. "acme/payments-api"), pr (the GitHub PR number, e.g. ' +
        '482, not an internal id), agent (an id from devdigest_list_agents — do not ' +
        'guess it). If the review is still running after ~2 min, the result is ' +
        "{status:'still_running', run_id}; call devdigest_get_findings with that " +
        'run_id (or with repo+pr) later.',
    );
    expect(GET_FINDINGS_DESCRIPTION).toBe(
      'Get the verdict and findings of an already-started review run. Identify it ' +
        'either by run_id (returned by devdigest_run_agent_on_pr — prefer this when ' +
        'you have it) or by repo+pr (looks up the most recent run for that PR). ' +
        'Defaults to a concise summary (severity, category, title, file, start_line, ' +
        "end_line, rationale); pass response_format:'detailed' for the full set " +
        '(adds suggestion, confidence, id, review_id — needed to call the ' +
        'accept/dismiss endpoints on one finding). Use offset/limit to page through ' +
        'large result sets (default limit 25). If run_id is unknown, or repo+pr ' +
        'never had a review run, the result names the fix.',
    );
    expect(GET_CONVENTIONS_DESCRIPTION).toBe(
      "Get this repository's extracted coding conventions (category, rule, " +
        'evidence_ref, confidence, accepted). Args: repo (owner/name). Use this to ' +
        "check or justify a finding against the repo's house rules; if none have " +
        'been extracted yet, the result points at the Conventions page.',
    );
    expect(GET_BLAST_RADIUS_DESCRIPTION).toBe(
      '⚠️ STUB — not yet implemented. Will eventually map which files/symbols a ' +
        "PR's changes affect elsewhere in the repo (reads repo-intel). Args: repo, " +
        'pr — same required shape as devdigest_run_agent_on_pr, so the contract ' +
        "won't change later. Always returns {status:'not_implemented', ...} with no " +
        'real data — do not rely on its output.',
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

  it('every timeout mention is written "~2 min" and the literal string "90" never appears (REQ-7)', () => {
    expect(SERVER_INSTRUCTIONS).not.toContain('90');
    for (const description of Object.values(toolDescriptions)) {
      expect(description).not.toContain('90');
    }
    expect(RUN_AGENT_ON_PR_DESCRIPTION).toContain('~2 min');
  });
});
