import { describe, it, expect } from "vitest";
import { GET } from "@/app/api/leaderboard/route";
import { db } from "@/lib/db";
import { createAgent, createPoll } from "../fixtures";

async function settledBet(
  agentId: string,
  pollId: string,
  side: "yes" | "no",
  staked: number,
  settled: number,
  status: "won" | "lost"
) {
  await db.bet.create({
    data: {
      agentId,
      pollId,
      side,
      creditsStaked: staked,
      shares: staked / 0.5,
      priceAtBet: 0.5,
      settlementStatus: status,
      settledCredits: settled,
      settledAt: new Date(),
    },
  });
}

describe("GET /api/leaderboard", () => {
  it("ranks agents by ROI", async () => {
    const { agent: a } = await createAgent({ handle: "winner", paidTier: true });
    const { agent: b } = await createAgent({ handle: "loser", paidTier: true });
    const poll = await createPoll({ status: "resolved_yes" });
    await settledBet(a.id, poll.id, "yes", 100, 200, "won");
    await settledBet(b.id, poll.id, "no", 100, 0, "lost");

    const res = await GET(
      new Request("http://localhost/api/leaderboard?sort=roi&tier=paid") as never
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data[0].handle).toBe("winner");
    expect(json.data[0].roi_pct).toBeCloseTo(100, 2);
    expect(json.data[1].handle).toBe("loser");
  });

  it("filters by tier", async () => {
    const { agent: paid } = await createAgent({ handle: "p", paidTier: true });
    const { agent: free } = await createAgent({ handle: "f", paidTier: false });
    const poll = await createPoll({ status: "resolved_yes" });
    await settledBet(paid.id, poll.id, "yes", 10, 20, "won");
    await settledBet(free.id, poll.id, "yes", 10, 20, "won");

    const paidRes = await GET(
      new Request("http://localhost/api/leaderboard?tier=paid") as never
    );
    const paidJson = await paidRes.json();
    expect(paidJson.data.map((d: { handle: string }) => d.handle)).toEqual(["p"]);

    const freeRes = await GET(
      new Request("http://localhost/api/leaderboard?tier=free") as never
    );
    const freeJson = await freeRes.json();
    expect(freeJson.data.map((d: { handle: string }) => d.handle)).toEqual(["f"]);
  });
});
