import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { randomBytes, createHash } from "node:crypto";
import "dotenv/config";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter });

function apiKey() {
  const raw = `sk_live_${randomBytes(24).toString("hex")}`;
  const hash = createHash("sha256").update(raw).digest("hex");
  return { raw, hash };
}

async function ledger(agentId, delta, reason, relatedBetId = null) {
  await db.creditLedger.create({
    data: { agentId, delta, reason, relatedBetId },
  });
}

async function topUp(agentId, amount) {
  await ledger(agentId, amount, "topup");
  await db.agent.update({
    where: { id: agentId },
    data: { cachedBalance: { increment: amount } },
  });
}

async function main() {
  console.log("seeding demo data...");

  const polls = [
    {
      sourceId: "demo-fed-rate-may",
      question: "Will the Fed cut rates at the May 2026 FOMC meeting?",
      status: "open",
      yes: 0.34,
    },
    {
      sourceId: "demo-gpt6",
      question: "Will OpenAI announce GPT-6 by end of Q3 2026?",
      status: "open",
      yes: 0.58,
    },
    {
      sourceId: "demo-spacex-mars",
      question: "Will SpaceX launch the first crewed Starship to Mars in 2026?",
      status: "open",
      yes: 0.04,
    },
    {
      sourceId: "demo-election",
      question: "Will the incumbent win the 2026 US midterm Senate majority?",
      status: "open",
      yes: 0.47,
    },
    {
      sourceId: "demo-btc-200k",
      question: "Will Bitcoin close above $200k on any day in 2026?",
      status: "open",
      yes: 0.72,
    },
    {
      sourceId: "demo-superbowl",
      question: "Will the Chiefs win Super Bowl LXI?",
      status: "open",
      yes: 0.19,
    },
    {
      sourceId: "demo-resolved",
      question: "Will Apple ship the Vision Pro 2 before March 2026?",
      status: "resolved_yes",
      yes: 0.99,
    },
  ];

  const createdPolls = [];
  for (const p of polls) {
    const poll = await db.poll.upsert({
      where: {
        source_source_id_unique: { source: "polymarket", sourceId: p.sourceId },
      },
      create: {
        source: "polymarket",
        sourceId: p.sourceId,
        question: p.question,
        status: p.status,
        currentYesPrice: p.yes,
        resolvedAt: p.status !== "open" ? new Date() : null,
      },
      update: {
        question: p.question,
        status: p.status,
        currentYesPrice: p.yes,
        lastSyncedAt: new Date(),
      },
    });
    createdPolls.push(poll);
  }
  console.log(`  ${createdPolls.length} polls`);

  const handles = [
    { handle: "alpha-bot", paidTier: true },
    { handle: "beta-bot", paidTier: true },
    { handle: "gamma-bot", paidTier: false },
    { handle: "delta-bot", paidTier: true },
    { handle: "epsilon-bot", paidTier: false },
  ];

  const agents = [];
  for (const h of handles) {
    const { hash } = apiKey();
    const a = await db.agent.upsert({
      where: { handle: h.handle },
      create: {
        handle: h.handle,
        apiKeyHash: hash,
        paidTier: h.paidTier,
        cachedBalance: 0,
        lifetimeTopupCents: h.paidTier ? 500 : 0,
      },
      update: {},
    });
    agents.push(a);
    await topUp(a.id, 1000);
  }
  console.log(`  ${agents.length} agents`);

  // Place some bets — mix open + settled
  const openPoll = createdPolls.find((p) => p.sourceId === "demo-gpt6");
  const resolvedPoll = createdPolls.find((p) => p.status === "resolved_yes");

  let bets = 0;
  for (let i = 0; i < agents.length; i++) {
    const agent = agents[i];
    const side = i % 2 === 0 ? "yes" : "no";
    const credits = 50 + i * 30;
    const price = side === "yes" ? Number(openPoll.currentYesPrice) : 1 - Number(openPoll.currentYesPrice);
    const shares = credits / price;
    await db.bet.create({
      data: {
        agentId: agent.id,
        pollId: openPoll.id,
        side,
        creditsStaked: credits,
        shares,
        priceAtBet: price,
        settlementStatus: "open",
      },
    });
    await db.agent.update({
      where: { id: agent.id },
      data: { cachedBalance: { decrement: credits } },
    });
    await ledger(agent.id, -credits, "bet_placed");
    bets++;

    // Some settled bets on the resolved poll
    const settledStake = 100;
    const settledSide = i < 3 ? "yes" : "no";
    const settledPrice =
      settledSide === "yes"
        ? Number(resolvedPoll.currentYesPrice)
        : 1 - Number(resolvedPoll.currentYesPrice);
    const settledShares = settledStake / settledPrice;
    const won = settledSide === "yes";
    const payout = won ? Math.floor(settledShares) : 0;
    await db.bet.create({
      data: {
        agentId: agent.id,
        pollId: resolvedPoll.id,
        side: settledSide,
        creditsStaked: settledStake,
        shares: settledShares,
        priceAtBet: settledPrice,
        settlementStatus: won ? "won" : "lost",
        settledCredits: payout,
        settledAt: new Date(),
      },
    });
    await ledger(agent.id, -settledStake, "bet_placed");
    if (payout > 0) {
      await ledger(agent.id, payout, "bet_won");
      await db.agent.update({
        where: { id: agent.id },
        data: { cachedBalance: { increment: payout - settledStake } },
      });
    } else {
      await db.agent.update({
        where: { id: agent.id },
        data: { cachedBalance: { decrement: settledStake } },
      });
    }
    bets++;
  }
  console.log(`  ${bets} bets`);

  await db.$disconnect();
  console.log("done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
