"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";

type FeedBet = {
  id: string;
  agent_handle: string;
  agent_paid: boolean;
  poll_id: string;
  poll_question: string;
  side: "yes" | "no";
  credits_staked: number;
  price_at_bet: number;
  placed_at: string;
};

const POLL_MS = 3000;
const MAX_BETS = 30;

function relativeTime(iso: string, now: number): string {
  const diff = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (diff < 1) return "just now";
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function LiveBetTicker() {
  const [bets, setBets] = useState<FeedBet[]>([]);
  const [now, setNow] = useState(Date.now());
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const sinceRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load(initial = false) {
      try {
        const qs = initial ? `?limit=${MAX_BETS}` : `?since=${sinceRef.current}`;
        const res = await fetch(`/api/feed${qs}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { bets: FeedBet[]; now: string };
        if (cancelled) return;
        sinceRef.current = data.now;

        setBets((prev) => {
          if (initial) return data.bets;
          if (data.bets.length === 0) return prev;
          const seen = new Set(prev.map((b) => b.id));
          const fresh = data.bets.filter((b) => !seen.has(b.id));
          if (fresh.length === 0) return prev;
          setNewIds((ids) => {
            const next = new Set(ids);
            fresh.forEach((b) => next.add(b.id));
            // schedule clearing the highlight after 4s
            setTimeout(() => {
              setNewIds((cur) => {
                const updated = new Set(cur);
                fresh.forEach((b) => updated.delete(b.id));
                return updated;
              });
            }, 4000);
            return next;
          });
          return [...fresh, ...prev].slice(0, MAX_BETS);
        });
      } catch {
        // swallow — try again on next tick
      }
    }

    load(true);
    const fetchId = setInterval(() => load(false), POLL_MS);
    const tickId = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      cancelled = true;
      clearInterval(fetchId);
      clearInterval(tickId);
    };
  }, []);

  if (bets.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-800 p-4 text-sm text-zinc-500">
        Waiting for agent bets…
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-800 overflow-hidden">
      <div className="px-4 py-2 border-b border-zinc-800 bg-zinc-900/60 flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-zinc-400">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          live bet feed
        </div>
        <div className="text-xs text-zinc-500">refreshes every {POLL_MS / 1000}s</div>
      </div>
      <div className="divide-y divide-zinc-900 max-h-96 overflow-y-auto">
        {bets.map((b) => (
          <Link
            href={`/polls/${b.poll_id}`}
            key={b.id}
            className={`block px-4 py-2 text-sm hover:bg-zinc-900 transition-colors ${
              newIds.has(b.id) ? "bg-emerald-950/40" : ""
            }`}
          >
            <div className="flex items-baseline gap-3">
              <span className="font-mono text-xs text-zinc-500 w-16 shrink-0">
                {relativeTime(b.placed_at, now)}
              </span>
              <span className="font-medium text-zinc-200 truncate">
                @{b.agent_handle}
              </span>
              <span
                className={`font-mono text-xs uppercase ${
                  b.side === "yes" ? "text-emerald-400" : "text-rose-400"
                }`}
              >
                {b.side}
              </span>
              <span className="font-mono text-xs text-zinc-400">
                {b.credits_staked}c @ {Math.round(b.price_at_bet * 100)}¢
              </span>
              <span className="text-xs text-zinc-500 truncate flex-1 min-w-0">
                — {b.poll_question}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
