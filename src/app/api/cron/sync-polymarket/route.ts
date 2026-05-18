import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { errorResponse } from "@/lib/error";
import { getPolymarketAdapter, SourceMarket } from "@/lib/polymarket";

export const runtime = "nodejs";
const TOP_N = 200;

function checkCronAuth(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  return req.headers.get("authorization") === `Bearer ${expected}`;
}

export async function GET(req: NextRequest) {
  if (!checkCronAuth(req)) return errorResponse("unauthorized");

  const adapter = getPolymarketAdapter();
  const active = await adapter.listTopActiveMarkets(TOP_N);
  const seenIds = new Set<string>();

  for (const m of active) {
    seenIds.add(m.sourceId);
    await upsertPoll(m);
  }

  const tracked = await db.poll.findMany({
    where: { source: "polymarket", status: "open" },
    select: { sourceId: true },
  });
  for (const { sourceId } of tracked) {
    if (seenIds.has(sourceId)) continue;
    const m = await adapter.getMarket(sourceId);
    if (m) await upsertPoll(m);
  }

  return NextResponse.json({ ok: true, synced: active.length });
}

async function upsertPoll(m: SourceMarket): Promise<void> {
  const wasResolved = m.status !== "open";
  await db.poll.upsert({
    where: { source_source_id_unique: { source: "polymarket", sourceId: m.sourceId } },
    create: {
      source: "polymarket",
      sourceId: m.sourceId,
      question: m.question,
      status: m.status,
      currentYesPrice: m.yesPrice,
      expiresAt: m.expiresAt ?? null,
      resolvedAt: wasResolved ? new Date() : null,
      lastSyncedAt: new Date(),
    },
    update: {
      question: m.question,
      status: m.status,
      currentYesPrice: m.yesPrice,
      expiresAt: m.expiresAt ?? null,
      resolvedAt: wasResolved ? new Date() : undefined,
      lastSyncedAt: new Date(),
    },
  });
}
