import { db } from "@/lib/db";
import { getPolymarketAdapter, type SourceMarket } from "@/lib/polymarket";

export async function upsertOnePoll(m: SourceMarket): Promise<void> {
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

export async function refreshOnePoll(sourceId: string): Promise<boolean> {
  const adapter = getPolymarketAdapter();
  const market = await adapter.getMarket(sourceId);
  if (!market) return false;
  await upsertOnePoll(market);
  return true;
}

export async function syncAllPolls(topN: number): Promise<number> {
  const adapter = getPolymarketAdapter();
  const active = await adapter.listTopActiveMarkets(topN);
  const seenIds = new Set<string>();

  for (const m of active) {
    seenIds.add(m.sourceId);
    await upsertOnePoll(m);
  }

  const tracked = await db.poll.findMany({
    where: { source: "polymarket", status: "open" },
    select: { sourceId: true },
  });
  for (const { sourceId } of tracked) {
    if (seenIds.has(sourceId)) continue;
    const m = await adapter.getMarket(sourceId);
    if (m) await upsertOnePoll(m);
  }

  return active.length;
}
