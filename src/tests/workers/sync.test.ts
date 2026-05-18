import { describe, it, expect, beforeEach } from "vitest";
import { GET } from "@/app/api/cron/sync-polymarket/route";
import { db } from "@/lib/db";
import { FakePolymarket } from "@/lib/polymarket.fake";
import { setPolymarketAdapter } from "@/lib/polymarket";

const SECRET = "test-secret";

function cronReq(): Request {
  return new Request("http://localhost/api/cron/sync-polymarket", {
    headers: { authorization: `Bearer ${SECRET}` },
  });
}

beforeEach(() => {
  process.env.CRON_SECRET = SECRET;
});

describe("sync-polymarket cron", () => {
  it("upserts polls from the adapter", async () => {
    const fake = new FakePolymarket();
    fake.set({
      sourceId: "pm-1",
      question: "Will it rain?",
      status: "open",
      yesPrice: 0.42,
      expiresAt: new Date(Date.now() + 86400000),
    });
    setPolymarketAdapter(fake);

    const res = await GET(cronReq() as never);
    expect(res.status).toBe(200);

    const poll = await db.poll.findUnique({
      where: { source_source_id_unique: { source: "polymarket", sourceId: "pm-1" } },
    });
    expect(poll?.question).toBe("Will it rain?");
    expect(Number(poll?.currentYesPrice)).toBeCloseTo(0.42, 4);
  });

  it("updates price on subsequent sync", async () => {
    const fake = new FakePolymarket();
    fake.set({ sourceId: "pm-1", question: "Q", status: "open", yesPrice: 0.3, expiresAt: null });
    setPolymarketAdapter(fake);
    await GET(cronReq() as never);

    fake.set({ sourceId: "pm-1", question: "Q", status: "open", yesPrice: 0.7, expiresAt: null });
    await GET(cronReq() as never);

    const poll = await db.poll.findUnique({
      where: { source_source_id_unique: { source: "polymarket", sourceId: "pm-1" } },
    });
    expect(Number(poll?.currentYesPrice)).toBeCloseTo(0.7, 4);
  });

  it("flips status to resolved_yes when source reports it", async () => {
    const fake = new FakePolymarket();
    fake.set({ sourceId: "pm-1", question: "Q", status: "open", yesPrice: 0.5, expiresAt: null });
    setPolymarketAdapter(fake);
    await GET(cronReq() as never);

    fake.set({ sourceId: "pm-1", question: "Q", status: "resolved_yes", yesPrice: 1, expiresAt: null });
    await GET(cronReq() as never);

    const poll = await db.poll.findUnique({
      where: { source_source_id_unique: { source: "polymarket", sourceId: "pm-1" } },
    });
    expect(poll?.status).toBe("resolved_yes");
    expect(poll?.resolvedAt).not.toBeNull();
  });

  it("rejects requests without the cron secret", async () => {
    const res = await GET(new Request("http://localhost/api/cron/sync-polymarket") as never);
    expect(res.status).toBe(401);
  });
});
