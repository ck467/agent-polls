import { db } from "@/lib/db";
import type { LedgerReason } from "@prisma/client";

export async function applyLedgerEntry(input: {
  agentId: string;
  delta: number;
  reason: LedgerReason;
  relatedBetId?: string | null;
  relatedTopupId?: string | null;
}): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.creditLedger.create({
      data: {
        agentId: input.agentId,
        delta: input.delta,
        reason: input.reason,
        relatedBetId: input.relatedBetId ?? null,
        relatedTopupId: input.relatedTopupId ?? null,
      },
    });
    await tx.agent.update({
      where: { id: input.agentId },
      data: { cachedBalance: { increment: input.delta } },
    });
  });
}

export async function debitForBet(input: {
  agentId: string;
  credits: number;
  betId: string | null;
}): Promise<boolean> {
  if (input.credits <= 0) throw new Error("credits must be positive");

  const updated = await db.agent.updateMany({
    where: { id: input.agentId, cachedBalance: { gte: input.credits } },
    data: { cachedBalance: { decrement: input.credits } },
  });
  if (updated.count === 0) return false;

  await db.creditLedger.create({
    data: {
      agentId: input.agentId,
      delta: -input.credits,
      reason: "bet_placed",
      relatedBetId: input.betId,
    },
  });
  return true;
}
