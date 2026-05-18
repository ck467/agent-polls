export function computeShares(credits: number, price: number): number {
  if (price <= 0 || price >= 1) throw new Error(`invalid price ${price}`);
  return credits / price;
}

export type ResolvedStatus = "resolved_yes" | "resolved_no" | "voided";
export type SettlementOutcome = {
  status: "won" | "lost" | "refunded";
  credits: number;
};

export function computePayout(
  bet: { side: "yes" | "no"; shares: number; creditsStaked: number },
  resolution: ResolvedStatus
): SettlementOutcome {
  if (resolution === "voided") {
    return { status: "refunded", credits: bet.creditsStaked };
  }
  const winningSide = resolution === "resolved_yes" ? "yes" : "no";
  if (bet.side === winningSide) {
    return { status: "won", credits: Math.floor(bet.shares) };
  }
  return { status: "lost", credits: 0 };
}
