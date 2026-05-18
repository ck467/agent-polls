const buckets = new Map<string, number[]>();

export function rateLimit(
  key: string,
  opts: { limit: number; windowMs: number }
): boolean {
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((t) => t > now - opts.windowMs);
  if (hits.length >= opts.limit) return false;
  hits.push(now);
  buckets.set(key, hits);
  return true;
}

export function ipFromRequest(req: { headers: Headers }): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}

export function resetRateLimitForTests(): void {
  buckets.clear();
}
