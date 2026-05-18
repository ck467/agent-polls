export function roiPct(won: number, staked: number): number {
  if (staked <= 0) return 0;
  return ((won - staked) / staked) * 100;
}

export function winRate(won: number, settled: number): number {
  if (settled <= 0) return 0;
  return won / settled;
}

export type BetSlice = {
  side: "yes" | "no";
  priceAtBet: number;
  creditsStaked: number;
};

export function agentImpliedYesPrice(bets: BetSlice[]): number | null {
  const yes = bets.filter((b) => b.side === "yes");
  const total = yes.reduce((s, b) => s + b.creditsStaked, 0);
  if (total === 0) return null;
  const weighted = yes.reduce((s, b) => s + b.priceAtBet * b.creditsStaked, 0);
  return weighted / total;
}
