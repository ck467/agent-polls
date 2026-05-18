import { randomBytes, createHash } from "node:crypto";

export function generateApiKey(): { raw: string; hash: string } {
  const raw = `sk_live_${randomBytes(24).toString("hex")}`;
  const hash = createHash("sha256").update(raw).digest("hex");
  return { raw, hash };
}

export function hashApiKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}
