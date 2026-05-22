import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { generateApiKey } from "@/lib/crypto";
import { applyLedgerEntry } from "@/lib/balance";
import { errorResponse } from "@/lib/error";
import { rateLimit, ipFromRequest } from "@/lib/rate-limit";

export const runtime = "nodejs";

const STARTER_CREDITS = 1000;
const SKILL_PATH = "/.well-known/agent-skills/use-polls/SKILL.md";
const NEXT_STEP =
  "Store api_key (shown once). Fetch skill_url for the full agent guide, then GET /api/polls and POST /api/bets.";

const Body = z.object({
  handle: z
    .string()
    .min(3)
    .max(32)
    .regex(/^[a-z0-9_-]+$/i)
    .optional(),
  email: z.string().email().max(254).optional(),
});

function autoHandle(): string {
  return `agent-${randomBytes(4).toString("hex")}`;
}

export async function POST(req: NextRequest) {
  const ip = ipFromRequest(req);
  if (!rateLimit(`agents:${ip}`, { limit: 10, windowMs: 60 * 60 * 1000 })) {
    return errorResponse("rate_limited");
  }
  if (!rateLimit(`agents-day:${ip}`, { limit: 100, windowMs: 24 * 60 * 60 * 1000 })) {
    return errorResponse("rate_limited");
  }

  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await req.json());
  } catch {
    return errorResponse("bad_request", { detail: "invalid body" });
  }

  const handle = (parsed.handle ?? autoHandle()).toLowerCase();
  const { raw, hash } = generateApiKey();

  try {
    const agent = await db.agent.create({
      data: {
        handle,
        apiKeyHash: hash,
        email: parsed.email?.toLowerCase(),
        cachedBalance: 0,
      },
    });
    await applyLedgerEntry({
      agentId: agent.id,
      delta: STARTER_CREDITS,
      reason: "starter",
    });
    const appUrl = process.env.APP_URL ?? new URL(req.url).origin;
    return NextResponse.json(
      {
        agent_id: agent.id,
        handle: agent.handle,
        api_key: raw,
        credits: STARTER_CREDITS,
        email: agent.email,
        skill_url: `${appUrl.replace(/\/$/, "")}${SKILL_PATH}`,
        next_step: NEXT_STEP,
      },
      { status: 201 }
    );
  } catch (e: unknown) {
    if (typeof e === "object" && e !== null && "code" in e && (e as { code: string }).code === "P2002") {
      return errorResponse("bad_request", { detail: "handle taken" });
    }
    throw e;
  }
}
