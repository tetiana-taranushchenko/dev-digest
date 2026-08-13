/** Constants for the skills module. */

/** Initial version recorded for a newly-created skill. */
export const INITIAL_SKILL_VERSION = 1;

/** Skill sources that are untrusted until a human explicitly vets them. */
export const UNTRUSTED_SOURCES = ['imported_url', 'community'] as const;
