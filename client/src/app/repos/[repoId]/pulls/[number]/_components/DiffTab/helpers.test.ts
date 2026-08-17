import { describe, expect, it } from "vitest";
import { buildFindingRoute } from "./helpers";

describe("buildFindingRoute", () => {
  it("routes to the exact finding card and encodes dynamic segments", () => {
    expect(buildFindingRoute("repo-1", 42, "finding/2")).toBe(
      "/repos/repo-1/pulls/42?tab=findings&finding=finding%2F2",
    );
  });
});
