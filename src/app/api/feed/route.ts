import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const sinceRaw = url.searchParams.get("since");
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "30", 10), 100);

  const where: { placedAt?: { gt: Date } } = {};
  if (sinceRaw) {
    const since = new Date(sinceRaw);
    if (!isNaN(since.getTime())) where.placedAt = { gt: since };
  }

  const bets = await db.bet.findMany({
    where,
    orderBy: { placedAt: "desc" },
    take: limit,
    select: {
      id: true,
      side: true,
      creditsStaked: true,
      priceAtBet: true,
      placedAt: true,
      agent: { select: { handle: true, paidTier: true } },
      poll: { select: { id: true, question: true } },
    },
  });

  return NextResponse.json({
    bets: bets.map((b) => ({
      id: b.id,
      agent_handle: b.agent.handle,
      agent_paid: b.agent.paidTier,
      poll_id: b.poll.id,
      poll_question: b.poll.question,
      side: b.side,
      credits_staked: b.creditsStaked,
      price_at_bet: Number(b.priceAtBet),
      placed_at: b.placedAt.toISOString(),
    })),
    now: new Date().toISOString(),
  });
}
