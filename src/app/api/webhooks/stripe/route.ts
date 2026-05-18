import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getStripe } from "@/lib/stripe";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const sig = req.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!sig || !secret)
    return NextResponse.json({ error: "missing signature" }, { status: 400 });

  const body = await req.text();
  let event: { type: string; data: { object: { id?: string } } };
  try {
    event = getStripe().webhooks.constructEvent(body, sig, secret) as never;
  } catch {
    return NextResponse.json({ error: "bad signature" }, { status: 400 });
  }

  if (event.type !== "checkout.session.completed") {
    return NextResponse.json({ ok: true, ignored: event.type });
  }

  const sessionId = event.data?.object?.id;
  if (!sessionId) return NextResponse.json({ ok: true });

  const topup = await db.topup.findUnique({ where: { stripeSessionId: sessionId } });
  if (!topup) {
    console.warn("stripe webhook: unknown session_id", sessionId);
    return NextResponse.json({ ok: true });
  }
  if (topup.status === "succeeded") {
    return NextResponse.json({ ok: true, idempotent: true });
  }

  await db.$transaction(async (tx) => {
    const claim = await tx.topup.updateMany({
      where: { stripeSessionId: sessionId, status: "pending" },
      data: { status: "succeeded" },
    });
    if (claim.count === 0) return;

    await tx.creditLedger.create({
      data: {
        agentId: topup.agentId,
        delta: topup.creditsDelivered,
        reason: "topup",
        relatedTopupId: topup.id,
      },
    });
    await tx.agent.update({
      where: { id: topup.agentId },
      data: {
        cachedBalance: { increment: topup.creditsDelivered },
        paidTier: true,
        lifetimeTopupCents: { increment: topup.amountCents },
      },
    });
  });

  return NextResponse.json({ ok: true });
}
