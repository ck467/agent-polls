-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "PollStatus" AS ENUM ('open', 'resolved_yes', 'resolved_no', 'voided');

-- CreateEnum
CREATE TYPE "BetSide" AS ENUM ('yes', 'no');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('open', 'won', 'lost', 'refunded');

-- CreateEnum
CREATE TYPE "LedgerReason" AS ENUM ('starter', 'bet_placed', 'bet_won', 'bet_refunded', 'topup', 'adjustment');

-- CreateEnum
CREATE TYPE "TopupStatus" AS ENUM ('pending', 'succeeded', 'failed');

-- CreateTable
CREATE TABLE "agents" (
    "id" UUID NOT NULL,
    "handle" TEXT NOT NULL,
    "api_key_hash" TEXT NOT NULL,
    "paid_tier" BOOLEAN NOT NULL DEFAULT false,
    "lifetime_topup_cents" INTEGER NOT NULL DEFAULT 0,
    "cached_balance" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "polls" (
    "id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "status" "PollStatus" NOT NULL DEFAULT 'open',
    "current_yes_price" DECIMAL(5,4) NOT NULL,
    "expires_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "last_synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "polls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bets" (
    "id" UUID NOT NULL,
    "agent_id" UUID NOT NULL,
    "poll_id" UUID NOT NULL,
    "side" "BetSide" NOT NULL,
    "credits_staked" INTEGER NOT NULL,
    "shares" DECIMAL(20,8) NOT NULL,
    "price_at_bet" DECIMAL(5,4) NOT NULL,
    "placed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settlement_status" "SettlementStatus" NOT NULL DEFAULT 'open',
    "settled_credits" INTEGER,
    "settled_at" TIMESTAMP(3),

    CONSTRAINT "bets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_ledger" (
    "id" UUID NOT NULL,
    "agent_id" UUID NOT NULL,
    "delta" INTEGER NOT NULL,
    "reason" "LedgerReason" NOT NULL,
    "related_bet_id" UUID,
    "related_topup_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "topups" (
    "id" UUID NOT NULL,
    "agent_id" UUID NOT NULL,
    "stripe_session_id" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "credits_delivered" INTEGER NOT NULL,
    "status" "TopupStatus" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "topups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "key" TEXT NOT NULL,
    "agent_id" UUID,
    "request_hash" TEXT NOT NULL,
    "response_body" JSONB NOT NULL,
    "status_code" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "agents_handle_key" ON "agents"("handle");

-- CreateIndex
CREATE UNIQUE INDEX "agents_api_key_hash_key" ON "agents"("api_key_hash");

-- CreateIndex
CREATE UNIQUE INDEX "polls_source_source_id_key" ON "polls"("source", "source_id");

-- CreateIndex
CREATE INDEX "bets_agent_id_idx" ON "bets"("agent_id");

-- CreateIndex
CREATE INDEX "bets_poll_id_settlement_status_idx" ON "bets"("poll_id", "settlement_status");

-- CreateIndex
CREATE INDEX "credit_ledger_agent_id_idx" ON "credit_ledger"("agent_id");

-- CreateIndex
CREATE UNIQUE INDEX "topups_stripe_session_id_key" ON "topups"("stripe_session_id");

-- AddForeignKey
ALTER TABLE "bets" ADD CONSTRAINT "bets_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bets" ADD CONSTRAINT "bets_poll_id_fkey" FOREIGN KEY ("poll_id") REFERENCES "polls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_related_bet_id_fkey" FOREIGN KEY ("related_bet_id") REFERENCES "bets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_related_topup_id_fkey" FOREIGN KEY ("related_topup_id") REFERENCES "topups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "topups" ADD CONSTRAINT "topups_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

