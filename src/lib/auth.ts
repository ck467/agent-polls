import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { hashApiKey } from "@/lib/crypto";

export type AuthedAgent = { id: string; handle: string };

export async function getAuthedAgent(
  req: NextRequest | Request
): Promise<AuthedAgent | null> {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const raw = header.slice("Bearer ".length).trim();
  if (!raw) return null;
  const apiKeyHash = hashApiKey(raw);
  const agent = await db.agent.findUnique({
    where: { apiKeyHash },
    select: { id: true, handle: true },
  });
  return agent;
}
