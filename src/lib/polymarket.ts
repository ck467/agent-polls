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

class LivePolymarket implements PolymarketAdapter {
  constructor(private baseUrl: string) {}

  async listTopActiveMarkets(limit: number): Promise<SourceMarket[]> {
    const out: SourceMarket[] = [];
    let cursor: string | undefined;
    while (out.length < limit) {
      const url = new URL("/markets", this.baseUrl);
      url.searchParams.set("active", "true");
      url.searchParams.set("closed", "false");
      if (cursor) url.searchParams.set("next_cursor", cursor);
      const res = await fetch(url, { headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(`polymarket ${res.status}`);
      const json = (await res.json()) as {
        data: Array<{ condition_id: string; question: string; tokens?: Array<{ outcome: string; price?: number }>; end_date_iso?: string }>;
        next_cursor?: string;
      };
      for (const m of json.data) {
        const yesToken = m.tokens?.find((t) => t.outcome === "Yes");
        if (!yesToken) continue;
        out.push({
          sourceId: m.condition_id,
          question: m.question,
          status: "open",
          yesPrice: clamp01(Number(yesToken.price ?? 0.5)),
          expiresAt: m.end_date_iso ? new Date(m.end_date_iso) : null,
        });
        if (out.length >= limit) break;
      }
      if (!json.next_cursor) break;
      cursor = json.next_cursor;
    }
    return out;
  }

  async getMarket(sourceId: string): Promise<SourceMarket | null> {
    const res = await fetch(new URL(`/markets/${sourceId}`, this.baseUrl));
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`polymarket ${res.status}`);
    const m = (await res.json()) as {
      condition_id: string;
      question: string;
      closed?: boolean;
      tokens?: Array<{ outcome: string; price?: number; winner?: boolean }>;
      end_date_iso?: string;
    };
    const yes = m.tokens?.find((t) => t.outcome === "Yes");
    const closed = m.closed === true;
    const winner = m.tokens?.find((t) => t.winner === true)?.outcome;
    const status: SourceMarket["status"] = !closed
      ? "open"
      : winner === "Yes"
        ? "resolved_yes"
        : winner === "No"
          ? "resolved_no"
          : "voided";
    return {
      sourceId: m.condition_id,
      question: m.question,
      status,
      yesPrice: yes ? clamp01(Number(yes.price ?? 0.5)) : 0.5,
      expiresAt: m.end_date_iso ? new Date(m.end_date_iso) : null,
    };
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
    process.env.POLYMARKET_BASE_URL ?? "https://clob.polymarket.com"
  );
  return adapter;
}

export function setPolymarketAdapter(a: PolymarketAdapter): void {
  adapter = a;
}
