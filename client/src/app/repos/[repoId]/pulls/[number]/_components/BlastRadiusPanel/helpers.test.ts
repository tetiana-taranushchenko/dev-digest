import { describe, expect, it } from "vitest";
import type { PrFile } from "@devdigest/shared";
import { formatPriorPrAge, reasonMessageKey, resolveCallerDestination } from "./helpers";

const CALLER = { name: "callSite", file: "src/other.ts", line: 42 };

/** A patch whose only hunk covers new-side lines 59-65 (starts at new line 59,
 *  two replaced lines, five lines of context) — realistic shape per
 *  `parsePatch`'s expected unified-diff format. Line 42 is NOT covered. */
const OTHER_FILE_PATCH = [
  "@@ -59,7 +59,8 @@",
  " context line 59",
  " context line 60",
  "-old line 61",
  "+new line 61",
  "+new line 62",
  " context line 63",
  " context line 64",
  " context line 65",
].join("\n");

describe("resolveCallerDestination", () => {
  it("routes in-app to the exact diff line when the caller's file is part of the PR and the line is covered by a hunk", () => {
    const files: PrFile[] = [
      { path: "src/other.ts", additions: 1, deletions: 0, patch: "@@ -42,1 +42,1 @@\n-old\n+new at line 42" },
      { path: "src/example.ts", additions: 0, deletions: 0, patch: null },
    ];

    const destination = resolveCallerDestination({
      caller: CALLER,
      files,
      repoId: "repo-1",
      prNumber: 42,
      repoFullName: "acme/widgets",
      headSha: "abc123",
    });

    expect(destination).toEqual({
      kind: "in-app",
      route: "/repos/repo-1/pulls/42?tab=diff&file=src%2Fother.ts&line=42",
    });
  });

  it("falls back to the GitHub blob link when the caller's file is outside the PR's diff", () => {
    const files: PrFile[] = [{ path: "src/example.ts", additions: 1, deletions: 0, patch: "@@ -1,1 +1,1 @@\n+x" }];

    const destination = resolveCallerDestination({
      caller: CALLER,
      files,
      repoId: "repo-1",
      prNumber: 42,
      repoFullName: "acme/widgets",
      headSha: "abc123",
    });

    expect(destination).toEqual({
      kind: "external",
      url: "https://github.com/acme/widgets/blob/abc123/src/other.ts#L42",
    });
  });

  it("falls back to the GitHub blob link when the caller's file is in the PR's diff but its target line isn't covered by any rendered hunk", () => {
    // Reproduces the manually-found bug: server/src/modules/agents/service.ts:55
    // was part of the PR's changed files, but the PR's diff for that file only
    // touched a hunk around lines 59-66 — line 55 has no data-diff-line
    // element, so it must route externally instead of attempting an in-app scroll.
    const files: PrFile[] = [{ path: "src/other.ts", additions: 2, deletions: 1, patch: OTHER_FILE_PATCH }];
    const caller = { name: "callSite", file: "src/other.ts", line: 55 };

    const destination = resolveCallerDestination({
      caller,
      files,
      repoId: "repo-1",
      prNumber: 42,
      repoFullName: "acme/widgets",
      headSha: "abc123",
    });

    expect(destination).toEqual({
      kind: "external",
      url: "https://github.com/acme/widgets/blob/abc123/src/other.ts#L55",
    });
  });

  it("returns a null external url when repo context is unavailable", () => {
    const destination = resolveCallerDestination({
      caller: CALLER,
      files: [],
      repoId: "repo-1",
      prNumber: 42,
      repoFullName: null,
      headSha: null,
    });

    expect(destination).toEqual({ kind: "external", url: null });
  });
});

describe("reasonMessageKey", () => {
  it("maps a known machine reason to its i18n key", () => {
    expect(reasonMessageKey("index_partial")).toBe("reason.index_partial");
  });

  it("falls back to null for an unrecognized reason so callers use reason_text", () => {
    expect(reasonMessageKey("something_new")).toBeNull();
    expect(reasonMessageKey(null)).toBeNull();
    expect(reasonMessageKey(undefined)).toBeNull();
  });
});

describe("formatPriorPrAge", () => {
  // Fixed reference instant so every bucket below is pinned deterministically.
  const NOW = Date.parse("2026-06-15T12:00:00.000Z");

  /** Builds an ISO timestamp `msAgo` milliseconds before `NOW`. */
  const isoAgo = (msAgo: number) => new Date(NOW - msAgo).toISOString();

  it("returns the em-dash placeholder for null, undefined, and unparseable input", () => {
    expect(formatPriorPrAge(null, NOW)).toBe("—");
    expect(formatPriorPrAge(undefined, NOW)).toBe("—");
    expect(formatPriorPrAge("not-a-date", NOW)).toBe("—");
  });

  it("clamps future timestamps (clock skew) to the 'now' bucket instead of going negative", () => {
    expect(formatPriorPrAge(isoAgo(-5 * 60 * 1000), NOW)).toBe("now");
  });

  it("renders 'now' for elapsed time under one minute", () => {
    expect(formatPriorPrAge(isoAgo(30 * 1000), NOW)).toBe("now");
  });

  it("renders the minute bucket for elapsed time under one hour", () => {
    expect(formatPriorPrAge(isoAgo(45 * 60 * 1000), NOW)).toBe("45m ago");
  });

  it("renders the hour bucket for elapsed time under one day", () => {
    expect(formatPriorPrAge(isoAgo(5 * 60 * 60 * 1000), NOW)).toBe("5h ago");
  });

  it("renders the day bucket for elapsed time under 30 days, flooring rather than rounding", () => {
    // 11.8 days elapsed must read "11d ago", never "12d ago".
    const elevenPointEightDaysMs = 11.8 * 24 * 60 * 60 * 1000;
    expect(formatPriorPrAge(isoAgo(elevenPointEightDaysMs), NOW)).toBe("11d ago");
  });

  it("renders the month bucket (30-day months) for elapsed time under 365 days", () => {
    const sixtyFiveDaysMs = 65 * 24 * 60 * 60 * 1000;
    expect(formatPriorPrAge(isoAgo(sixtyFiveDaysMs), NOW)).toBe("2mo ago");
  });

  it("renders the year bucket (365-day years) for elapsed time at or beyond 365 days", () => {
    const fourHundredDaysMs = 400 * 24 * 60 * 60 * 1000;
    expect(formatPriorPrAge(isoAgo(fourHundredDaysMs), NOW)).toBe("1y ago");
  });
});
