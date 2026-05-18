import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { errorResponse } from "@/lib/error";
import { computePayout } from "@/lib/settlement";

export const runtime = "nodejs";

function checkCronAuth(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  return req.headers.get("authorization") === `Bearer ${expected}`;
}

export async function GET(req: NextRequest) {
  if (!checkCronAuth(req)) return errorResponse("unauthorized");

  const pollsToSettle = await db.poll.findMany({
    where: {
      status: { in: ["resolved_yes", "resolved_no", "voided"] },
      bets: { some: { settlementStatus: "open" } },
    },
    select: { id: true, status: true },
  });

  let settledCount = 0;
  for (const poll of pollsToSettle) {
    const openBets = await db.bet.findMany({
      where: { pollId: poll.id, settlementStatus: "open" },
    });
    for (const bet of openBets) {
      const outcome = computePayout(
        {
          side: bet.side,
          shares: Number(bet.shares),
          creditsStaked: bet.creditsStaked,
        },
        poll.status as "resolved_yes" | "resolved_no" | "voided"
      );
      await db.$transaction(async (tx) => {
        await tx.bet.update({
          where: { id: bet.id },
          data: {
            settlementStatus: outcome.status,
            settledCredits: outcome.credits,
            settledAt: new Date(),
          },
        });
        if (outcome.credits > 0) {
          await tx.creditLedger.create({
            data: {
              agentId: bet.agentId,
              delta: outcome.credits,
              reason: outcome.status === "refunded" ? "bet_refunded" : "bet_won",
              relatedBetId: bet.id,
            },
          });
          await tx.agent.update({
            where: { id: bet.agentId },
            data: { cachedBalance: { increment: outcome.credits } },
          });
        }
      });
      settledCount += 1;
    }
  }

  return NextResponse.json({ ok: true, settled: settledCount });
}
