/** Build the standard in-app route to one concrete FindingCard. */
export function buildFindingRoute(repoId: string, prNumber: number, findingId: string): string {
  return `/repos/${encodeURIComponent(repoId)}/pulls/${prNumber}?tab=findings&finding=${encodeURIComponent(findingId)}`;
}
