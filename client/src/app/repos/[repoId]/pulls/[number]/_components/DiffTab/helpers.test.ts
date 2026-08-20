import { describe, expect, it } from "vitest";
import { buildDiffLineRoute, buildFindingRoute, buildFindingsRoute } from "./helpers";

describe("buildFindingRoute", () => {
  it("routes to the exact finding card and encodes dynamic segments", () => {
    expect(buildFindingRoute("repo-1", 42, "finding/2")).toBe(
      "/repos/repo-1/pulls/42?tab=findings&finding=finding%2F2",
    );
  });
});

describe("buildFindingsRoute", () => {
  it("keeps the Agent runs tab active after consuming a finding target", () => {
    expect(buildFindingsRoute("repo/1", 42)).toBe(
      "/repos/repo%2F1/pulls/42?tab=findings",
    );
  });
});

describe("buildDiffLineRoute", () => {
  it("routes to the Diff tab scrolled to the exact file:line and encodes dynamic segments", () => {
    expect(buildDiffLineRoute("repo-1", 42, "src/example.ts", 17)).toBe(
      "/repos/repo-1/pulls/42?tab=diff&file=src%2Fexample.ts&line=17",
    );
  });
});
