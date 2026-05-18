import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { applyLedgerEntry, debitForBet } from "@/lib/balance";
import { createAgent } from "../fixtures";

describe("applyLedgerEntry", () => {
  it("inserts ledger row and updates cached_balance atomically", async () => {
    const { agent } = await createAgent({ balance: 500 });
    await applyLedgerEntry({ agentId: agent.id, delta: 100, reason: "topup" });
    const after = await db.agent.findUnique({ where: { id: agent.id } });
    expect(after?.cachedBalance).toBe(600);
    const ledger = await db.creditLedger.findMany({ where: { agentId: agent.id } });
    expect(ledger.map((l) => l.delta).reduce((a, b) => a + b, 0)).toBe(600);
  });
});

describe("debitForBet", () => {
  it("succeeds when balance is sufficient", async () => {
    const { agent } = await createAgent({ balance: 200 });
    const ok = await debitForBet({ agentId: agent.id, credits: 100, betId: null });
    expect(ok).toBe(true);
    const after = await db.agent.findUnique({ where: { id: agent.id } });
    expect(after?.cachedBalance).toBe(100);
  });
  it("rejects when balance is insufficient", async () => {
    const { agent } = await createAgent({ balance: 50 });
    const ok = await debitForBet({ agentId: agent.id, credits: 100, betId: null });
    expect(ok).toBe(false);
    const after = await db.agent.findUnique({ where: { id: agent.id } });
    expect(after?.cachedBalance).toBe(50);
  });
  it("survives concurrent debits without going negative", async () => {
    const { agent } = await createAgent({ balance: 100 });
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        debitForBet({ agentId: agent.id, credits: 10, betId: null })
      )
    );
    const successes = results.filter(Boolean).length;
    expect(successes).toBe(10);
    const after = await db.agent.findUnique({ where: { id: agent.id } });
    expect(after?.cachedBalance).toBe(0);
  });
});
