import { describe, expect, it } from "vitest";
import { NODE_RADIUS, VIEWBOX } from "./constants";
import { clampToViewBox } from "./useForceLayout";

describe("clampToViewBox", () => {
  it("keeps finite and invalid coordinates inside kind-aware visible bounds", () => {
    const clampedLeft = clampToViewBox({
      kind: "symbol",
      x: -100,
      y: Number.POSITIVE_INFINITY,
    });
    const clampedRight = clampToViewBox({
      kind: "caller",
      x: VIEWBOX.width + 100,
      y: -5,
    });

    expect(clampedLeft.x).toBeGreaterThanOrEqual(NODE_RADIUS.symbol);
    expect(clampedLeft.y).toBe(VIEWBOX.height / 2);
    expect(clampedRight.x).toBeLessThanOrEqual(VIEWBOX.width - NODE_RADIUS.caller);
    expect(clampedRight.y).toBeGreaterThanOrEqual(NODE_RADIUS.caller);
  });
});
