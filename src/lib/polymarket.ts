export type SourceMarket = {
  sourceId: string;
  question: string;
  status: "open" | "resolved_yes" | "resolved_no" | "voided";
  yesPrice: number;
  expiresAt: Date | null;
};

export interface PolymarketAdapter {
  listTopActiveMarkets(limit: number): Promise<SourceMarket[]>;
  getMarket(sourceId: string): Promise<SourceMarket | null>;
}

type GammaMarket = {
  conditionId: string;
  question: string;
  outcomes?: string; // JSON-encoded array of strings
  outcomePrices?: string; // JSON-encoded array of strings
  endDate?: string;
  active?: boolean;
  closed?: boolean;
  volume?: string;
};

class LivePolymarket implements PolymarketAdapter {
  constructor(private baseUrl: string) {}

  async listTopActiveMarkets(limit: number): Promise<SourceMarket[]> {
    const url = new URL("/markets", this.baseUrl);
    url.searchParams.set("active", "true");
    url.searchParams.set("closed", "false");
    url.searchParams.set("order", "volume24hr");
    url.searchParams.set("ascending", "false");
    url.searchParams.set("limit", String(Math.max(limit * 2, 100)));

    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`polymarket gamma ${res.status}`);
    const items = (await res.json()) as GammaMarket[];

    const out: SourceMarket[] = [];
    for (const m of items) {
      if (m.closed === true) continue;
      const market = toSourceMarket(m);
      if (!market) continue;
      out.push(market);
      if (out.length >= limit) break;
    }
    return out;
  }

  async getMarket(sourceId: string): Promise<SourceMarket | null> {
    const url = new URL("/markets", this.baseUrl);
    url.searchParams.set("condition_ids", sourceId);
    url.searchParams.set("limit", "1");
    const res = await fetch(url);
    if (!res.ok) return null;
    const items = (await res.json()) as GammaMarket[];
    if (!items || items.length === 0) return null;
    return toSourceMarket(items[0]);
  }
}

function toSourceMarket(m: GammaMarket): SourceMarket | null {
  if (!m.conditionId || !m.question) return null;
  const outcomes = safeJson<string[]>(m.outcomes);
  const prices = safeJson<string[]>(m.outcomePrices);
  if (!outcomes || !prices) return null;
  const yesIdx = outcomes.findIndex((o) => o.toLowerCase() === "yes");
  if (yesIdx === -1) return null;
  const yesPriceRaw = Number(prices[yesIdx] ?? 0.5);

  const closed = m.closed === true;
  let status: SourceMarket["status"] = "open";
  if (closed) {
    if (yesPriceRaw >= 0.99) status = "resolved_yes";
    else if (yesPriceRaw <= 0.01) status = "resolved_no";
    else status = "voided";
  }

  return {
    sourceId: m.conditionId,
    question: m.question,
    status,
    yesPrice: clamp01(yesPriceRaw),
    expiresAt: m.endDate ? new Date(m.endDate) : null,
  };
}

function safeJson<T>(raw: string | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0.5;
  if (n <= 0) return 0.0001;
  if (n >= 1) return 0.9999;
  return n;
}

let adapter: PolymarketAdapter | null = null;

export function getPolymarketAdapter(): PolymarketAdapter {
  if (adapter) return adapter;
  adapter = new LivePolymarket(
    process.env.POLYMARKET_BASE_URL ?? "https://gamma-api.polymarket.com"
  );
  return adapter;
}

export function setPolymarketAdapter(a: PolymarketAdapter): void {
  adapter = a;
}
