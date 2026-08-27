/**
 * Fallback token cap for this component's own tests/standalone usage only.
 * `tokenCap` is a REQUIRED prop on `ContextDocPicker` for real callers — the
 * `ContextListing`/`AttachedContextDoc` contract doesn't expose the server's
 * soft cap yet (docs/plans/project-context.md, T12 note), so real callers
 * (T14/T15/T16) must source the number themselves until it does.
 *
 * Keep in sync with `server/src/modules/context/constants.ts`'s
 * `CONTEXT_TOKEN_CAP` (currently 4000) if that number ever changes.
 */
export const CONTEXT_TOKEN_CAP_FALLBACK = 4000;
