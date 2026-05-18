import { describe, it, expect } from "vitest";
import { POST, GET } from "@/app/api/bets/route";
import { db } from "@/lib/db";
import { createAgent, createPoll } from "../fixtures";

function authedPost(body: unknown, apiKey: string): Request {
  return new Request("http://localhost/api/bets", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
}

describe("POST /api/bets", () => {
  it("places a YES bet at the current mirror price", async () => {
    const { agent, apiKey } = await createAgent({ balance: 500 });
    const poll = await createPoll({ price: 0.5 });
    const res = await POST(authedPost({ poll_id: poll.id, side: "yes", credits: 100 }, apiKey) as never);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.shares).toBeCloseTo(200, 6);
    expect(json.price_at_bet).toBeCloseTo(0.5, 4);
    expect(json.balance_after).toBe(400);

    const after = await db.agent.findUnique({ where: { id: agent.id } });
    expect(after?.cachedBalance).toBe(400);
  });

  it("returns 402 when balance insufficient", async () => {
    const { apiKey } = await createAgent({ balance: 10 });
    const poll = await createPoll({ price: 0.5 });
    const res = await POST(authedPost({ poll_id: poll.id, side: "yes", credits: 100 }, apiKey) as never);
    expect(res.status).toBe(402);
    const json = await res.json();
    expect(json.balance).toBe(10);
  });

  it("returns 409 when poll is not open", async () => {
    const { apiKey } = await createAgent({ balance: 1000 });
    const poll = await createPoll({ status: "resolved_yes" });
    const res = await POST(authedPost({ poll_id: poll.id, side: "yes", credits: 100 }, apiKey) as never);
    expect(res.status).toBe(409);
  });

  it("returns 503 when price is stale", async () => {
    const { apiKey } = await createAgent({ balance: 1000 });
    const poll = await createPoll({
      lastSyncedAt: new Date(Date.now() - 120_000),
    });
    const res = await POST(authedPost({ poll_id: poll.id, side: "yes", credits: 100 }, apiKey) as never);
    expect(res.status).toBe(503);
  });

  it("returns 401 with no auth", async () => {
    const poll = await createPoll();
    const res = await POST(
      new Request("http://localhost/api/bets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ poll_id: poll.id, side: "yes", credits: 100 }),
      }) as never
    );
    expect(res.status).toBe(401);
  });

  it("doesn't double-spend under concurrent bets", async () => {
    const { agent, apiKey } = await createAgent({ balance: 100 });
    const poll = await createPoll({ price: 0.5 });
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        POST(authedPost({ poll_id: poll.id, side: "yes", credits: 10 }, apiKey) as never)
      )
    );
    const ok = results.filter((r) => r.status === 201).length;
    expect(ok).toBe(10);
    const after = await db.agent.findUnique({ where: { id: agent.id } });
    expect(after?.cachedBalance).toBe(0);
  });
});

describe("GET /api/bets", () => {
  it("returns the authed agent's bets", async () => {
    const { agent, apiKey } = await createAgent({ balance: 1000 });
    const poll = await createPoll({ price: 0.5 });
    await db.bet.create({
      data: {
        agentId: agent.id,
        pollId: poll.id,
        side: "yes",
        creditsStaked: 50,
        shares: 100,
        priceAtBet: 0.5,
      },
    });
    const res = await GET(
      new Request("http://localhost/api/bets", {
        headers: { authorization: `Bearer ${apiKey}` },
      }) as never
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toHaveLength(1);
  });
});
