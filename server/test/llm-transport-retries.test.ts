import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

/**
 * T1b — `StructuredRequest.transportRetries` must reach `withRetry`'s
 * `retries` option on both `OpenAIProvider.completeStructured` and
 * `AnthropicProvider.completeStructured`'s transport call sites
 * (`server/src/adapters/llm/openai.ts`, `server/src/adapters/llm/
 * anthropic.ts`), and omitting it must leave today's behavior unchanged —
 * `withRetry` receives `retries: undefined`, which its own `opts.retries ??
 * 3` (`server/src/platform/resilience.ts`, unchanged by this task) resolves
 * to the existing default of 3.
 *
 * Intercepting `withRetry` (rather than driving real retries with real
 * timers) is the approach the plan's T1b notes explicitly sanction as an
 * alternative to a fake SDK client assertion.
 */

const capturedRetryOpts: Array<{ retries?: number } | undefined> = [];

vi.mock('../src/platform/resilience.js', () => ({
  withRetry: vi.fn((fn: () => Promise<unknown>, opts?: { retries?: number }) => {
    capturedRetryOpts.push(opts);
    return fn();
  }),
  withTimeout: vi.fn((p: Promise<unknown>) => p),
}));

const openaiCreate = vi.fn();
vi.mock('openai', () => ({
  default: class FakeOpenAI {
    chat = { completions: { create: openaiCreate } };
    models = { list: vi.fn() };
    embeddings = { create: vi.fn() };
  },
}));

const anthropicCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: class FakeAnthropic {
    messages = { create: anthropicCreate };
    models = { list: vi.fn() };
  },
}));

const { OpenAIProvider } = await import('../src/adapters/llm/openai.js');
const { AnthropicProvider } = await import('../src/adapters/llm/anthropic.js');

const schema = z.object({ foo: z.string() });

beforeEach(() => {
  capturedRetryOpts.length = 0;
  openaiCreate.mockReset().mockResolvedValue({
    choices: [{ message: { content: JSON.stringify({ foo: 'bar' }) } }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  });
  anthropicCreate.mockReset().mockResolvedValue({
    content: [{ type: 'tool_use', name: 'Foo', input: { foo: 'bar' } }],
    usage: { input_tokens: 10, output_tokens: 5 },
  });
});

describe('OpenAIProvider.completeStructured transport retries (T1b)', () => {
  it('forwards transportRetries: 0 to withRetry, and omits it (default 3) when unset', async () => {
    const provider = new OpenAIProvider('sk-test');

    await provider.completeStructured({
      model: 'gpt-4.1',
      schema,
      schemaName: 'Foo',
      messages: [{ role: 'user', content: 'hi' }],
      transportRetries: 0,
    });
    expect(capturedRetryOpts.at(-1)).toEqual({ retries: 0 });

    await provider.completeStructured({
      model: 'gpt-4.1',
      schema,
      schemaName: 'Foo',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(capturedRetryOpts.at(-1)).toEqual({ retries: undefined });
  });
});

describe('AnthropicProvider.completeStructured transport retries (T1b)', () => {
  it('forwards transportRetries: 0 to withRetry, and omits it (default 3) when unset', async () => {
    const provider = new AnthropicProvider('sk-test');

    await provider.completeStructured({
      model: 'claude-3-5-sonnet-20241022',
      schema,
      schemaName: 'Foo',
      messages: [{ role: 'user', content: 'hi' }],
      transportRetries: 0,
    });
    expect(capturedRetryOpts.at(-1)).toEqual({ retries: 0 });

    await provider.completeStructured({
      model: 'claude-3-5-sonnet-20241022',
      schema,
      schemaName: 'Foo',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(capturedRetryOpts.at(-1)).toEqual({ retries: undefined });
  });
});
