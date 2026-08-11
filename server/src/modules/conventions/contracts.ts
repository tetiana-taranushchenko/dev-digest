import { z } from 'zod';
import { ConventionCategory, ConventionStatus } from '@devdigest/shared';

/** Structured output requested from the extraction model. */
export const ConventionExtraction = z.object({
  candidates: z
    .array(
      z.object({
        category: ConventionCategory,
        rule: z.string().trim().min(8).max(500),
        evidence: z.object({
          path: z.string().min(1).max(1_000),
          line: z.number().int().positive(),
        }),
        confidence: z.number().min(0).max(1),
      }),
    )
    .max(24),
});
export type ConventionExtraction = z.infer<typeof ConventionExtraction>;

export const UpdateConventionBody = z
  .object({
    category: ConventionCategory.optional(),
    rule: z.string().trim().min(8).max(500).optional(),
    status: ConventionStatus.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required');
export type UpdateConventionBody = z.infer<typeof UpdateConventionBody>;

export const CreateConventionSkillBody = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500),
  body: z.string().trim().min(1).max(100_000),
  enabled: z.boolean().optional(),
});
export type CreateConventionSkillBody = z.infer<typeof CreateConventionSkillBody>;

export const ConventionSkillDraft = z.object({
  name: z.string(),
  description: z.string(),
  body: z.string(),
  enabled: z.boolean(),
  candidate_count: z.number().int().positive(),
  evidence_files: z.array(z.string()),
});
export type ConventionSkillDraft = z.infer<typeof ConventionSkillDraft>;

