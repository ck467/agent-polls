import { describe, it, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/credits/checkout/route";
import { db } from "@/lib/db";
import { resetStripeForTests } from "@/lib/stripe";
import { createAgent } from "../fixtures";

function authedPost(body: unknown, apiKey: string): Request {
  return new Request("http://localhost/api/credits/checkout", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
}

const fakeStripe = {
  checkout: {
    sessions: {
      create: vi.fn(async () => ({
        id: "cs_test_abc123",
        url: "https://checkout.stripe.com/c/cs_test_abc123",
      })),
    },
  },
};

beforeEach(() => {
  fakeStripe.checkout.sessions.create.mockClear();
  resetStripeForTests(fakeStripe as never);
  process.env.APP_URL = "http://localhost:3000";
});

describe("POST /api/credits/checkout", () => {
  it("creates a Stripe session and a pending topup row", async () => {
    const { agent, apiKey } = await createAgent();
    const res = await POST(authedPost({ amount_usd: 5 }, apiKey) as never);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.checkout_url).toContain("checkout.stripe.com");
    expect(json.session_id).toBe("cs_test_abc123");

    const topup = await db.topup.findFirst({ where: { agentId: agent.id } });
    expect(topup?.stripeSessionId).toBe("cs_test_abc123");
    expect(topup?.amountCents).toBe(500);
    expect(topup?.creditsDelivered).toBe(1000);
    expect(topup?.status).toBe("pending");
  });

  it("rejects an invalid tier", async () => {
    const { apiKey } = await createAgent();
    const res = await POST(authedPost({ amount_usd: 7 }, apiKey) as never);
    expect(res.status).toBe(400);
  });

  it("returns 401 with no auth", async () => {
    const res = await POST(
      new Request("http://localhost/api/credits/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amount_usd: 5 }),
      }) as never
    );
    expect(res.status).toBe(401);
  });
});
