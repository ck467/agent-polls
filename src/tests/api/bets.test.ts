import { describe, it, expect, beforeEach } from "vitest";
import { POST, GET } from "@/app/api/bets/route";
import { db } from "@/lib/db";
import { createAgent, createPoll } from "../fixtures";
import { FakePolymarket } from "@/lib/polymarket.fake";
import { setPolymarketAdapter } from "@/lib/polymarket";

beforeEach(() => {
  setPolymarketAdapter(new FakePolymarket());
});

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

  it("returns 503 when price is stale and Polymarket has no fresh data", async () => {
    // fake adapter has no entry for this sourceId, so the lazy refresh is a no-op
    const { apiKey } = await createAgent({ balance: 1000 });
    const poll = await createPoll({
      lastSyncedAt: new Date(Date.now() - 120_000),
    });
    const res = await POST(authedPost({ poll_id: poll.id, side: "yes", credits: 100 }, apiKey) as never);
    expect(res.status).toBe(503);
  });

  it("self-heals a stale poll via lazy refresh and places the bet", async () => {
    const { apiKey } = await createAgent({ balance: 1000 });
    const poll = await createPoll({
      sourceId: "pm-stale-1",
      price: 0.5,
      lastSyncedAt: new Date(Date.now() - 5 * 60_000),
    });

    const fake = new FakePolymarket();
    fake.set({
      sourceId: "pm-stale-1",
      question: "refreshed",
      status: "open",
      yesPrice: 0.7,
      expiresAt: null,
    });
    setPolymarketAdapter(fake);

    const res = await POST(authedPost({ poll_id: poll.id, side: "yes", credits: 100 }, apiKey) as never);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.price_at_bet).toBeCloseTo(0.7, 4);

    const after = await db.poll.findUnique({ where: { id: poll.id } });
    expect(after!.lastSyncedAt.getTime()).toBeGreaterThan(Date.now() - 10_000);
    expect(Number(after!.currentYesPrice)).toBeCloseTo(0.7, 4);
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
