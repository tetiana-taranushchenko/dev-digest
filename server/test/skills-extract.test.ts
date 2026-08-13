import { describe, expect, it } from 'vitest';
import { extractFromText } from '../src/modules/skills/extract.js';

describe('skill markdown extraction', () => {
  it('uses name and description from YAML frontmatter and strips it from the body', () => {
    const preview = extractFromText(
      Buffer.from(`---
name: semver-discipline
description: Determine the semantic-version impact of public API changes in pull requests.
---

# Semver Discipline

Classify the externally observable change and verify release metadata.
`),
    );

    expect(preview).toEqual({
      name: 'semver-discipline',
      description: 'Determine the semantic-version impact of public API changes in pull requests.',
      body: '# Semver Discipline\n\nClassify the externally observable change and verify release metadata.',
    });
  });

  it('supports quoted and folded frontmatter descriptions', () => {
    const preview = extractFromText(
      Buffer.from(`---
name: 'response-schema'
description: >-
  Check backward compatibility of public API
  response shapes in pull requests.
---
# Response Schema
Body.
`),
    );

    expect(preview.name).toBe('response-schema');
    expect(preview.description).toBe(
      'Check backward compatibility of public API response shapes in pull requests.',
    );
  });

  it('falls back to the heading and first paragraph without frontmatter', () => {
    const preview = extractFromText(
      Buffer.from('# Review Rule\n\nFlag incompatible response fields.\n\n## Details\nMore text.'),
    );

    expect(preview.name).toBe('Review Rule');
    expect(preview.description).toBe('Flag incompatible response fields.');
  });
});
