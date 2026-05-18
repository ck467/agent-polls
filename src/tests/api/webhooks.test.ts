import { describe, it, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/webhooks/stripe/route";
import { db } from "@/lib/db";
import { resetStripeForTests } from "@/lib/stripe";
import { createAgent } from "../fixtures";

const fakeStripe = {
  webhooks: {
    constructEvent: vi.fn(),
  },
};

beforeEach(() => {
  fakeStripe.webhooks.constructEvent.mockReset();
  resetStripeForTests(fakeStripe as never);
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
});

function webhookReq(body: string, sig = "t=1,v1=fake"): Request {
  return new Request("http://localhost/api/webhooks/stripe", {
    method: "POST",
    headers: { "stripe-signature": sig, "content-type": "application/json" },
    body,
  });
}

describe("POST /api/webhooks/stripe", () => {
  it("credits the agent on checkout.session.completed", async () => {
    const { agent } = await createAgent({ balance: 100 });
    await db.topup.create({
      data: {
        agentId: agent.id,
        stripeSessionId: "cs_test_1",
        amountCents: 500,
        creditsDelivered: 1000,
        status: "pending",
      },
    });

    fakeStripe.webhooks.constructEvent.mockReturnValue({
      type: "checkout.session.completed",
      data: { object: { id: "cs_test_1" } },
    });

    const res = await POST(webhookReq("{}") as never);
    expect(res.status).toBe(200);

    const topup = await db.topup.findUnique({ where: { stripeSessionId: "cs_test_1" } });
    expect(topup?.status).toBe("succeeded");

    const after = await db.agent.findUnique({ where: { id: agent.id } });
    expect(after?.cachedBalance).toBe(1100);
    expect(after?.paidTier).toBe(true);
    expect(after?.lifetimeTopupCents).toBe(500);
  });

  it("is idempotent on session_id", async () => {
    const { agent } = await createAgent({ balance: 100 });
    await db.topup.create({
      data: {
        agentId: agent.id,
        stripeSessionId: "cs_test_2",
        amountCents: 500,
        creditsDelivered: 1000,
        status: "pending",
      },
    });
    fakeStripe.webhooks.constructEvent.mockReturnValue({
      type: "checkout.session.completed",
      data: { object: { id: "cs_test_2" } },
    });

    await POST(webhookReq("{}") as never);
    await POST(webhookReq("{}") as never);

    const after = await db.agent.findUnique({ where: { id: agent.id } });
    expect(after?.cachedBalance).toBe(1100);
    expect(after?.lifetimeTopupCents).toBe(500);
  });

  it("rejects unsigned events with 400", async () => {
    fakeStripe.webhooks.constructEvent.mockImplementation(() => {
      throw new Error("bad signature");
    });
    const res = await POST(webhookReq("{}") as never);
    expect(res.status).toBe(400);
  });

  it("returns 200 for unknown session_id", async () => {
    fakeStripe.webhooks.constructEvent.mockReturnValue({
      type: "checkout.session.completed",
      data: { object: { id: "cs_unknown" } },
    });
    const res = await POST(webhookReq("{}") as never);
    expect(res.status).toBe(200);
  });
});
