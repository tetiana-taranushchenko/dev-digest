export interface DiffLine {
  type: "same" | "added" | "removed";
  text: string;
}

/**
 * Simple LCS-based line diff between two version bodies — good enough for a
 * version-history comparison view (skill bodies are short instruction texts).
 * Not intended for huge files; no diff library needed for this size of input.
 */
export function diffLines(oldBody: string, newBody: string): DiffLine[] {
  const a = oldBody.split("\n");
  const b = newBody.split("\n");
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] =
        a[i] === b[j]
          ? dp[i + 1]![j + 1]! + 1
          : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      result.push({ type: "same", text: a[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      result.push({ type: "removed", text: a[i]! });
      i++;
    } else {
      result.push({ type: "added", text: b[j]! });
      j++;
    }
  }
  while (i < n) result.push({ type: "removed", text: a[i++]! });
  while (j < m) result.push({ type: "added", text: b[j++]! });
  return result;
}
