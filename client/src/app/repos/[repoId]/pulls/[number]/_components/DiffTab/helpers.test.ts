import { describe, expect, it } from "vitest";
import { buildFindingRoute, buildFindingsRoute } from "./helpers";

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
