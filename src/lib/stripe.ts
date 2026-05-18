import Stripe from "stripe";

let client: Stripe | null = null;

export function getStripe(): Stripe {
  if (client) return client;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY not set");
  client = new Stripe(key);
  return client;
}

export function resetStripeForTests(c: Stripe | null): void {
  client = c;
}

export const TOPUP_TIERS = {
  5: 1000,
  20: 5000,
  80: 25000,
} as const;
