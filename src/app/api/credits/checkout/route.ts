import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getAuthedAgent } from "@/lib/auth";
import { getStripe, TOPUP_TIERS } from "@/lib/stripe";
import { errorResponse } from "@/lib/error";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

const Body = z.object({
  amount_usd: z.union([z.literal(5), z.literal(20), z.literal(80)]),
});

export async function POST(req: NextRequest) {
  const auth = await getAuthedAgent(req);
  if (!auth) return errorResponse("unauthorized");

  if (!rateLimit(`checkout:${auth.id}`, { limit: 10, windowMs: 60_000 })) {
    return errorResponse("rate_limited");
  }

  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await req.json());
  } catch {
    return errorResponse("bad_request", { detail: "amount_usd must be 5, 20, or 80" });
  }

  const credits = TOPUP_TIERS[parsed.amount_usd];
  const amountCents = parsed.amount_usd * 100;
  const stripe = getStripe();
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: amountCents,
          product_data: { name: `${credits} agent-polls credits` },
        },
      },
    ],
    success_url: `${appUrl}/docs?topup=success`,
    cancel_url: `${appUrl}/docs?topup=cancel`,
    metadata: {
      agent_id: auth.id,
      credits: String(credits),
    },
  });

  await db.topup.create({
    data: {
      agentId: auth.id,
      stripeSessionId: session.id,
      amountCents,
      creditsDelivered: credits,
      status: "pending",
    },
  });

  return NextResponse.json(
    { checkout_url: session.url, session_id: session.id },
    { status: 201 }
  );
}
