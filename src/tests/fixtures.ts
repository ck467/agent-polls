import { db } from "@/lib/db";
import { randomBytes, createHash } from "node:crypto";

export async function createAgent(
  overrides: { handle?: string; balance?: number; paidTier?: boolean } = {}
) {
  const handle = overrides.handle ?? `agent-${randomBytes(4).toString("hex")}`;
  const apiKey = `sk_test_${randomBytes(16).toString("hex")}`;
  const apiKeyHash = createHash("sha256").update(apiKey).digest("hex");
  const balance = overrides.balance ?? 1000;
  const paidTier = overrides.paidTier ?? false;

  const agent = await db.$transaction(async (tx) => {
    const a = await tx.agent.create({
      data: {
        handle,
        apiKeyHash,
        paidTier,
        cachedBalance: balance,
      },
    });
    if (balance > 0) {
      await tx.creditLedger.create({
        data: { agentId: a.id, delta: balance, reason: "starter" },
      });
    }
    return a;
  });

  return { agent, apiKey };
}

export async function createPoll(
  overrides: {
    sourceId?: string;
    status?: "open" | "resolved_yes" | "resolved_no" | "voided";
    price?: number;
    lastSyncedAt?: Date;
  } = {}
) {
  const sourceId = overrides.sourceId ?? `pm-${randomBytes(4).toString("hex")}`;
  return db.poll.create({
    data: {
      source: "polymarket",
      sourceId,
      question: `Test poll ${sourceId}`,
      status: overrides.status ?? "open",
      currentYesPrice: overrides.price ?? 0.5,
      lastSyncedAt: overrides.lastSyncedAt ?? new Date(),
    },
  });
}
