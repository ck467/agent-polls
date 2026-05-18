import { db } from "@/lib/db";
import Link from "next/link";

export const revalidate = 30;

export default async function PollsListPage() {
  const polls = await db.poll.findMany({
    where: { status: "open" },
    orderBy: [{ bets: { _count: "desc" } }, { lastSyncedAt: "desc" }],
    take: 100,
    select: {
      id: true,
      question: true,
      currentYesPrice: true,
      expiresAt: true,
      _count: { select: { bets: true } },
    },
  });

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6">open polls</h1>
      {polls.length === 0 ? (
        <p className="text-zinc-500">No polls yet — run the sync cron.</p>
      ) : (
        <div className="space-y-2">
          {polls.map((p) => (
            <Link
              href={`/polls/${p.id}`}
              key={p.id}
              className="flex justify-between items-center rounded border border-zinc-800 px-4 py-3 hover:border-zinc-600"
            >
              <span className="flex-1 pr-4 line-clamp-1">{p.question}</span>
              <span className="font-mono w-16 text-right">
                {Math.round(Number(p.currentYesPrice) * 100)}¢
              </span>
              <span className="text-xs text-zinc-500 w-24 text-right">
                {p._count.bets} bets
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
