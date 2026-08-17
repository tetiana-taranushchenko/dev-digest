import { describe, expect, it, vi } from 'vitest';
import { assemblePrompt, type PromptAssemblyEvent } from '@devdigest/reviewer-core';
import { logPromptAssembly } from '../src/modules/reviews/prompt-logging.js';

function event(): PromptAssemblyEvent {
  return {
    callIndex: 2,
    callCount: 4,
    mode: 'map-reduce',
    scope: 'file',
    summary: {
      promptChars: 6118,
      sections: [
        { section: 'system', source: 'agent system prompt + injection guard', chars: 1200 },
        { section: 'specs', source: 'project specifications', chars: 300 },
        { section: 'diff', source: 'unified diff', chars: 4500 },
      ],
    },
  };
}

describe('logPromptAssembly', () => {
  it('logs the production payload with model, correlation id, call metadata, and diff size', () => {
    const info = vi.fn();

    logPromptAssembly(
      { info },
      { runId: 'run-123', model: 'provider/model', verbose: false, event: event() },
    );

    expect(info).toHaveBeenCalledOnce();
    expect(info).toHaveBeenCalledWith(
      {
        event: 'prompt_assembly',
        correlationId: 'run-123',
        runId: 'run-123',
        model: 'provider/model',
        callIndex: 2,
        callCount: 4,
        mode: 'map-reduce',
        scope: 'file',
        sectionCount: 3,
        promptChars: 6118,
        diffChars: 4500,
      },
      'prompt assembly 2/4: 3 section(s), 6118 char(s) total, 4500 diff char(s)',
    );
  });

  it('adds section metrics only in verbose mode and never logs private content', () => {
    const info = vi.fn();
    const promptEvent: PromptAssemblyEvent = {
      ...event(),
      summary: assemblePrompt({
        system: 'sk-super-secret',
        diff: 'PRIVATE_DIFF_BODY',
        specs: ['PRIVATE_SPEC_BODY'],
      }).summary,
    };

    logPromptAssembly(
      { info },
      { runId: 'run-123', model: 'provider/model', verbose: true, event: promptEvent },
    );

    const serialized = JSON.stringify(info.mock.calls);
    expect(info.mock.calls[0]?.[0]).toMatchObject({ sections: promptEvent.summary.sections });
    expect(serialized).not.toContain('PRIVATE_DIFF_BODY');
    expect(serialized).not.toContain('PRIVATE_SPEC_BODY');
    expect(serialized).not.toContain('sk-super-secret');
  });
});
