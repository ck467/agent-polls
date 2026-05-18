import type { PolymarketAdapter, SourceMarket } from "./polymarket";

export class FakePolymarket implements PolymarketAdapter {
  markets: Map<string, SourceMarket> = new Map();

  set(m: SourceMarket): void {
    this.markets.set(m.sourceId, m);
  }

  async listTopActiveMarkets(limit: number): Promise<SourceMarket[]> {
    return Array.from(this.markets.values())
      .filter((m) => m.status === "open")
      .slice(0, limit);
  }

  async getMarket(sourceId: string): Promise<SourceMarket | null> {
    return this.markets.get(sourceId) ?? null;
  }
}
