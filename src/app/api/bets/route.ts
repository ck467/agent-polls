import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getAuthedAgent } from "@/lib/auth";
import { errorResponse } from "@/lib/error";
import { computeShares } from "@/lib/settlement";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
const STALENESS_MS = 60_000;

const Body = z.object({
  poll_id: z.string().uuid(),
  side: z.enum(["yes", "no"]),
  credits: z.number().int().positive().max(1_000_000),
});

type BetResult =
  | { kind: "ok"; bet: { id: string; shares: unknown; priceAtBet: unknown }; balance_after: number }
  | { kind: "not_found" }
  | { kind: "poll_closed" }
  | { kind: "stale_price" }
  | { kind: "insufficient_credits"; balance: number };

export async function POST(req: NextRequest) {
  const auth = await getAuthedAgent(req);
  if (!auth) return errorResponse("unauthorized");

  if (!rateLimit(`bets:${auth.id}`, { limit: 100, windowMs: 60_000 })) {
    return errorResponse("rate_limited");
  }

  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await req.json());
  } catch {
    return errorResponse("bad_request", { detail: "invalid body" });
  }

  try {
    const result: BetResult = await db.$transaction(async (tx) => {
      const poll = await tx.poll.findUnique({ where: { id: parsed.poll_id } });
      if (!poll) return { kind: "not_found" };
      if (poll.status !== "open") return { kind: "poll_closed" };
      if (poll.lastSyncedAt.getTime() < Date.now() - STALENESS_MS) {
        return { kind: "stale_price" };
      }

      const price = Number(poll.currentYesPrice);
      const sidePrice = parsed.side === "yes" ? price : 1 - price;
      const shares = computeShares(parsed.credits, sidePrice);

      const updated = await tx.agent.updateMany({
        where: { id: auth.id, cachedBalance: { gte: parsed.credits } },
        data: { cachedBalance: { decrement: parsed.credits } },
      });
      if (updated.count === 0) {
        const a = await tx.agent.findUnique({
          where: { id: auth.id },
          select: { cachedBalance: true },
        });
        return { kind: "insufficient_credits", balance: a?.cachedBalance ?? 0 };
      }

      const bet = await tx.bet.create({
        data: {
          agentId: auth.id,
          pollId: poll.id,
          side: parsed.side,
          creditsStaked: parsed.credits,
          shares,
          priceAtBet: sidePrice,
        },
      });

      await tx.creditLedger.create({
        data: {
          agentId: auth.id,
          delta: -parsed.credits,
          reason: "bet_placed",
          relatedBetId: bet.id,
        },
      });

      const after = await tx.agent.findUnique({
        where: { id: auth.id },
        select: { cachedBalance: true },
      });
      return { kind: "ok", bet, balance_after: after!.cachedBalance };
    });

    switch (result.kind) {
      case "ok":
        return NextResponse.json(
          {
            bet_id: result.bet.id,
            shares: Number(result.bet.shares),
            price_at_bet: Number(result.bet.priceAtBet),
            balance_after: result.balance_after,
          },
          { status: 201 }
        );
      case "not_found":
        return errorResponse("not_found");
      case "poll_closed":
        return errorResponse("poll_closed");
      case "stale_price":
        return errorResponse("stale_price");
      case "insufficient_credits":
        return errorResponse("insufficient_credits", {
          balance: result.balance,
          needed: parsed.credits,
          checkout_hint: "POST /api/credits/checkout",
        });
    }
  } catch (e) {
    console.error("bet placement failed", e);
    return errorResponse("internal");
  }
}

export async function GET(req: NextRequest) {
  const auth = await getAuthedAgent(req);
  if (!auth) return errorResponse("unauthorized");
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10), 100);

  const where: { agentId: string; settlementStatus?: "open" | { in: Array<"won" | "lost" | "refunded"> } } = {
    agentId: auth.id,
  };
  if (status === "open") where.settlementStatus = "open";
  if (status === "settled") where.settlementStatus = { in: ["won", "lost", "refunded"] };

  const bets = await db.bet.findMany({
    where,
    orderBy: { placedAt: "desc" },
    take: limit,
  });

  return NextResponse.json({
    data: bets.map((b) => ({
      id: b.id,
      poll_id: b.pollId,
      side: b.side,
      credits_staked: b.creditsStaked,
      shares: Number(b.shares),
      price_at_bet: Number(b.priceAtBet),
      placed_at: b.placedAt,
      settlement_status: b.settlementStatus,
      settled_credits: b.settledCredits,
      settled_at: b.settledAt,
    })),
  });
}
