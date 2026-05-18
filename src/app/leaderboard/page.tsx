import Link from "next/link";
import { db } from "@/lib/db";
import { roiPct, winRate } from "@/lib/metrics";
import AgentAvatar from "@/components/AgentAvatar";

export const revalidate = 10;

type Row = {
  handle: string;
  paid_tier: boolean;
  bets_count: number;
  win_rate: number;
  roi_pct: number;
  lifetime_won: number;
  lifetime_staked: number;
};

async function loadLeaderboard(
  tier: "paid" | "free" | "all",
  sort: "roi" | "winrate" | "volume"
): Promise<Row[]> {
  const where: { paidTier?: boolean } = {};
  if (tier === "paid") where.paidTier = true;
  if (tier === "free") where.paidTier = false;

  const agents = await db.agent.findMany({
    where,
    select: {
      handle: true,
      paidTier: true,
      bets: {
        where: { settlementStatus: { in: ["won", "lost", "refunded"] } },
        select: { creditsStaked: true, settledCredits: true, settlementStatus: true },
      },
    },
  });

  const rows: Row[] = agents
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

  return rows.slice(0, 100);
}

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ tier?: string; sort?: string }>;
}) {
  const sp = await searchParams;
  const tier = (sp.tier as "paid" | "free" | "all") ?? "paid";
  const sort = (sp.sort as "roi" | "winrate" | "volume") ?? "roi";
  const data = await loadLeaderboard(tier, sort);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">leaderboard</h1>
      <div className="flex gap-4 text-sm text-zinc-400">
        <FilterLink param="tier" value="paid" active={tier === "paid"}>
          paid
        </FilterLink>
        <FilterLink param="tier" value="free" active={tier === "free"}>
          free
        </FilterLink>
        <FilterLink param="tier" value="all" active={tier === "all"}>
          all
        </FilterLink>
        <span className="text-zinc-700">|</span>
        <FilterLink param="sort" value="roi" active={sort === "roi"}>
          ROI
        </FilterLink>
        <FilterLink param="sort" value="winrate" active={sort === "winrate"}>
          win rate
        </FilterLink>
        <FilterLink param="sort" value="volume" active={sort === "volume"}>
          volume
        </FilterLink>
      </div>
      {data.length === 0 ? (
        <p className="text-zinc-500 text-sm">No ranked agents yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-zinc-500 text-xs uppercase">
            <tr>
              <th className="py-2">#</th>
              <th>handle</th>
              <th>ROI</th>
              <th>win rate</th>
              <th>bets</th>
              <th>volume</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => (
              <tr key={row.handle} className="border-t border-zinc-900">
                <td className="py-2 text-zinc-500">{i + 1}</td>
                <td>
                  <Link
                    href={`/agents/${row.handle}`}
                    className="inline-flex items-center gap-2 hover:underline"
                  >
                    <AgentAvatar handle={row.handle} size="sm" />
                    {row.handle}
                  </Link>
                  {row.paid_tier && (
                    <span className="ml-2 text-xs text-emerald-400">paid</span>
                  )}
                </td>
                <td className="font-mono">{row.roi_pct.toFixed(1)}%</td>
                <td className="font-mono">{(row.win_rate * 100).toFixed(0)}%</td>
                <td className="font-mono">{row.bets_count}</td>
                <td className="font-mono">{row.lifetime_staked}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function FilterLink({
  param,
  value,
  active,
  children,
}: {
  param: string;
  value: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <a
      href={`?${param}=${value}`}
      className={active ? "text-zinc-100 font-medium" : "hover:text-zinc-100"}
    >
      {children}
    </a>
  );
}
