import { AppError } from '../../platform/errors.js';

/**
 * Eval module domain errors (T5). Uses the platform's `AppError` taxonomy —
 * see `../../platform/errors.js` — rather than inventing a parallel one.
 */

/**
 * Thrown by `EvalService`'s private `resolveAgent`/`buildRunConfig` when a
 * `'skill'`-owned eval case has no currently ENABLED agent linked to it to
 * run through (AC-42: `agentsForSkill` doesn't filter by `agents.enabled`
 * itself, so the service must pick the first enabled candidate and fail
 * distinctly when none exists).
 *
 * A distinct code (`eval_owner_unavailable`) and status (422, not the
 * generic `ValidationError`'s wording) so the client can show a specific
 * "Link this skill to an agent to run its evals" hint instead of a toast.
 */
export class EvalOwnerUnavailableError extends AppError {
  constructor(message = 'No enabled agent is linked to this skill', details?: unknown) {
    super('eval_owner_unavailable', message, 422, details);
  }
}
