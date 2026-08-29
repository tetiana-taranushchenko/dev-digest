/**
 * T2 — `generateBrief` (reviewer-core/src/brief/classify.ts).
 *
 * `generateBrief` invokes `completeStructured` exactly once AND passes both
 * `maxRetries: 0` and `transportRetries: 0` — together these are what make
 * "exactly one billed generation" actually true (see classify.ts's doc
 * comment), not `maxRetries` alone.
 */
import { describe, it, expect, vi } from 'vitest';
import type { LLMProvider, StructuredRequest, StructuredResult } from '@devdigest/shared';
import { generateBrief } from '../src/brief/classify.js';
import type { BriefPromptSection } from '../src/brief/prompt.js';
import type { BriefClassification } from '../src/brief/schema.js';

const sections: BriefPromptSection[] = [
  { kind: 'pr', name: 'pr', droppable: false, title: 'Add rate limiting', body: 'Adds a limiter.' },
];

function fakeBrief(): BriefClassification {
  return {
    what: 'Adds rate limiting to the public API.',
    why: 'Protects the API from abuse.',
    risk_level: 'low',
    risks: [],
    review_focus: [],
  };
}

function makeProvider(result: StructuredResult<BriefClassification>) {
  const completeStructured = vi.fn().mockResolvedValue(result);
  const provider: LLMProvider = {
    id: 'openrouter',
    listModels: vi.fn(),
    complete: vi.fn(),
    completeStructured,
    embed: vi.fn(),
  };
  return { provider, completeStructured };
}

describe('generateBrief', () => {
  it('invokes completeStructured exactly once, with maxRetries: 0 and transportRetries: 0', async () => {
    const result: StructuredResult<BriefClassification> = {
      data: fakeBrief(),
      model: 'some-model',
      tokensIn: 100,
      tokensOut: 50,
      costUsd: 0.001,
      raw: '{}',
      attempts: 1,
    };
    const { provider, completeStructured } = makeProvider(result);

    const out = await generateBrief({ llm: provider, model: 'some-model', sections });

    expect(completeStructured).toHaveBeenCalledTimes(1);
    const req = completeStructured.mock.calls[0]![0] as StructuredRequest<BriefClassification>;
    expect(req.maxRetries).toBe(0);
    expect(req.transportRetries).toBe(0);
    expect(req.temperature).toBe(0);
    expect(req.model).toBe('some-model');

    expect(out.brief).toEqual(fakeBrief());
    expect(out.tokensIn).toBe(100);
    expect(out.tokensOut).toBe(50);
    expect(out.attempts).toBe(1);
  });

  it('forwards sessionId when provided, and omits it when not', async () => {
    const result: StructuredResult<BriefClassification> = {
      data: fakeBrief(),
      model: 'some-model',
      tokensIn: 10,
      tokensOut: 5,
      costUsd: null,
      raw: '{}',
      attempts: 1,
    };
    const { provider, completeStructured } = makeProvider(result);

    await generateBrief({ llm: provider, model: 'some-model', sections, sessionId: 'sess-1' });
    const reqWith = completeStructured.mock.calls[0]![0] as StructuredRequest<BriefClassification>;
    expect(reqWith.sessionId).toBe('sess-1');

    completeStructured.mockClear();
    await generateBrief({ llm: provider, model: 'some-model', sections });
    const reqWithout = completeStructured.mock.calls[0]![0] as StructuredRequest<BriefClassification>;
    expect(reqWithout.sessionId).toBeUndefined();
  });

  it('passes attempts straight through from StructuredResult.attempts', async () => {
    const result: StructuredResult<BriefClassification> = {
      data: fakeBrief(),
      model: 'some-model',
      tokensIn: 10,
      tokensOut: 5,
      costUsd: null,
      raw: '{}',
      attempts: 3,
    };
    const { provider } = makeProvider(result);

    const out = await generateBrief({ llm: provider, model: 'some-model', sections });
    expect(out.attempts).toBe(3);
  });
});
