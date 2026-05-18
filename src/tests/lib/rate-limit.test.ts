import { describe, it, expect, beforeEach } from "vitest";
import { rateLimit, resetRateLimitForTests } from "@/lib/rate-limit";

beforeEach(() => resetRateLimitForTests());

describe("rateLimit", () => {
  it("allows up to N hits within the window", () => {
    for (let i = 0; i < 5; i++) {
      expect(rateLimit("k1", { limit: 5, windowMs: 1000 })).toBe(true);
    }
    expect(rateLimit("k1", { limit: 5, windowMs: 1000 })).toBe(false);
  });

  it("isolates keys", () => {
    rateLimit("k1", { limit: 1, windowMs: 1000 });
    expect(rateLimit("k1", { limit: 1, windowMs: 1000 })).toBe(false);
    expect(rateLimit("k2", { limit: 1, windowMs: 1000 })).toBe(true);
  });
});
