/** Read-time cap on the "Prior PRs touching these files" reference list
 *  (REQ-2). Lives in `blast/` because it is this feature's product decision,
 *  and is passed as a parameter into the repository — the same shape as
 *  `getPrCommits(prId, limit)` — so the data-access layer stays policy-free. */
export const MAX_PRIOR_PRS = 5;
