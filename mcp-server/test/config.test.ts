import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('applies defaults on an empty env, with reviewTimeoutMs exactly 120000 (REQ-7)', () => {
    const config = loadConfig({});

    expect(config).toEqual({
      apiBaseUrl: 'http://localhost:3001',
      reviewTimeoutMs: 120_000,
      pollIntervalMs: 2_000,
      resolveTimeoutMs: 20_000,
    });
    expect(config.reviewTimeoutMs).toBe(120_000);
  });

  it('lets API_BASE_URL override the default and normalises a trailing slash away', () => {
    expect(loadConfig({ API_BASE_URL: 'http://example.com:4000' }).apiBaseUrl).toBe(
      'http://example.com:4000',
    );
    expect(loadConfig({ API_BASE_URL: 'http://example.com:4000/' }).apiBaseUrl).toBe(
      'http://example.com:4000',
    );
    expect(loadConfig({ API_BASE_URL: 'http://example.com:4000///' }).apiBaseUrl).toBe(
      'http://example.com:4000',
    );
  });

  it('rejects a non-numeric REVIEW_TIMEOUT_MS with a message naming the variable', () => {
    expect(() => loadConfig({ REVIEW_TIMEOUT_MS: 'not-a-number' })).toThrowError(
      /REVIEW_TIMEOUT_MS/,
    );
  });

  it('rejects a negative REVIEW_TIMEOUT_MS with a message naming the variable', () => {
    expect(() => loadConfig({ REVIEW_TIMEOUT_MS: '-1' })).toThrowError(/REVIEW_TIMEOUT_MS/);
  });

  it('rejects a pollIntervalMs below 1000', () => {
    expect(() => loadConfig({ POLL_INTERVAL_MS: '999' })).toThrowError(/POLL_INTERVAL_MS/);
    expect(() => loadConfig({ POLL_INTERVAL_MS: '0' })).toThrowError(/POLL_INTERVAL_MS/);
  });

  it('accepts a valid pollIntervalMs at the 1000ms floor', () => {
    expect(loadConfig({ POLL_INTERVAL_MS: '1000' }).pollIntervalMs).toBe(1000);
  });

  it('rejects a non-numeric or negative RESOLVE_TIMEOUT_MS with a message naming the variable', () => {
    expect(() => loadConfig({ RESOLVE_TIMEOUT_MS: 'nope' })).toThrowError(/RESOLVE_TIMEOUT_MS/);
    expect(() => loadConfig({ RESOLVE_TIMEOUT_MS: '-5' })).toThrowError(/RESOLVE_TIMEOUT_MS/);
  });

  it('never reads process.env internally — is a pure function of the injected env', () => {
    const originalApiBaseUrl = process.env.API_BASE_URL;
    process.env.API_BASE_URL = 'http://should-not-be-used:9999';
    try {
      const config = loadConfig({});
      expect(config.apiBaseUrl).toBe('http://localhost:3001');
    } finally {
      process.env.API_BASE_URL = originalApiBaseUrl;
    }
  });
});
