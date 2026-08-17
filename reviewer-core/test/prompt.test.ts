/**
 * assemblePrompt — PR description slot (the fix that was missing: the PR body
 * never reached the prompt). Pins rendering, omit-when-empty, untrusted-wrap,
 * truncation, and ordering (before the diff).
 */
import { describe, it, expect } from 'vitest';
import { assemblePrompt } from '../src/prompt.js';

function userOf(parts: Parameters<typeof assemblePrompt>[0]): string {
  const { messages } = assemblePrompt(parts);
  return messages[1]!.content;
}

function systemOf(parts: Parameters<typeof assemblePrompt>[0]): string {
  return assemblePrompt(parts).messages[0]!.content;
}

describe('assemblePrompt — shared injection guard (server + CI)', () => {
  const sys = systemOf({ system: 'AGENT-SYS', diff: 'DIFF' });

  it('appends the guard to the agent system prompt', () => {
    expect(sys.startsWith('AGENT-SYS')).toBe(true);
    expect(sys).toMatch(/<untrusted>.*DATA to be analyzed/s);
  });

  it('forbids "intentional/test/demo" claims from descoping the review', () => {
    // The defense that replaced the keyword sanitizer: a general, trusted,
    // language-agnostic rule — not text parsing of untrusted input.
    expect(sys).toMatch(/test fixture|intentional|demo/i);
    expect(sys).toMatch(/never reduce|never .*descope|REPORT it/i);
    expect(sys).toMatch(/any language/i);
  });
});

describe('assemblePrompt — ## PR description', () => {
  it('renders the section (untrusted-wrapped) before the diff when present', () => {
    const { messages, assembly } = assemblePrompt({
      system: 'sys',
      diff: 'DIFF',
      prDescription: 'Adds rate limiting to the public /api endpoints.',
    });
    const user = messages[1]!.content;
    expect(user).toContain('## PR description');
    expect(user).toContain('<untrusted source="pr-description">');
    expect(user).toContain('Adds rate limiting to the public /api endpoints.');
    expect(user.indexOf('## PR description')).toBeLessThan(user.indexOf('## Diff to review'));
    expect(assembly.pr_description).toContain('Adds rate limiting');
  });

  it('omits the section when prDescription is undefined or blank (no behaviour change)', () => {
    expect(userOf({ system: 'sys', diff: 'DIFF' })).not.toContain('## PR description');
    expect(assemblePrompt({ system: 'sys', diff: 'DIFF' }).assembly.pr_description ?? null).toBeNull();
    expect(userOf({ system: 'sys', diff: 'DIFF', prDescription: '   ' })).not.toContain(
      '## PR description',
    );
  });

  it('truncates a huge body to the 4k cap', () => {
    const { assembly } = assemblePrompt({
      system: 'sys',
      diff: 'D',
      prDescription: 'x'.repeat(10_000),
    });
    expect((assembly.pr_description as string).length).toBe(4000);
  });
});

describe('assemblePrompt — safe structured logging metadata', () => {
  it('returns section names, static sources, character counts, and the real prompt total', () => {
    const { assembly, summary } = assemblePrompt({
      system: 'SYSTEM_SECRET',
      diff: 'PRIVATE_DIFF',
      prDescription: 'PRIVATE_DESCRIPTION',
      specs: ['PRIVATE_SPEC'],
      intent: {
        intent: 'PRIVATE_INTENT',
        in_scope: ['one'],
        out_of_scope: ['two'],
        confidence: 'low',
        signals: ['pr_title'],
      },
    });

    const bySection = new Map(summary.sections.map((section) => [section.section, section]));

    expect(bySection.get('system')).toMatchObject({
      source: 'agent system prompt + injection guard',
      chars: assembly.system.length,
    });
    expect(bySection.get('intent')?.chars).toBe(assembly.intent?.length);
    expect(bySection.get('pr_description')?.chars).toBeGreaterThan(
      assembly.pr_description?.length ?? 0,
    );
    expect(bySection.get('diff')).toMatchObject({
      source: 'unified diff',
    });
    expect(bySection.get('diff')?.chars).toBeGreaterThan('PRIVATE_DIFF'.length);
    expect(summary.promptChars).toBe(assembly.system.length + assembly.user.length);
  });

  it('never returns prompt content and omits absent sections', () => {
    const { summary } = assemblePrompt({
      system: 'sk-super-secret',
      diff: 'PRIVATE_DIFF_BODY',
      specs: ['PRIVATE_SPEC_BODY'],
    });

    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain('sk-super-secret');
    expect(serialized).not.toContain('PRIVATE_DIFF_BODY');
    expect(serialized).not.toContain('PRIVATE_SPEC_BODY');
    expect(serialized).not.toContain('pr_description');
    expect(summary.sections.some((section) => section.section === 'diff')).toBe(true);
  });
});
