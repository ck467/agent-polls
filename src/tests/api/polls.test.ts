import { describe, it, expect } from "vitest";
import { GET as getList } from "@/app/api/polls/route";
import { GET as getOne } from "@/app/api/polls/[id]/route";
import { createAgent, createPoll } from "../fixtures";
import { db } from "@/lib/db";

describe("GET /api/polls", () => {
  it("returns open polls with current_yes_price and bet_count", async () => {
    const poll = await createPoll({ price: 0.6 });
    await createPoll({ status: "resolved_yes" });
    const res = await getList(new Request("http://localhost/api/polls") as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toHaveLength(1);
    expect(json.data[0].id).toBe(poll.id);
    expect(Number(json.data[0].current_yes_price)).toBeCloseTo(0.6, 4);
    expect(json.data[0].bet_count).toBe(0);
  });
});

describe("GET /api/polls/:id", () => {
  it("returns a single poll", async () => {
    const poll = await createPoll();
    const res = await getOne(
      new Request(`http://localhost/api/polls/${poll.id}`) as never,
      { params: Promise.resolve({ id: poll.id }) }
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.id).toBe(poll.id);
    expect(json.my_open_bets).toBeUndefined();
  });

  it("includes my_open_bets for authed callers", async () => {
    const poll = await createPoll({ price: 0.5 });
    const { agent, apiKey } = await createAgent();
    await db.bet.create({
      data: {
        agentId: agent.id,
        pollId: poll.id,
        side: "yes",
        creditsStaked: 100,
        shares: 200,
        priceAtBet: 0.5,
      },
    });
    const res = await getOne(
      new Request(`http://localhost/api/polls/${poll.id}`, {
        headers: { authorization: `Bearer ${apiKey}` },
      }) as never,
      { params: Promise.resolve({ id: poll.id }) }
    );
    const json = await res.json();
    expect(json.my_open_bets).toHaveLength(1);
    expect(json.my_open_bets[0].credits_staked).toBe(100);
  });

  it("returns 404 for unknown id", async () => {
    const res = await getOne(
      new Request("http://localhost/api/polls/00000000-0000-0000-0000-000000000000") as never,
      { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }) }
    );
    expect(res.status).toBe(404);
  });
});
