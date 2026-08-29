import { describe, expect, it } from "vitest";
import { NAV, resolveHref } from "@devdigest/ui";

describe("Project Context navigation", () => {
  it("resolves the sidebar item to the active repository's context route", () => {
    const item = NAV.flatMap((group) => group.items).find(({ key }) => key === "context");

    expect(item?.href).toBe("/repos/:repoId/context");
    expect(resolveHref(item!.href, "repo-42")).toBe("/repos/repo-42/context");
  });
});
