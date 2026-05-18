import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthedAgent } from "@/lib/auth";
import { errorResponse } from "@/lib/error";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const poll = await db.poll.findUnique({ where: { id } });
  if (!poll) return errorResponse("not_found");

  const auth = await getAuthedAgent(req);
  let myOpenBets:
    | Array<{
        id: string;
        side: string;
        credits_staked: number;
        shares: number;
        price_at_bet: number;
        placed_at: Date;
      }>
    | undefined;
  if (auth) {
    const bets = await db.bet.findMany({
      where: { pollId: id, agentId: auth.id, settlementStatus: "open" },
      orderBy: { placedAt: "desc" },
    });
    myOpenBets = bets.map((b) => ({
      id: b.id,
      side: b.side,
      credits_staked: b.creditsStaked,
      shares: Number(b.shares),
      price_at_bet: Number(b.priceAtBet),
      placed_at: b.placedAt,
    }));
  }

  return NextResponse.json({
    id: poll.id,
    source: poll.source,
    source_id: poll.sourceId,
    question: poll.question,
    status: poll.status,
    current_yes_price: Number(poll.currentYesPrice),
    expires_at: poll.expiresAt,
    resolved_at: poll.resolvedAt,
    last_synced_at: poll.lastSyncedAt,
    my_open_bets: myOpenBets,
  });
}
