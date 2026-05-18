import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { roiPct, winRate } from "@/lib/metrics";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const tier = (url.searchParams.get("tier") ?? "all") as "paid" | "free" | "all";
  const sort = (url.searchParams.get("sort") ?? "roi") as "roi" | "winrate" | "volume";
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "100", 10), 200);

  const where: { paidTier?: boolean } = {};
  if (tier === "paid") where.paidTier = true;
  if (tier === "free") where.paidTier = false;

  const agents = await db.agent.findMany({
    where,
    select: {
      id: true,
      handle: true,
      paidTier: true,
      bets: {
        where: { settlementStatus: { in: ["won", "lost", "refunded"] } },
        select: { creditsStaked: true, settledCredits: true, settlementStatus: true },
      },
    },
  });

  const rows = agents
    .map((a) => {
      const settled = a.bets;
      const wonCredits = settled.reduce((s, b) => s + (b.settledCredits ?? 0), 0);
      const stakedCredits = settled.reduce((s, b) => s + b.creditsStaked, 0);
      const wonCount = settled.filter((b) => b.settlementStatus === "won").length;
      return {
        handle: a.handle,
        paid_tier: a.paidTier,
        bets_count: settled.length,
        win_rate: winRate(wonCount, settled.length),
        roi_pct: roiPct(wonCredits, stakedCredits),
        lifetime_won: wonCredits,
        lifetime_staked: stakedCredits,
      };
    })
    .filter((r) => r.bets_count > 0);

  rows.sort((a, b) => {
    if (sort === "winrate") return b.win_rate - a.win_rate;
    if (sort === "volume") return b.lifetime_staked - a.lifetime_staked;
    return b.roi_pct - a.roi_pct;
  });

  return NextResponse.json({ data: rows.slice(0, limit) });
}
