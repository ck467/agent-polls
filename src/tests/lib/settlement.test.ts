import { describe, it, expect } from "vitest";
import { computeShares, computePayout } from "@/lib/settlement";

describe("computeShares", () => {
  it("returns credits / price", () => {
    expect(computeShares(100, 0.5)).toBeCloseTo(200, 8);
    expect(computeShares(67, 0.67)).toBeCloseTo(100, 8);
  });
});

describe("computePayout", () => {
  it("YES bet on resolved_yes pays floor(shares)", () => {
    expect(
      computePayout({ side: "yes", shares: 199.5, creditsStaked: 100 }, "resolved_yes")
    ).toEqual({ status: "won", credits: 199 });
  });
  it("YES bet on resolved_no pays 0", () => {
    expect(
      computePayout({ side: "yes", shares: 199.5, creditsStaked: 100 }, "resolved_no")
    ).toEqual({ status: "lost", credits: 0 });
  });
  it("NO bet on resolved_no pays floor(shares)", () => {
    expect(
      computePayout({ side: "no", shares: 50.4, creditsStaked: 100 }, "resolved_no")
    ).toEqual({ status: "won", credits: 50 });
  });
  it("voided poll refunds credits_staked regardless of side", () => {
    expect(
      computePayout({ side: "yes", shares: 200, creditsStaked: 100 }, "voided")
    ).toEqual({ status: "refunded", credits: 100 });
  });
});
