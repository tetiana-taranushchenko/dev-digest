import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

/**
 * T1b — `OpenRouterProvider` has no `withRetry` wrapper of its own; its
 * transport retry is the OpenAI SDK's per-request `RequestOptions.maxRetries`
 * (the SDK's documented second-argument options form, verified against the
 * installed `openai` package's `chat.completions.create` overload —
 * `create(body, options?: Core.RequestOptions)` — during implementation).
 * This asserts the per-call override is passed through when
 * `transportRetries` is set, that it's absent (falls back to the client's
 * constructor-level default) when unset, and that an unrelated call
 * (`listModels`) is unaffected.
 */

const createMock = vi.fn();
vi.mock('openai', () => ({
  default: class FakeOpenAI {
    chat = { completions: { create: createMock } };
    constructor(_opts: unknown) {}
  },
}));

const { OpenRouterProvider } = await import('../src/llm/openrouter.js');

const schema = z.object({ foo: z.string() });

beforeEach(() => {
  createMock.mockReset().mockResolvedValue({
    choices: [{ message: { content: JSON.stringify({ foo: 'bar' }) } }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  });
});

describe('OpenRouterProvider.completeStructured transport retries (T1b)', () => {
  it('passes a per-call maxRetries override when transportRetries is set', async () => {
    const provider = new OpenRouterProvider('or-test');

    await provider.completeStructured({
      model: 'openrouter/some-model',
      schema,
      schemaName: 'Foo',
      messages: [{ role: 'user', content: 'hi' }],
      transportRetries: 0,
    });

    expect(createMock).toHaveBeenCalledTimes(1);
    const [, options] = createMock.mock.calls[0]!;
    expect(options).toEqual({ maxRetries: 0 });
  });

  it('omits the per-call override when transportRetries is unset, leaving the client default', async () => {
    const provider = new OpenRouterProvider('or-test');

    await provider.completeStructured({
      model: 'openrouter/some-model',
      schema,
      schemaName: 'Foo',
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(createMock).toHaveBeenCalledTimes(1);
    const [, options] = createMock.mock.calls[0]!;
    expect(options).toEqual({ maxRetries: undefined });
  });

  it('does not affect an unrelated completeStructured call scoped to the same provider instance', async () => {
    const provider = new OpenRouterProvider('or-test');

    await provider.completeStructured({
      model: 'openrouter/some-model',
      schema,
      schemaName: 'Foo',
      messages: [{ role: 'user', content: 'first' }],
      transportRetries: 0,
    });
    await provider.completeStructured({
      model: 'openrouter/some-model',
      schema,
      schemaName: 'Foo',
      messages: [{ role: 'user', content: 'second' }],
    });

    expect(createMock).toHaveBeenCalledTimes(2);
    expect(createMock.mock.calls[0]![1]).toEqual({ maxRetries: 0 });
    expect(createMock.mock.calls[1]![1]).toEqual({ maxRetries: undefined });
  });

  it('does not affect an unrelated listModels() call', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const provider = new OpenRouterProvider('or-test');

      await provider.completeStructured({
        model: 'openrouter/some-model',
        schema,
        schemaName: 'Foo',
        messages: [{ role: 'user', content: 'hi' }],
        transportRetries: 0,
      });
      await provider.listModels();

      expect(createMock).toHaveBeenCalledTimes(1); // only from completeStructured
      expect(fetchMock).toHaveBeenCalledTimes(1); // only from listModels
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
