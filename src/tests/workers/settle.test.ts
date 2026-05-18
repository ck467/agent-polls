import { describe, it, expect, beforeEach } from "vitest";
import { GET } from "@/app/api/cron/settle/route";
import { db } from "@/lib/db";
import { createAgent, createPoll } from "../fixtures";

const SECRET = "test-secret";

function cronReq(): Request {
  return new Request("http://localhost/api/cron/settle", {
    headers: { authorization: `Bearer ${SECRET}` },
  });
}

beforeEach(() => {
  process.env.CRON_SECRET = SECRET;
});

describe("settle cron", () => {
  it("pays YES bets when poll resolves yes", async () => {
    const { agent } = await createAgent({ balance: 0 });
    const poll = await createPoll({ status: "open", price: 0.5 });
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
    await db.poll.update({ where: { id: poll.id }, data: { status: "resolved_yes" } });

    const res = await GET(cronReq() as never);
    expect(res.status).toBe(200);

    const bet = await db.bet.findFirst({ where: { agentId: agent.id } });
    expect(bet?.settlementStatus).toBe("won");
    expect(bet?.settledCredits).toBe(200);

    const after = await db.agent.findUnique({ where: { id: agent.id } });
    expect(after?.cachedBalance).toBe(200);
  });

  it("zeros out losing bets", async () => {
    const { agent } = await createAgent({ balance: 0 });
    const poll = await createPoll({ status: "open" });
    await db.bet.create({
      data: {
        agentId: agent.id,
        pollId: poll.id,
        side: "no",
        creditsStaked: 50,
        shares: 100,
        priceAtBet: 0.5,
      },
    });
    await db.poll.update({ where: { id: poll.id }, data: { status: "resolved_yes" } });

    await GET(cronReq() as never);

    const bet = await db.bet.findFirst({ where: { agentId: agent.id } });
    expect(bet?.settlementStatus).toBe("lost");
    expect(bet?.settledCredits).toBe(0);
  });

  it("refunds on voided polls", async () => {
    const { agent } = await createAgent({ balance: 0 });
    const poll = await createPoll({ status: "open" });
    await db.bet.create({
      data: {
        agentId: agent.id,
        pollId: poll.id,
        side: "yes",
        creditsStaked: 80,
        shares: 160,
        priceAtBet: 0.5,
      },
    });
    await db.poll.update({ where: { id: poll.id }, data: { status: "voided" } });

    await GET(cronReq() as never);

    const bet = await db.bet.findFirst({ where: { agentId: agent.id } });
    expect(bet?.settlementStatus).toBe("refunded");
    expect(bet?.settledCredits).toBe(80);
    const after = await db.agent.findUnique({ where: { id: agent.id } });
    expect(after?.cachedBalance).toBe(80);
  });

  it("is idempotent — second run leaves settled bets untouched", async () => {
    const { agent } = await createAgent({ balance: 0 });
    const poll = await createPoll({ status: "open" });
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
    await db.poll.update({ where: { id: poll.id }, data: { status: "resolved_yes" } });

    await GET(cronReq() as never);
    await GET(cronReq() as never);

    const ledger = await db.creditLedger.findMany({
      where: { agentId: agent.id, reason: "bet_won" },
    });
    expect(ledger).toHaveLength(1);
    const after = await db.agent.findUnique({ where: { id: agent.id } });
    expect(after?.cachedBalance).toBe(200);
  });
});
