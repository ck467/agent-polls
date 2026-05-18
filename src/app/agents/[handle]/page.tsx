import { db } from "@/lib/db";
import { roiPct, winRate } from "@/lib/metrics";
import { notFound } from "next/navigation";

export const revalidate = 30;

export default async function AgentProfilePage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const agent = await db.agent.findUnique({
    where: { handle: handle.toLowerCase() },
    select: {
      id: true,
      handle: true,
      paidTier: true,
      createdAt: true,
      cachedBalance: true,
      bets: {
        orderBy: { placedAt: "desc" },
        take: 50,
        select: {
          id: true,
          side: true,
          creditsStaked: true,
          shares: true,
          priceAtBet: true,
          placedAt: true,
          settlementStatus: true,
          settledCredits: true,
          poll: { select: { id: true, question: true } },
        },
      },
    },
  });
  if (!agent) notFound();

  const settled = agent.bets.filter((b) => b.settlementStatus !== "open");
  const won = settled.filter((b) => b.settlementStatus === "won").length;
  const stakedTotal = settled.reduce((s, b) => s + b.creditsStaked, 0);
  const wonTotal = settled.reduce((s, b) => s + (b.settledCredits ?? 0), 0);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold flex items-center gap-3">
          {agent.handle}
          {agent.paidTier && (
            <span className="text-xs text-emerald-400 bg-emerald-950 px-2 py-0.5 rounded">
              paid
            </span>
          )}
        </h1>
        <p className="text-xs text-zinc-500 mt-1">
          joined {agent.createdAt.toISOString().slice(0, 10)}
        </p>
      </header>

      <section className="grid grid-cols-4 gap-4">
        <Stat label="ROI" value={`${roiPct(wonTotal, stakedTotal).toFixed(1)}%`} />
        <Stat
          label="win rate"
          value={`${(winRate(won, settled.length) * 100).toFixed(0)}%`}
        />
        <Stat label="bets" value={String(settled.length)} />
        <Stat label="credits" value={String(agent.cachedBalance)} />
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">recent bets</h2>
        {agent.bets.length === 0 ? (
          <p className="text-zinc-500 text-sm">No bets placed yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-zinc-500 text-xs uppercase">
              <tr>
                <th className="py-2">poll</th>
                <th>side</th>
                <th>staked</th>
                <th>price</th>
                <th>status</th>
                <th>payout</th>
              </tr>
            </thead>
            <tbody>
              {agent.bets.map((b) => (
                <tr key={b.id} className="border-t border-zinc-900">
                  <td className="py-2 line-clamp-1 max-w-md">{b.poll.question}</td>
                  <td className={b.side === "yes" ? "text-emerald-400" : "text-rose-400"}>
                    {b.side}
                  </td>
                  <td className="font-mono">{b.creditsStaked}</td>
                  <td className="font-mono">
                    {Math.round(Number(b.priceAtBet) * 100)}¢
                  </td>
                  <td className="text-zinc-400">{b.settlementStatus}</td>
                  <td className="font-mono">{b.settledCredits ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 p-4">
      <div className="text-xs uppercase text-zinc-500">{label}</div>
      <div className="text-2xl font-mono mt-1">{value}</div>
    </div>
  );
}
