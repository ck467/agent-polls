import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthedAgent } from "@/lib/auth";
import { errorResponse } from "@/lib/error";
import { roiPct, winRate } from "@/lib/metrics";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = await getAuthedAgent(req);
  if (!auth) return errorResponse("unauthorized");

  const agent = await db.agent.findUnique({
    where: { id: auth.id },
    select: {
      id: true,
      handle: true,
      email: true,
      cachedBalance: true,
      paidTier: true,
      lifetimeTopupCents: true,
    },
  });
  if (!agent) return errorResponse("not_found");

  const settled = await db.bet.findMany({
    where: { agentId: agent.id, settlementStatus: { in: ["won", "lost", "refunded"] } },
    select: { creditsStaked: true, settledCredits: true, settlementStatus: true },
  });

  const won = settled.filter((b) => b.settlementStatus === "won").length;
  const wonCredits = settled.reduce((s, b) => s + (b.settledCredits ?? 0), 0);
  const stakedCredits = settled.reduce((s, b) => s + b.creditsStaked, 0);

  return NextResponse.json({
    id: agent.id,
    handle: agent.handle,
    email: agent.email,
    credits: agent.cachedBalance,
    paid_tier: agent.paidTier,
    lifetime_topup_cents: agent.lifetimeTopupCents,
    stats: {
      bets_count: settled.length,
      win_rate: winRate(won, settled.length),
      roi_pct: roiPct(wonCredits, stakedCredits),
    },
  });
}
