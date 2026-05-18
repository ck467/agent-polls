import { db } from "@/lib/db";
import { agentImpliedYesPrice } from "@/lib/metrics";
import { notFound } from "next/navigation";
import AgentAvatar from "@/components/AgentAvatar";
import Link from "next/link";

export const revalidate = 5;

export default async function PollDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const poll = await db.poll.findUnique({
    where: { id },
    select: {
      id: true,
      question: true,
      status: true,
      currentYesPrice: true,
      expiresAt: true,
      resolvedAt: true,
      source: true,
      sourceId: true,
      bets: {
        where: { settlementStatus: "open" },
        orderBy: { placedAt: "desc" },
        take: 50,
        select: {
          id: true,
          side: true,
          creditsStaked: true,
          priceAtBet: true,
          placedAt: true,
          agent: { select: { handle: true } },
        },
      },
    },
  });
  if (!poll) notFound();

  const impliedYes = agentImpliedYesPrice(
    poll.bets.map((b) => ({
      side: b.side,
      priceAtBet: Number(b.priceAtBet),
      creditsStaked: b.creditsStaked,
    }))
  );

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{poll.question}</h1>
        <p className="text-xs text-zinc-500">status: {poll.status}</p>
      </header>

      <section className="grid grid-cols-2 gap-4">
        <Tile
          label="market YES"
          value={`${Math.round(Number(poll.currentYesPrice) * 100)}¢`}
          sub="from Polymarket"
        />
        <Tile
          label="agent-implied YES"
          value={impliedYes === null ? "—" : `${Math.round(impliedYes * 100)}¢`}
          sub="weighted avg of agent YES bets"
        />
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">recent bets</h2>
        {poll.bets.length === 0 ? (
          <p className="text-zinc-500 text-sm">No bets yet on this poll.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-zinc-500 text-xs uppercase">
              <tr>
                <th className="py-2">agent</th>
                <th>side</th>
                <th>credits</th>
                <th>price</th>
                <th>when</th>
              </tr>
            </thead>
            <tbody>
              {poll.bets.map((b) => (
                <tr key={b.id} className="border-t border-zinc-900">
                  <td className="py-2">
                    <Link
                      href={`/agents/${b.agent.handle}`}
                      className="inline-flex items-center gap-2 hover:underline"
                    >
                      <AgentAvatar handle={b.agent.handle} size="sm" />
                      {b.agent.handle}
                    </Link>
                  </td>
                  <td className={b.side === "yes" ? "text-emerald-400" : "text-rose-400"}>
                    {b.side}
                  </td>
                  <td className="font-mono">{b.creditsStaked}</td>
                  <td className="font-mono">
                    {Math.round(Number(b.priceAtBet) * 100)}¢
                  </td>
                  <td className="text-zinc-500">
                    {new Date(b.placedAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function Tile({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="rounded-lg border border-zinc-800 p-4">
      <div className="text-xs uppercase text-zinc-500">{label}</div>
      <div className="text-3xl font-mono my-1">{value}</div>
      <div className="text-xs text-zinc-500">{sub}</div>
    </div>
  );
}
