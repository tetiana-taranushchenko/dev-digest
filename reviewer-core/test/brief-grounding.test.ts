/**
 * T3 — `groundBriefCitations` (reviewer-core/src/brief/grounding.ts).
 *
 * A separate mechanical gate from `../src/grounding.ts`'s diff-finding gate
 * (do-not-touch, D2) — same "file-membership index, keep/drop with a
 * recorded reason" shape, never imported here.
 */
import { describe, it, expect } from 'vitest';
import { groundBriefCitations, type GroundBriefCitationsAccepted } from '../src/brief/grounding.js';
import type { BriefClassification } from '../src/brief/schema.js';

function baseCandidate(overrides: Partial<BriefClassification> = {}): BriefClassification {
  return {
    what: 'Adds rate limiting to the public API.',
    why: 'Protects the API from abuse.',
    risk_level: 'medium',
    risks: [],
    review_focus: [],
    ...overrides,
  };
}

describe('groundBriefCitations', () => {
  it('keeps a risk citation that references a real changed file', () => {
    const candidate = baseCandidate({
      risks: [
        {
          kind: 'security',
          title: 'Missing rate limit',
          explanation: 'The new endpoint has no throttling.',
          severity: 'high',
          file_refs: ['server/src/modules/pulls/routes.ts'],
        },
      ],
    });
    const accepted: GroundBriefCitationsAccepted = {
      riskFiles: new Set(['server/src/modules/pulls/routes.ts']),
      focusFiles: new Set(['server/src/modules/pulls/routes.ts']),
    };

    const result = groundBriefCitations(candidate, accepted);

    expect(result.kept.risks).toEqual([
      {
        kind: 'security',
        title: 'Missing rate limit',
        explanation: 'The new endpoint has no throttling.',
        severity: 'high',
        file_refs: ['server/src/modules/pulls/routes.ts'],
      },
    ]);
    expect(result.dropped).toEqual([]);
  });

  it('drops a plausible-but-absent citation with a non-empty reason', () => {
    const candidate = baseCandidate({
      risks: [
        {
          kind: 'security',
          title: 'Auth bypass risk',
          explanation: 'A plausible-sounding but hallucinated path.',
          severity: 'medium',
          file_refs: ['server/src/modules/auth/routes.ts', 'server/src/modules/pulls/routes.ts'],
        },
      ],
    });
    const accepted: GroundBriefCitationsAccepted = {
      riskFiles: new Set(['server/src/modules/pulls/routes.ts']),
      focusFiles: new Set(['server/src/modules/pulls/routes.ts']),
    };

    const result = groundBriefCitations(candidate, accepted);

    expect(result.kept.risks).toEqual([
      expect.objectContaining({ file_refs: ['server/src/modules/pulls/routes.ts'] }),
    ]);
    const citationDrop = result.dropped.find((d) => d.kind === 'risk_citation');
    expect(citationDrop).toBeDefined();
    expect(citationDrop!.file).toBe('server/src/modules/auth/routes.ts');
    expect(citationDrop!.reason.length).toBeGreaterThan(0);
  });

  it('drops the whole risk when its only citation drops, recording both a risk_citation and a risk entry', () => {
    const candidate = baseCandidate({
      risks: [
        {
          kind: 'correctness',
          title: 'Off-by-one in pagination',
          explanation: 'Cites a file not present anywhere in the PR.',
          severity: 'low',
          file_refs: ['server/src/modules/nonexistent/file.ts'],
        },
      ],
    });
    const accepted: GroundBriefCitationsAccepted = {
      riskFiles: new Set(['server/src/modules/pulls/routes.ts']),
      focusFiles: new Set(['server/src/modules/pulls/routes.ts']),
    };

    const result = groundBriefCitations(candidate, accepted);

    expect(result.kept.risks).toEqual([]);
    expect(result.dropped).toHaveLength(2);
    expect(result.dropped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'risk_citation',
          label: 'Off-by-one in pagination',
          file: 'server/src/modules/nonexistent/file.ts',
        }),
        expect.objectContaining({
          kind: 'risk',
          label: 'Off-by-one in pagination',
          file: null,
        }),
      ]),
    );
  });

  it('drops a review-focus item citing a blast-radius-downstream file that is not in the PR changed files (AC-14 narrower than AC-13)', () => {
    const candidate = baseCandidate({
      review_focus: [
        { file: 'server/src/modules/downstream/consumer.ts', line: 42, reason: 'Downstream caller of the changed symbol.' },
      ],
    });
    // riskFiles is the broader set (changed files ∪ blast-radius files); the
    // downstream file legitimately belongs there. focusFiles is changed
    // files only, per AC-14 — it must NOT include the downstream file.
    const accepted: GroundBriefCitationsAccepted = {
      riskFiles: new Set(['server/src/modules/pulls/routes.ts', 'server/src/modules/downstream/consumer.ts']),
      focusFiles: new Set(['server/src/modules/pulls/routes.ts']),
    };

    const result = groundBriefCitations(candidate, accepted);

    expect(result.kept.review_focus).toEqual([]);
    expect(result.dropped).toEqual([
      {
        kind: 'review_focus',
        label: 'server/src/modules/downstream/consumer.ts',
        file: 'server/src/modules/downstream/consumer.ts',
        reason: expect.stringMatching(/.+/),
      },
    ]);
  });

  it('returns empty kept arrays without throwing when everything drops', () => {
    const candidate = baseCandidate({
      risks: [
        {
          kind: 'security',
          title: 'Fully hallucinated risk',
          explanation: 'No real citation.',
          severity: 'high',
          file_refs: ['made/up/path.ts'],
        },
      ],
      review_focus: [{ file: 'also/made/up.ts', line: 1, reason: 'Not real.' }],
    });
    const accepted: GroundBriefCitationsAccepted = { riskFiles: new Set(), focusFiles: new Set() };

    expect(() => groundBriefCitations(candidate, accepted)).not.toThrow();
    const result = groundBriefCitations(candidate, accepted);
    expect(result.kept.risks).toEqual([]);
    expect(result.kept.review_focus).toEqual([]);
    expect(result.dropped.length).toBeGreaterThan(0);
  });

  it('keeps a risk with 1 of 3 surviving citations, recording exactly 2 drops', () => {
    const candidate = baseCandidate({
      risks: [
        {
          kind: 'correctness',
          title: 'Partially grounded risk',
          explanation: 'Two hallucinated refs, one real.',
          severity: 'medium',
          file_refs: ['server/src/modules/pulls/routes.ts', 'fake/one.ts', 'fake/two.ts'],
        },
      ],
    });
    const accepted: GroundBriefCitationsAccepted = {
      riskFiles: new Set(['server/src/modules/pulls/routes.ts']),
      focusFiles: new Set(['server/src/modules/pulls/routes.ts']),
    };

    const result = groundBriefCitations(candidate, accepted);

    expect(result.kept.risks).toEqual([
      expect.objectContaining({ file_refs: ['server/src/modules/pulls/routes.ts'] }),
    ]);
    const citationDrops = result.dropped.filter((d) => d.kind === 'risk_citation');
    expect(citationDrops).toHaveLength(2);
    expect(citationDrops.map((d) => d.file).sort()).toEqual(['fake/one.ts', 'fake/two.ts']);
    expect(result.dropped.find((d) => d.kind === 'risk')).toBeUndefined();
  });
});
