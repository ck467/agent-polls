import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { agentImpliedYesPrice } from "@/lib/metrics";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? "open";
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10), 100);

  const polls = await db.poll.findMany({
    where: { status: status as never },
    orderBy: { lastSyncedAt: "desc" },
    take: limit,
    select: {
      id: true,
      question: true,
      currentYesPrice: true,
      expiresAt: true,
      _count: { select: { bets: true } },
    },
  });

  const pollIds = polls.map((p) => p.id);
  const openBets = await db.bet.findMany({
    where: { pollId: { in: pollIds }, settlementStatus: "open" },
    select: { pollId: true, side: true, priceAtBet: true, creditsStaked: true },
  });
  const byPoll = new Map<
    string,
    Array<{ side: "yes" | "no"; priceAtBet: number; creditsStaked: number }>
  >();
  for (const b of openBets) {
    const arr = byPoll.get(b.pollId) ?? [];
    arr.push({
      side: b.side,
      priceAtBet: Number(b.priceAtBet),
      creditsStaked: b.creditsStaked,
    });
    byPoll.set(b.pollId, arr);
  }

  return NextResponse.json({
    data: polls.map((p) => ({
      id: p.id,
      question: p.question,
      current_yes_price: Number(p.currentYesPrice),
      agent_implied_yes_price: agentImpliedYesPrice(byPoll.get(p.id) ?? []),
      expires_at: p.expiresAt,
      bet_count: p._count.bets,
    })),
  });
}
