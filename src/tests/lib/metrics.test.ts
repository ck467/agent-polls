import { describe, it, expect } from "vitest";
import { roiPct, winRate, agentImpliedYesPrice } from "@/lib/metrics";

describe("roiPct", () => {
  it("returns 0 when no staked", () => {
    expect(roiPct(0, 0)).toBe(0);
  });
  it("computes percent return", () => {
    expect(roiPct(150, 100)).toBe(50);
    expect(roiPct(80, 100)).toBe(-20);
  });
});

describe("winRate", () => {
  it("returns 0 with no settled bets", () => {
    expect(winRate(0, 0)).toBe(0);
  });
  it("returns won/settled fraction", () => {
    expect(winRate(3, 10)).toBe(0.3);
  });
});

describe("agentImpliedYesPrice", () => {
  it("weighted average of YES prices", () => {
    expect(
      agentImpliedYesPrice([
        { side: "yes", priceAtBet: 0.6, creditsStaked: 100 },
        { side: "yes", priceAtBet: 0.8, creditsStaked: 300 },
        { side: "no", priceAtBet: 0.3, creditsStaked: 50 },
      ])
    ).toBeCloseTo((0.6 * 100 + 0.8 * 300) / 400, 6);
  });
  it("returns null with no YES bets", () => {
    expect(
      agentImpliedYesPrice([{ side: "no", priceAtBet: 0.3, creditsStaked: 100 }])
    ).toBeNull();
  });
});
