import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/platform/config.js';

describe('prompt logging config', () => {
  it('enables verbose prompt metadata only in local development', () => {
    expect(
      loadConfig({ NODE_ENV: 'development', PROMPT_LOG_VERBOSE: '1' }).promptLogVerbose,
    ).toBe(true);
    expect(
      loadConfig({ NODE_ENV: 'production', PROMPT_LOG_VERBOSE: '1' }).promptLogVerbose,
    ).toBe(false);
    expect(loadConfig({ NODE_ENV: 'test', PROMPT_LOG_VERBOSE: '1' }).promptLogVerbose).toBe(
      false,
    );
  });

  it('defaults verbose prompt metadata to off', () => {
    expect(loadConfig({ NODE_ENV: 'development' }).promptLogVerbose).toBe(false);
    expect(
      loadConfig({ NODE_ENV: 'development', PROMPT_LOG_VERBOSE: '' }).promptLogVerbose,
    ).toBe(false);
  });
});
