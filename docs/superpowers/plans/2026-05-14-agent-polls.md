# Agent Polls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the MVP described in `docs/superpowers/specs/2026-05-14-agent-polls-design.md` — a play-money prediction-market platform for AI agents, mirroring Polymarket polls, with a read-only spectator frontend.

**Architecture:** Single Next.js App Router project on Vercel. `/api/*` routes serve the agent JSON API; `/*` routes server-render public spectator pages. Postgres via Prisma. Background workers are Vercel Cron HTTP endpoints under `/api/cron/*`, secured by `CRON_SECRET`. Stripe Checkout handles top-ups.

**Tech Stack:** Node.js 24, TypeScript, Next.js 16 App Router, Prisma + Postgres, Vitest + testcontainers, Playwright (smoke E2E), Stripe SDK, Tailwind CSS.

---

## File Structure

```
agent-polls/
├── .env.example
├── package.json
├── tsconfig.json
├── next.config.ts
├── vercel.json                                # cron schedules
├── postcss.config.mjs
├── tailwind.config.ts
├── vitest.config.ts
├── playwright.config.ts
├── prisma/
│   └── schema.prisma
├── src/
│   ├── lib/
│   │   ├── db.ts                              # Prisma client singleton
│   │   ├── crypto.ts                          # sha256, generate api key
│   │   ├── auth.ts                            # bearer key middleware
│   │   ├── error.ts                           # JSON error envelope
│   │   ├── rate-limit.ts                      # simple per-IP / per-agent limiter
│   │   ├── metrics.ts                         # roi, win_rate, agent_implied_yes_price
│   │   ├── settlement.ts                      # pure payout math
│   │   ├── balance.ts                         # atomic balance ops
│   │   ├── polymarket.ts                      # adapter interface + live impl
│   │   ├── polymarket.fake.ts                 # in-memory test impl
│   │   └── stripe.ts                          # SDK singleton + helpers
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx                           # /
│   │   ├── polls/
│   │   │   ├── page.tsx                       # /polls
│   │   │   └── [id]/
│   │   │       ├── page.tsx                   # /polls/:id
│   │   │       └── opengraph-image.tsx        # OG card
│   │   ├── leaderboard/page.tsx               # /leaderboard
│   │   ├── agents/[handle]/
│   │   │   ├── page.tsx                       # /agents/:handle
│   │   │   └── opengraph-image.tsx
│   │   ├── docs/page.tsx                      # /docs
│   │   └── api/
│   │       ├── agents/route.ts                # POST
│   │       ├── agents/me/route.ts             # GET
│   │       ├── polls/route.ts                 # GET
│   │       ├── polls/[id]/route.ts            # GET
│   │       ├── bets/route.ts                  # POST, GET
│   │       ├── credits/checkout/route.ts      # POST
│   │       ├── leaderboard/route.ts           # GET
│   │       ├── webhooks/stripe/route.ts       # POST
│   │       └── cron/
│   │           ├── sync-polymarket/route.ts
│   │           └── settle/route.ts
│   └── tests/
│       ├── setup.ts
│       ├── fixtures.ts
│       ├── lib/
│       │   ├── metrics.test.ts
│       │   ├── settlement.test.ts
│       │   ├── balance.test.ts
│       │   └── rate-limit.test.ts
│       ├── api/
│       │   ├── agents.test.ts
│       │   ├── polls.test.ts
│       │   ├── bets.test.ts
│       │   ├── credits.test.ts
│       │   ├── leaderboard.test.ts
│       │   └── webhooks.test.ts
│       ├── workers/
│       │   ├── sync.test.ts
│       │   └── settle.test.ts
│       └── e2e/
│           └── spectator.spec.ts
└── docs/
    └── superpowers/
        ├── specs/2026-05-14-agent-polls-design.md
        └── plans/2026-05-14-agent-polls.md
```

---

## Task 1: Bootstrap Next.js project

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `tailwind.config.ts`, `src/app/layout.tsx`, `src/app/page.tsx`, `.env.example`

- [ ] **Step 1: Initialize Next.js project**

Run from `/Users/chaithanyakamath/development/agentnative/agent-polls`:

```bash
npx create-next-app@latest . --typescript --tailwind --app --no-src-dir --import-alias '@/*' --use-npm --yes
```

When it asks about Turbopack: yes.

- [ ] **Step 2: Move app into `src/`**

The bootstrap created `app/` at the root. Move it:

```bash
mkdir -p src
mv app src/app
```

Update `tsconfig.json` `paths` to point `@/*` at `./src/*`:

```json
{
  "compilerOptions": {
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

- [ ] **Step 3: Install runtime deps**

```bash
npm install @prisma/client stripe zod
npm install -D prisma vitest @vitest/coverage-v8 @testcontainers/postgresql @playwright/test tsx
```

- [ ] **Step 4: Add `.env.example`**

Write `.env.example`:

```
DATABASE_URL=postgres://postgres:postgres@localhost:5432/agent_polls
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
CRON_SECRET=generate-a-random-string
APP_URL=http://localhost:3000
POLYMARKET_BASE_URL=https://clob.polymarket.com
NODE_ENV=development
```

- [ ] **Step 5: Verify dev server starts**

```bash
npm run dev
```

Expected: server up on `http://localhost:3000` showing the default Next.js page. Ctrl+C to stop.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: bootstrap Next.js 16 app with TypeScript, Tailwind, Prisma deps"
```

---

## Task 2: Prisma schema and initial migration

**Files:**
- Create: `prisma/schema.prisma`

- [ ] **Step 1: Write schema**

Create `prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Agent {
  id                   String   @id @default(uuid()) @db.Uuid
  handle               String   @unique
  apiKeyHash           String   @unique @map("api_key_hash")
  paidTier             Boolean  @default(false) @map("paid_tier")
  lifetimeTopupCents   Int      @default(0) @map("lifetime_topup_cents")
  cachedBalance        Int      @default(0) @map("cached_balance")
  createdAt            DateTime @default(now()) @map("created_at")

  bets        Bet[]
  ledger      CreditLedger[]
  topups      Topup[]
  idempotency IdempotencyKey[]

  @@map("agents")
}

enum PollStatus {
  open
  resolved_yes
  resolved_no
  voided
}

model Poll {
  id              String     @id @default(uuid()) @db.Uuid
  source          String
  sourceId        String     @map("source_id")
  question        String
  status          PollStatus @default(open)
  currentYesPrice Decimal    @map("current_yes_price") @db.Decimal(5, 4)
  expiresAt       DateTime?  @map("expires_at")
  resolvedAt      DateTime?  @map("resolved_at")
  lastSyncedAt    DateTime   @default(now()) @map("last_synced_at")

  bets Bet[]

  @@unique([source, sourceId], name: "source_source_id_unique")
  @@map("polls")
}

enum BetSide {
  yes
  no
}

enum SettlementStatus {
  open
  won
  lost
  refunded
}

model Bet {
  id               String           @id @default(uuid()) @db.Uuid
  agentId          String           @map("agent_id") @db.Uuid
  pollId           String           @map("poll_id") @db.Uuid
  side             BetSide
  creditsStaked    Int              @map("credits_staked")
  shares           Decimal          @db.Decimal(20, 8)
  priceAtBet       Decimal          @map("price_at_bet") @db.Decimal(5, 4)
  placedAt         DateTime         @default(now()) @map("placed_at")
  settlementStatus SettlementStatus @default(open) @map("settlement_status")
  settledCredits   Int?             @map("settled_credits")
  settledAt        DateTime?        @map("settled_at")

  agent  Agent          @relation(fields: [agentId], references: [id])
  poll   Poll           @relation(fields: [pollId], references: [id])
  ledger CreditLedger[]

  @@index([agentId])
  @@index([pollId, settlementStatus])
  @@map("bets")
}

enum LedgerReason {
  starter
  bet_placed
  bet_won
  bet_refunded
  topup
  adjustment
}

model CreditLedger {
  id             String       @id @default(uuid()) @db.Uuid
  agentId        String       @map("agent_id") @db.Uuid
  delta          Int
  reason         LedgerReason
  relatedBetId   String?      @map("related_bet_id") @db.Uuid
  relatedTopupId String?      @map("related_topup_id") @db.Uuid
  createdAt      DateTime     @default(now()) @map("created_at")

  agent Agent  @relation(fields: [agentId], references: [id])
  bet   Bet?   @relation(fields: [relatedBetId], references: [id])
  topup Topup? @relation(fields: [relatedTopupId], references: [id])

  @@index([agentId])
  @@map("credit_ledger")
}

enum TopupStatus {
  pending
  succeeded
  failed
}

model Topup {
  id                String      @id @default(uuid()) @db.Uuid
  agentId           String      @map("agent_id") @db.Uuid
  stripeSessionId   String      @unique @map("stripe_session_id")
  amountCents       Int         @map("amount_cents")
  creditsDelivered Int          @map("credits_delivered")
  status            TopupStatus @default(pending)
  createdAt         DateTime    @default(now()) @map("created_at")

  agent  Agent          @relation(fields: [agentId], references: [id])
  ledger CreditLedger[]

  @@map("topups")
}

model IdempotencyKey {
  key          String   @id
  agentId      String?  @map("agent_id") @db.Uuid
  requestHash  String   @map("request_hash")
  responseBody Json     @map("response_body")
  statusCode   Int      @map("status_code")
  createdAt    DateTime @default(now()) @map("created_at")

  agent Agent? @relation(fields: [agentId], references: [id])

  @@map("idempotency_keys")
}
```

- [ ] **Step 2: Start local Postgres**

```bash
docker run --name agent-polls-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=agent_polls -p 5432:5432 -d postgres:16
```

If Postgres is already running on the user's machine, create the DB instead: `createdb agent_polls`.

- [ ] **Step 3: Create the migration**

```bash
cp .env.example .env
npx prisma migrate dev --name init
```

Expected: a migration file appears under `prisma/migrations/<timestamp>_init/migration.sql`. Prisma generates the client.

- [ ] **Step 4: Verify the client compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add prisma/ .env.example
git commit -m "feat(db): initial Prisma schema and migration"
```

---

## Task 3: Test infrastructure (Vitest + testcontainers)

**Files:**
- Create: `vitest.config.ts`, `src/tests/setup.ts`, `src/tests/global-setup.ts`, `src/tests/fixtures.ts`, `src/lib/db.ts`

- [ ] **Step 1: Write `src/lib/db.ts` — Prisma singleton**

```ts
import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

export const db =
  global.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") global.prisma = db;
```

- [ ] **Step 2: Write `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    globalSetup: ["./src/tests/global-setup.ts"],
    setupFiles: ["./src/tests/setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
```

- [ ] **Step 3: Write `src/tests/global-setup.ts` — starts a Postgres container once**

The setup runs Prisma migrations against the container using `execFileSync` with an argv array (no shell), then exposes the connection string via env var. Per-test cleanup happens in `setup.ts`.

```ts
import { PostgreSqlContainer, StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { execFileSync } from "node:child_process";

let container: StartedPostgreSqlContainer;

export async function setup() {
  container = await new PostgreSqlContainer("postgres:16").start();
  const url = container.getConnectionUri();
  process.env.DATABASE_URL = url;
  // Apply migrations against the container using prisma CLI via execFile (no shell).
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "inherit",
  });
}

export async function teardown() {
  await container?.stop();
}
```

- [ ] **Step 4: Write `src/tests/setup.ts` — per-test truncation**

```ts
import { beforeEach, afterAll } from "vitest";
import { db } from "@/lib/db";

beforeEach(async () => {
  const tables = [
    "idempotency_keys",
    "credit_ledger",
    "topups",
    "bets",
    "polls",
    "agents",
  ];
  await db.$executeRawUnsafe(
    `TRUNCATE TABLE ${tables.join(", ")} RESTART IDENTITY CASCADE`
  );
});

afterAll(async () => {
  await db.$disconnect();
});
```

- [ ] **Step 5: Write `src/tests/fixtures.ts` — seed helpers**

```ts
import { db } from "@/lib/db";
import { randomBytes, createHash } from "node:crypto";

export async function createAgent(overrides: { handle?: string; balance?: number; paidTier?: boolean } = {}) {
  const handle = overrides.handle ?? `agent-${randomBytes(4).toString("hex")}`;
  const apiKey = `sk_test_${randomBytes(16).toString("hex")}`;
  const apiKeyHash = createHash("sha256").update(apiKey).digest("hex");
  const balance = overrides.balance ?? 1000;
  const paidTier = overrides.paidTier ?? false;

  const agent = await db.agent.create({
    data: {
      handle,
      apiKeyHash,
      paidTier,
      cachedBalance: balance,
    },
  });

  if (balance > 0) {
    await db.creditLedger.create({
      data: { agentId: agent.id, delta: balance, reason: "starter" },
    });
  }

  return { agent, apiKey };
}

export async function createPoll(overrides: { sourceId?: string; status?: "open" | "resolved_yes" | "resolved_no" | "voided"; price?: number; lastSyncedAt?: Date } = {}) {
  const sourceId = overrides.sourceId ?? `pm-${randomBytes(4).toString("hex")}`;
  return db.poll.create({
    data: {
      source: "polymarket",
      sourceId,
      question: `Test poll ${sourceId}`,
      status: overrides.status ?? "open",
      currentYesPrice: overrides.price ?? 0.5,
      lastSyncedAt: overrides.lastSyncedAt ?? new Date(),
    },
  });
}
```

- [ ] **Step 6: Add `test` script in `package.json`**

Edit `package.json` `scripts` block:

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

- [ ] **Step 7: Write a smoke test to verify the harness works**

Create `src/tests/setup.smoke.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { createAgent } from "./fixtures";

describe("test harness smoke", () => {
  it("can create and query an agent against a real Postgres", async () => {
    const { agent } = await createAgent({ handle: "smoke-test" });
    const found = await db.agent.findUnique({ where: { id: agent.id } });
    expect(found?.handle).toBe("smoke-test");
    expect(found?.cachedBalance).toBe(1000);
  });
});
```

- [ ] **Step 8: Run the smoke test**

```bash
npm test
```

Expected: 1 test passes. Container start may take ~10s the first time.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "test: vitest + testcontainers Postgres harness and seed fixtures"
```

---

## Task 4: Pure-function library — settlement, metrics, crypto

**Files:**
- Create: `src/lib/crypto.ts`, `src/lib/settlement.ts`, `src/lib/metrics.ts`, `src/tests/lib/settlement.test.ts`, `src/tests/lib/metrics.test.ts`

- [ ] **Step 1: Write failing test for `settlement.ts`**

Create `src/tests/lib/settlement.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeShares, computePayout } from "@/lib/settlement";

describe("computeShares", () => {
  it("returns credits / price", () => {
    expect(computeShares(100, 0.5)).toBeCloseTo(200, 8);
    expect(computeShares(67, 0.67)).toBeCloseTo(100, 8);
  });
});

describe("computePayout", () => {
  it("YES bet on resolved_yes pays floor(shares)", () => {
    expect(
      computePayout({ side: "yes", shares: 199.5, creditsStaked: 100 }, "resolved_yes")
    ).toEqual({ status: "won", credits: 199 });
  });
  it("YES bet on resolved_no pays 0", () => {
    expect(
      computePayout({ side: "yes", shares: 199.5, creditsStaked: 100 }, "resolved_no")
    ).toEqual({ status: "lost", credits: 0 });
  });
  it("NO bet on resolved_no pays floor(shares)", () => {
    expect(
      computePayout({ side: "no", shares: 50.4, creditsStaked: 100 }, "resolved_no")
    ).toEqual({ status: "won", credits: 50 });
  });
  it("voided poll refunds credits_staked regardless of side", () => {
    expect(
      computePayout({ side: "yes", shares: 200, creditsStaked: 100 }, "voided")
    ).toEqual({ status: "refunded", credits: 100 });
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

```bash
npm test -- src/tests/lib/settlement.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/settlement.ts`**

```ts
export function computeShares(credits: number, price: number): number {
  if (price <= 0 || price >= 1) throw new Error(`invalid price ${price}`);
  return credits / price;
}

export type ResolvedStatus = "resolved_yes" | "resolved_no" | "voided";
export type SettlementOutcome = { status: "won" | "lost" | "refunded"; credits: number };

export function computePayout(
  bet: { side: "yes" | "no"; shares: number; creditsStaked: number },
  resolution: ResolvedStatus
): SettlementOutcome {
  if (resolution === "voided") {
    return { status: "refunded", credits: bet.creditsStaked };
  }
  const winningSide = resolution === "resolved_yes" ? "yes" : "no";
  if (bet.side === winningSide) {
    return { status: "won", credits: Math.floor(bet.shares) };
  }
  return { status: "lost", credits: 0 };
}
```

- [ ] **Step 4: Run, verify pass**

```bash
npm test -- src/tests/lib/settlement.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 5: Write failing test for `metrics.ts`**

Create `src/tests/lib/metrics.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { roiPct, winRate, agentImpliedYesPrice } from "@/lib/metrics";

describe("roiPct", () => {
  it("returns 0 when no staked", () => {
    expect(roiPct(0, 0)).toBe(0);
  });
  it("computes percent return", () => {
    expect(roiPct(150, 100)).toBe(50);
    expect(roiPct(80, 100)).toBe(-20);
  });
});

describe("winRate", () => {
  it("returns 0 with no settled bets", () => {
    expect(winRate(0, 0)).toBe(0);
  });
  it("returns won/settled fraction", () => {
    expect(winRate(3, 10)).toBe(0.3);
  });
});

describe("agentImpliedYesPrice", () => {
  it("weighted average of YES prices", () => {
    expect(
      agentImpliedYesPrice([
        { side: "yes", priceAtBet: 0.6, creditsStaked: 100 },
        { side: "yes", priceAtBet: 0.8, creditsStaked: 300 },
        { side: "no", priceAtBet: 0.3, creditsStaked: 50 }, // ignored
      ])
    ).toBeCloseTo((0.6 * 100 + 0.8 * 300) / 400, 6);
  });
  it("returns null with no YES bets", () => {
    expect(
      agentImpliedYesPrice([{ side: "no", priceAtBet: 0.3, creditsStaked: 100 }])
    ).toBeNull();
  });
});
```

- [ ] **Step 6: Run, verify fail**

```bash
npm test -- src/tests/lib/metrics.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 7: Implement `src/lib/metrics.ts`**

```ts
export function roiPct(won: number, staked: number): number {
  if (staked <= 0) return 0;
  return ((won - staked) / staked) * 100;
}

export function winRate(won: number, settled: number): number {
  if (settled <= 0) return 0;
  return won / settled;
}

export type BetSlice = { side: "yes" | "no"; priceAtBet: number; creditsStaked: number };

export function agentImpliedYesPrice(bets: BetSlice[]): number | null {
  const yes = bets.filter((b) => b.side === "yes");
  const total = yes.reduce((s, b) => s + b.creditsStaked, 0);
  if (total === 0) return null;
  const weighted = yes.reduce((s, b) => s + b.priceAtBet * b.creditsStaked, 0);
  return weighted / total;
}
```

- [ ] **Step 8: Run, verify pass**

```bash
npm test -- src/tests/lib/metrics.test.ts
```

Expected: 5 tests pass.

- [ ] **Step 9: Write `src/lib/crypto.ts`**

```ts
import { randomBytes, createHash } from "node:crypto";

export function generateApiKey(): { raw: string; hash: string } {
  const raw = `sk_live_${randomBytes(24).toString("hex")}`;
  const hash = createHash("sha256").update(raw).digest("hex");
  return { raw, hash };
}

export function hashApiKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}
```

(No separate test file — exercised via the agents route tests in Task 7.)

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(lib): pure-function settlement + metrics + crypto helpers"
```

---

## Task 5: Error envelope + auth middleware

**Files:**
- Create: `src/lib/error.ts`, `src/lib/auth.ts`

- [ ] **Step 1: Write `src/lib/error.ts`**

```ts
import { NextResponse } from "next/server";

export type ErrorCode =
  | "bad_request"
  | "unauthorized"
  | "insufficient_credits"
  | "not_found"
  | "poll_closed"
  | "rate_limited"
  | "stale_price"
  | "internal";

const STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  insufficient_credits: 402,
  not_found: 404,
  poll_closed: 409,
  rate_limited: 429,
  stale_price: 503,
  internal: 500,
};

export function errorResponse(
  code: ErrorCode,
  extra: Record<string, unknown> = {}
): NextResponse {
  return NextResponse.json({ error: code, ...extra }, { status: STATUS[code] });
}
```

- [ ] **Step 2: Write `src/lib/auth.ts`**

```ts
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { hashApiKey } from "@/lib/crypto";

export type AuthedAgent = { id: string; handle: string };

export async function getAuthedAgent(req: NextRequest): Promise<AuthedAgent | null> {
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
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(lib): error envelope + bearer auth middleware"
```

(Both modules will be exercised by API route tests in subsequent tasks.)

---

## Task 6: Atomic balance helper

**Files:**
- Create: `src/lib/balance.ts`, `src/tests/lib/balance.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/tests/lib/balance.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { applyLedgerEntry, debitForBet } from "@/lib/balance";
import { createAgent } from "../fixtures";

describe("applyLedgerEntry", () => {
  it("inserts ledger row and updates cached_balance atomically", async () => {
    const { agent } = await createAgent({ balance: 500 });
    await applyLedgerEntry({ agentId: agent.id, delta: 100, reason: "topup" });
    const after = await db.agent.findUnique({ where: { id: agent.id } });
    expect(after?.cachedBalance).toBe(600);
    const ledger = await db.creditLedger.findMany({ where: { agentId: agent.id } });
    expect(ledger.map((l) => l.delta).reduce((a, b) => a + b, 0)).toBe(600);
  });
});

describe("debitForBet", () => {
  it("succeeds when balance is sufficient", async () => {
    const { agent } = await createAgent({ balance: 200 });
    const ok = await debitForBet({ agentId: agent.id, credits: 100, betId: null });
    expect(ok).toBe(true);
    const after = await db.agent.findUnique({ where: { id: agent.id } });
    expect(after?.cachedBalance).toBe(100);
  });
  it("rejects when balance is insufficient", async () => {
    const { agent } = await createAgent({ balance: 50 });
    const ok = await debitForBet({ agentId: agent.id, credits: 100, betId: null });
    expect(ok).toBe(false);
    const after = await db.agent.findUnique({ where: { id: agent.id } });
    expect(after?.cachedBalance).toBe(50);
  });
  it("survives concurrent debits without going negative", async () => {
    const { agent } = await createAgent({ balance: 100 });
    const results = await Promise.all(
      Array.from({ length: 20 }, () => debitForBet({ agentId: agent.id, credits: 10, betId: null }))
    );
    const successes = results.filter(Boolean).length;
    expect(successes).toBe(10); // exactly 10 succeed, 10 fail
    const after = await db.agent.findUnique({ where: { id: agent.id } });
    expect(after?.cachedBalance).toBe(0);
  });
});
```

- [ ] **Step 2: Run, verify fail**

```bash
npm test -- src/tests/lib/balance.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/balance.ts`**

```ts
import { db } from "@/lib/db";
import type { LedgerReason } from "@prisma/client";

export async function applyLedgerEntry(input: {
  agentId: string;
  delta: number;
  reason: LedgerReason;
  relatedBetId?: string | null;
  relatedTopupId?: string | null;
}): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.creditLedger.create({
      data: {
        agentId: input.agentId,
        delta: input.delta,
        reason: input.reason,
        relatedBetId: input.relatedBetId ?? null,
        relatedTopupId: input.relatedTopupId ?? null,
      },
    });
    await tx.agent.update({
      where: { id: input.agentId },
      data: { cachedBalance: { increment: input.delta } },
    });
  });
}

export async function debitForBet(input: {
  agentId: string;
  credits: number;
  betId: string | null;
}): Promise<boolean> {
  if (input.credits <= 0) throw new Error("credits must be positive");

  // Atomic conditional update: only debit if balance suffices.
  const updated = await db.agent.updateMany({
    where: { id: input.agentId, cachedBalance: { gte: input.credits } },
    data: { cachedBalance: { decrement: input.credits } },
  });
  if (updated.count === 0) return false;

  await db.creditLedger.create({
    data: {
      agentId: input.agentId,
      delta: -input.credits,
      reason: "bet_placed",
      relatedBetId: input.betId,
    },
  });
  return true;
}
```

- [ ] **Step 4: Run, verify pass**

```bash
npm test -- src/tests/lib/balance.test.ts
```

Expected: 4 tests pass, including the concurrency one.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(lib): atomic balance debit + ledger entry helper"
```

---

## Task 7: POST /api/agents (registration)

**Files:**
- Create: `src/app/api/agents/route.ts`, `src/tests/api/agents.test.ts`

The starter credit amount is **1000**, defined as a constant.

- [ ] **Step 1: Write failing test**

Create `src/tests/api/agents.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { POST } from "@/app/api/agents/route";
import { db } from "@/lib/db";
import { hashApiKey } from "@/lib/crypto";

function makeReq(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/agents", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("POST /api/agents", () => {
  it("creates an agent and returns a raw api key + starter credits", async () => {
    const res = await POST(makeReq({ handle: "ada" }) as any);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.handle).toBe("ada");
    expect(json.api_key).toMatch(/^sk_live_[a-f0-9]+$/);
    expect(json.credits).toBe(1000);

    const stored = await db.agent.findUnique({ where: { handle: "ada" } });
    expect(stored).not.toBeNull();
    expect(stored!.apiKeyHash).toBe(hashApiKey(json.api_key));
    expect(stored!.cachedBalance).toBe(1000);
  });

  it("auto-generates a handle if not provided", async () => {
    const res = await POST(makeReq({}) as any);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.handle).toMatch(/^agent-[a-z0-9]+$/);
  });

  it("rejects a duplicate handle", async () => {
    await POST(makeReq({ handle: "dup" }) as any);
    const res = await POST(makeReq({ handle: "dup" }) as any);
    expect(res.status).toBe(400);
  });

  it("rejects malformed handle", async () => {
    const res = await POST(makeReq({ handle: "has spaces!" }) as any);
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run, verify fail**

```bash
npm test -- src/tests/api/agents.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/app/api/agents/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { generateApiKey } from "@/lib/crypto";
import { applyLedgerEntry } from "@/lib/balance";
import { errorResponse } from "@/lib/error";

export const runtime = "nodejs";

const STARTER_CREDITS = 1000;

const Body = z.object({
  handle: z
    .string()
    .min(3)
    .max(32)
    .regex(/^[a-z0-9_-]+$/i)
    .optional(),
});

function autoHandle() {
  return `agent-${randomBytes(4).toString("hex")}`;
}

export async function POST(req: NextRequest) {
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
        cachedBalance: 0, // updated by applyLedgerEntry below
      },
    });
    await applyLedgerEntry({
      agentId: agent.id,
      delta: STARTER_CREDITS,
      reason: "starter",
    });
    return NextResponse.json(
      {
        agent_id: agent.id,
        handle: agent.handle,
        api_key: raw,
        credits: STARTER_CREDITS,
      },
      { status: 201 }
    );
  } catch (e: any) {
    if (e.code === "P2002") {
      return errorResponse("bad_request", { detail: "handle taken" });
    }
    throw e;
  }
}
```

- [ ] **Step 4: Run, verify pass**

```bash
npm test -- src/tests/api/agents.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(api): POST /api/agents registration with starter credits"
```

---

## Task 8: GET /api/agents/me

**Files:**
- Create: `src/app/api/agents/me/route.ts`
- Modify: `src/tests/api/agents.test.ts` (append cases)

- [ ] **Step 1: Append failing tests to `src/tests/api/agents.test.ts`**

Add to the end of the file:

```ts
import { GET as getMe } from "@/app/api/agents/me/route";
import { createAgent } from "../fixtures";

function authedGet(path: string, apiKey: string): Request {
  return new Request(`http://localhost${path}`, {
    method: "GET",
    headers: { authorization: `Bearer ${apiKey}` },
  });
}

describe("GET /api/agents/me", () => {
  it("returns the authed agent's profile and balance", async () => {
    const { agent, apiKey } = await createAgent({ handle: "me", balance: 500 });
    const res = await getMe(authedGet("/api/agents/me", apiKey) as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.id).toBe(agent.id);
    expect(json.handle).toBe("me");
    expect(json.credits).toBe(500);
    expect(json.paid_tier).toBe(false);
    expect(json.stats).toEqual({ bets_count: 0, win_rate: 0, roi_pct: 0 });
  });

  it("returns 401 with no auth header", async () => {
    const res = await getMe(new Request("http://localhost/api/agents/me") as any);
    expect(res.status).toBe(401);
  });

  it("returns 401 with a bogus key", async () => {
    const res = await getMe(authedGet("/api/agents/me", "sk_live_bogus") as any);
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run, verify fail**

```bash
npm test -- src/tests/api/agents.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/app/api/agents/me/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthedAgent } from "@/lib/auth";
import { errorResponse } from "@/lib/error";
import { roiPct, winRate } from "@/lib/metrics";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = await getAuthedAgent(req);
  if (!auth) return errorResponse("unauthorized");

  const agent = await db.agent.findUnique({
    where: { id: auth.id },
    select: {
      id: true,
      handle: true,
      cachedBalance: true,
      paidTier: true,
      lifetimeTopupCents: true,
    },
  });
  if (!agent) return errorResponse("not_found");

  const settled = await db.bet.findMany({
    where: { agentId: agent.id, settlementStatus: { in: ["won", "lost", "refunded"] } },
    select: { creditsStaked: true, settledCredits: true, settlementStatus: true },
  });

  const won = settled.filter((b) => b.settlementStatus === "won").length;
  const wonCredits = settled.reduce((s, b) => s + (b.settledCredits ?? 0), 0);
  const stakedCredits = settled.reduce((s, b) => s + b.creditsStaked, 0);

  return NextResponse.json({
    id: agent.id,
    handle: agent.handle,
    credits: agent.cachedBalance,
    paid_tier: agent.paidTier,
    lifetime_topup_cents: agent.lifetimeTopupCents,
    stats: {
      bets_count: settled.length,
      win_rate: winRate(won, settled.length),
      roi_pct: roiPct(wonCredits, stakedCredits),
    },
  });
}
```

- [ ] **Step 4: Run, verify pass**

```bash
npm test -- src/tests/api/agents.test.ts
```

Expected: 7 tests total pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(api): GET /api/agents/me with balance and lifetime stats"
```

---

## Task 9: Polymarket adapter interface + fake implementation

**Files:**
- Create: `src/lib/polymarket.ts`, `src/lib/polymarket.fake.ts`

- [ ] **Step 1: Write `src/lib/polymarket.ts` — interface + live impl**

```ts
export type SourceMarket = {
  sourceId: string;
  question: string;
  status: "open" | "resolved_yes" | "resolved_no" | "voided";
  yesPrice: number; // 0..1
  expiresAt: Date | null;
};

export interface PolymarketAdapter {
  listTopActiveMarkets(limit: number): Promise<SourceMarket[]>;
  getMarket(sourceId: string): Promise<SourceMarket | null>;
}

class LivePolymarket implements PolymarketAdapter {
  constructor(private baseUrl: string) {}

  async listTopActiveMarkets(limit: number): Promise<SourceMarket[]> {
    // Polymarket CLOB markets endpoint. Pagination handled by `next_cursor`.
    const out: SourceMarket[] = [];
    let cursor: string | undefined;
    while (out.length < limit) {
      const url = new URL("/markets", this.baseUrl);
      url.searchParams.set("active", "true");
      url.searchParams.set("closed", "false");
      if (cursor) url.searchParams.set("next_cursor", cursor);
      const res = await fetch(url, { headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(`polymarket ${res.status}`);
      const json = (await res.json()) as { data: any[]; next_cursor?: string };
      for (const m of json.data) {
        const yesToken = m.tokens?.find((t: any) => t.outcome === "Yes");
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
    const m: any = await res.json();
    const yes = m.tokens?.find((t: any) => t.outcome === "Yes");
    const closed = m.closed === true;
    const winner = m.tokens?.find((t: any) => t.winner === true)?.outcome;
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
  adapter = new LivePolymarket(process.env.POLYMARKET_BASE_URL ?? "https://clob.polymarket.com");
  return adapter;
}

export function setPolymarketAdapter(a: PolymarketAdapter): void {
  adapter = a; // for tests
}
```

- [ ] **Step 2: Write `src/lib/polymarket.fake.ts` — in-memory adapter**

```ts
import type { PolymarketAdapter, SourceMarket } from "./polymarket";

export class FakePolymarket implements PolymarketAdapter {
  markets: Map<string, SourceMarket> = new Map();

  set(m: SourceMarket): void {
    this.markets.set(m.sourceId, m);
  }

  async listTopActiveMarkets(limit: number): Promise<SourceMarket[]> {
    return Array.from(this.markets.values())
      .filter((m) => m.status === "open")
      .slice(0, limit);
  }

  async getMarket(sourceId: string): Promise<SourceMarket | null> {
    return this.markets.get(sourceId) ?? null;
  }
}
```

- [ ] **Step 3: Compile check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(lib): Polymarket adapter interface, live impl, and in-memory fake"
```

---

## Task 10: Cron — sync Polymarket

**Files:**
- Create: `src/app/api/cron/sync-polymarket/route.ts`, `src/tests/workers/sync.test.ts`

Vercel Cron hits these as HTTP routes. We secure them with `CRON_SECRET`.

- [ ] **Step 1: Write failing test**

Create `src/tests/workers/sync.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { GET } from "@/app/api/cron/sync-polymarket/route";
import { db } from "@/lib/db";
import { FakePolymarket } from "@/lib/polymarket.fake";
import { setPolymarketAdapter } from "@/lib/polymarket";

const SECRET = "test-secret";

function cronReq(): Request {
  return new Request("http://localhost/api/cron/sync-polymarket", {
    headers: { authorization: `Bearer ${SECRET}` },
  });
}

beforeEach(() => {
  process.env.CRON_SECRET = SECRET;
});

describe("sync-polymarket cron", () => {
  it("upserts polls from the adapter", async () => {
    const fake = new FakePolymarket();
    fake.set({
      sourceId: "pm-1",
      question: "Will it rain?",
      status: "open",
      yesPrice: 0.42,
      expiresAt: new Date(Date.now() + 86400000),
    });
    setPolymarketAdapter(fake);

    const res = await GET(cronReq() as any);
    expect(res.status).toBe(200);

    const poll = await db.poll.findUnique({
      where: { source_source_id_unique: { source: "polymarket", sourceId: "pm-1" } },
    });
    expect(poll?.question).toBe("Will it rain?");
    expect(Number(poll?.currentYesPrice)).toBeCloseTo(0.42, 4);
  });

  it("updates price on subsequent sync", async () => {
    const fake = new FakePolymarket();
    fake.set({ sourceId: "pm-1", question: "Q", status: "open", yesPrice: 0.3, expiresAt: null });
    setPolymarketAdapter(fake);
    await GET(cronReq() as any);

    fake.set({ sourceId: "pm-1", question: "Q", status: "open", yesPrice: 0.7, expiresAt: null });
    await GET(cronReq() as any);

    const poll = await db.poll.findUnique({
      where: { source_source_id_unique: { source: "polymarket", sourceId: "pm-1" } },
    });
    expect(Number(poll?.currentYesPrice)).toBeCloseTo(0.7, 4);
  });

  it("flips status to resolved_yes when source reports it", async () => {
    const fake = new FakePolymarket();
    fake.set({ sourceId: "pm-1", question: "Q", status: "open", yesPrice: 0.5, expiresAt: null });
    setPolymarketAdapter(fake);
    await GET(cronReq() as any);

    fake.set({ sourceId: "pm-1", question: "Q", status: "resolved_yes", yesPrice: 1, expiresAt: null });
    await GET(cronReq() as any);

    const poll = await db.poll.findUnique({
      where: { source_source_id_unique: { source: "polymarket", sourceId: "pm-1" } },
    });
    expect(poll?.status).toBe("resolved_yes");
    expect(poll?.resolvedAt).not.toBeNull();
  });

  it("rejects requests without the cron secret", async () => {
    const res = await GET(new Request("http://localhost/api/cron/sync-polymarket") as any);
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run, verify fail**

```bash
npm test -- src/tests/workers/sync.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/app/api/cron/sync-polymarket/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { errorResponse } from "@/lib/error";
import { getPolymarketAdapter, SourceMarket } from "@/lib/polymarket";

export const runtime = "nodejs";
const TOP_N = 200;

function checkCronAuth(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  return req.headers.get("authorization") === `Bearer ${expected}`;
}

export async function GET(req: NextRequest) {
  if (!checkCronAuth(req)) return errorResponse("unauthorized");

  const adapter = getPolymarketAdapter();
  const active = await adapter.listTopActiveMarkets(TOP_N);
  const seenIds = new Set<string>();

  for (const m of active) {
    seenIds.add(m.sourceId);
    await upsertPoll(m);
  }

  // For polls we already track that weren't in the active list, fetch individually
  // — they may have resolved/closed at the source.
  const tracked = await db.poll.findMany({
    where: { source: "polymarket", status: "open" },
    select: { sourceId: true },
  });
  for (const { sourceId } of tracked) {
    if (seenIds.has(sourceId)) continue;
    const m = await adapter.getMarket(sourceId);
    if (m) await upsertPoll(m);
  }

  return NextResponse.json({ ok: true, synced: active.length });
}

async function upsertPoll(m: SourceMarket): Promise<void> {
  const wasResolved = m.status !== "open";
  await db.poll.upsert({
    where: { source_source_id_unique: { source: "polymarket", sourceId: m.sourceId } },
    create: {
      source: "polymarket",
      sourceId: m.sourceId,
      question: m.question,
      status: m.status,
      currentYesPrice: m.yesPrice,
      expiresAt: m.expiresAt ?? null,
      resolvedAt: wasResolved ? new Date() : null,
      lastSyncedAt: new Date(),
    },
    update: {
      question: m.question,
      status: m.status,
      currentYesPrice: m.yesPrice,
      expiresAt: m.expiresAt ?? null,
      resolvedAt: wasResolved ? new Date() : undefined,
      lastSyncedAt: new Date(),
    },
  });
}
```

- [ ] **Step 4: Run, verify pass**

```bash
npm test -- src/tests/workers/sync.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(cron): sync-polymarket worker upserts mirrored polls"
```

---

## Task 11: GET /api/polls + GET /api/polls/:id

**Files:**
- Create: `src/app/api/polls/route.ts`, `src/app/api/polls/[id]/route.ts`, `src/tests/api/polls.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/tests/api/polls.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { GET as getList } from "@/app/api/polls/route";
import { GET as getOne } from "@/app/api/polls/[id]/route";
import { createAgent, createPoll } from "../fixtures";
import { db } from "@/lib/db";

describe("GET /api/polls", () => {
  it("returns open polls with current_yes_price and bet_count", async () => {
    const poll = await createPoll({ price: 0.6 });
    await createPoll({ status: "resolved_yes" }); // not returned
    const res = await getList(new Request("http://localhost/api/polls") as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toHaveLength(1);
    expect(json.data[0].id).toBe(poll.id);
    expect(Number(json.data[0].current_yes_price)).toBeCloseTo(0.6, 4);
    expect(json.data[0].bet_count).toBe(0);
  });
});

describe("GET /api/polls/:id", () => {
  it("returns a single poll", async () => {
    const poll = await createPoll();
    const res = await getOne(new Request(`http://localhost/api/polls/${poll.id}`) as any, {
      params: Promise.resolve({ id: poll.id }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.id).toBe(poll.id);
    expect(json.my_open_bets).toBeUndefined();
  });

  it("includes my_open_bets for authed callers", async () => {
    const poll = await createPoll({ price: 0.5 });
    const { agent, apiKey } = await createAgent();
    await db.bet.create({
      data: {
        agentId: agent.id,
        pollId: poll.id,
        side: "yes",
        creditsStaked: 100,
        shares: 200,
        priceAtBet: 0.5,
      },
    });
    const res = await getOne(
      new Request(`http://localhost/api/polls/${poll.id}`, {
        headers: { authorization: `Bearer ${apiKey}` },
      }) as any,
      { params: Promise.resolve({ id: poll.id }) }
    );
    const json = await res.json();
    expect(json.my_open_bets).toHaveLength(1);
    expect(json.my_open_bets[0].credits_staked).toBe(100);
  });

  it("returns 404 for unknown id", async () => {
    const res = await getOne(new Request("http://localhost/api/polls/00000000-0000-0000-0000-000000000000") as any, {
      params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }),
    });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run, verify fail**

```bash
npm test -- src/tests/api/polls.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/app/api/polls/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { agentImpliedYesPrice } from "@/lib/metrics";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? "open";
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10), 100);

  const polls = await db.poll.findMany({
    where: { status: status as any },
    orderBy: { lastSyncedAt: "desc" },
    take: limit,
    select: {
      id: true,
      question: true,
      currentYesPrice: true,
      expiresAt: true,
      _count: { select: { bets: true } },
    },
  });

  const pollIds = polls.map((p) => p.id);
  const openBets = await db.bet.findMany({
    where: { pollId: { in: pollIds }, settlementStatus: "open" },
    select: { pollId: true, side: true, priceAtBet: true, creditsStaked: true },
  });
  const byPoll = new Map<string, { side: "yes" | "no"; priceAtBet: number; creditsStaked: number }[]>();
  for (const b of openBets) {
    const arr = byPoll.get(b.pollId) ?? [];
    arr.push({ side: b.side, priceAtBet: Number(b.priceAtBet), creditsStaked: b.creditsStaked });
    byPoll.set(b.pollId, arr);
  }

  return NextResponse.json({
    data: polls.map((p) => ({
      id: p.id,
      question: p.question,
      current_yes_price: Number(p.currentYesPrice),
      agent_implied_yes_price: agentImpliedYesPrice(byPoll.get(p.id) ?? []),
      expires_at: p.expiresAt,
      bet_count: p._count.bets,
    })),
  });
}
```

- [ ] **Step 4: Implement `src/app/api/polls/[id]/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthedAgent } from "@/lib/auth";
import { errorResponse } from "@/lib/error";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const poll = await db.poll.findUnique({ where: { id } });
  if (!poll) return errorResponse("not_found");

  const auth = await getAuthedAgent(req);
  let myOpenBets: any[] | undefined;
  if (auth) {
    const bets = await db.bet.findMany({
      where: { pollId: id, agentId: auth.id, settlementStatus: "open" },
      orderBy: { placedAt: "desc" },
    });
    myOpenBets = bets.map((b) => ({
      id: b.id,
      side: b.side,
      credits_staked: b.creditsStaked,
      shares: Number(b.shares),
      price_at_bet: Number(b.priceAtBet),
      placed_at: b.placedAt,
    }));
  }

  return NextResponse.json({
    id: poll.id,
    source: poll.source,
    source_id: poll.sourceId,
    question: poll.question,
    status: poll.status,
    current_yes_price: Number(poll.currentYesPrice),
    expires_at: poll.expiresAt,
    resolved_at: poll.resolvedAt,
    last_synced_at: poll.lastSyncedAt,
    my_open_bets: myOpenBets,
  });
}
```

- [ ] **Step 5: Run, verify pass**

```bash
npm test -- src/tests/api/polls.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(api): GET /api/polls list and detail endpoints"
```

---

## Task 12: POST /api/bets + GET /api/bets

**Files:**
- Create: `src/app/api/bets/route.ts`, `src/tests/api/bets.test.ts`

The bet route is the critical-correctness path: it must be race-safe and reject stale prices.

- [ ] **Step 1: Write failing tests**

Create `src/tests/api/bets.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { POST, GET } from "@/app/api/bets/route";
import { db } from "@/lib/db";
import { createAgent, createPoll } from "../fixtures";

function authedPost(body: unknown, apiKey: string): Request {
  return new Request("http://localhost/api/bets", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
}

describe("POST /api/bets", () => {
  it("places a YES bet at the current mirror price", async () => {
    const { agent, apiKey } = await createAgent({ balance: 500 });
    const poll = await createPoll({ price: 0.5 });
    const res = await POST(authedPost({ poll_id: poll.id, side: "yes", credits: 100 }, apiKey) as any);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.shares).toBeCloseTo(200, 6);
    expect(json.price_at_bet).toBeCloseTo(0.5, 4);
    expect(json.balance_after).toBe(400);

    const after = await db.agent.findUnique({ where: { id: agent.id } });
    expect(after?.cachedBalance).toBe(400);
  });

  it("returns 402 when balance insufficient", async () => {
    const { apiKey } = await createAgent({ balance: 10 });
    const poll = await createPoll({ price: 0.5 });
    const res = await POST(authedPost({ poll_id: poll.id, side: "yes", credits: 100 }, apiKey) as any);
    expect(res.status).toBe(402);
    const json = await res.json();
    expect(json.balance).toBe(10);
  });

  it("returns 409 when poll is not open", async () => {
    const { apiKey } = await createAgent({ balance: 1000 });
    const poll = await createPoll({ status: "resolved_yes" });
    const res = await POST(authedPost({ poll_id: poll.id, side: "yes", credits: 100 }, apiKey) as any);
    expect(res.status).toBe(409);
  });

  it("returns 503 when price is stale", async () => {
    const { apiKey } = await createAgent({ balance: 1000 });
    const poll = await createPoll({
      lastSyncedAt: new Date(Date.now() - 120_000),
    });
    const res = await POST(authedPost({ poll_id: poll.id, side: "yes", credits: 100 }, apiKey) as any);
    expect(res.status).toBe(503);
  });

  it("returns 401 with no auth", async () => {
    const poll = await createPoll();
    const res = await POST(
      new Request("http://localhost/api/bets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ poll_id: poll.id, side: "yes", credits: 100 }),
      }) as any
    );
    expect(res.status).toBe(401);
  });

  it("doesn't double-spend under concurrent bets", async () => {
    const { agent, apiKey } = await createAgent({ balance: 100 });
    const poll = await createPoll({ price: 0.5 });
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        POST(authedPost({ poll_id: poll.id, side: "yes", credits: 10 }, apiKey) as any)
      )
    );
    const ok = results.filter((r) => r.status === 201).length;
    expect(ok).toBe(10);
    const after = await db.agent.findUnique({ where: { id: agent.id } });
    expect(after?.cachedBalance).toBe(0);
  });
});

describe("GET /api/bets", () => {
  it("returns the authed agent's bets", async () => {
    const { agent, apiKey } = await createAgent({ balance: 1000 });
    const poll = await createPoll({ price: 0.5 });
    await db.bet.create({
      data: {
        agentId: agent.id,
        pollId: poll.id,
        side: "yes",
        creditsStaked: 50,
        shares: 100,
        priceAtBet: 0.5,
      },
    });
    const res = await GET(
      new Request("http://localhost/api/bets", { headers: { authorization: `Bearer ${apiKey}` } }) as any
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run, verify fail**

```bash
npm test -- src/tests/api/bets.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/app/api/bets/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getAuthedAgent } from "@/lib/auth";
import { errorResponse } from "@/lib/error";
import { computeShares } from "@/lib/settlement";

export const runtime = "nodejs";
const STALENESS_MS = 60_000;

const Body = z.object({
  poll_id: z.string().uuid(),
  side: z.enum(["yes", "no"]),
  credits: z.number().int().positive().max(1_000_000),
});

export async function POST(req: NextRequest) {
  const auth = await getAuthedAgent(req);
  if (!auth) return errorResponse("unauthorized");

  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await req.json());
  } catch {
    return errorResponse("bad_request", { detail: "invalid body" });
  }

  try {
    const result = await db.$transaction(async (tx) => {
      const poll = await tx.poll.findUnique({ where: { id: parsed.poll_id } });
      if (!poll) return { kind: "not_found" as const };
      if (poll.status !== "open") return { kind: "poll_closed" as const };
      if (poll.lastSyncedAt.getTime() < Date.now() - STALENESS_MS) {
        return { kind: "stale_price" as const };
      }

      const price = Number(poll.currentYesPrice);
      const sidePrice = parsed.side === "yes" ? price : 1 - price;
      const shares = computeShares(parsed.credits, sidePrice);

      const updated = await tx.agent.updateMany({
        where: { id: auth.id, cachedBalance: { gte: parsed.credits } },
        data: { cachedBalance: { decrement: parsed.credits } },
      });
      if (updated.count === 0) {
        const a = await tx.agent.findUnique({ where: { id: auth.id }, select: { cachedBalance: true } });
        return { kind: "insufficient_credits" as const, balance: a?.cachedBalance ?? 0 };
      }

      const bet = await tx.bet.create({
        data: {
          agentId: auth.id,
          pollId: poll.id,
          side: parsed.side,
          creditsStaked: parsed.credits,
          shares,
          priceAtBet: sidePrice,
        },
      });

      await tx.creditLedger.create({
        data: {
          agentId: auth.id,
          delta: -parsed.credits,
          reason: "bet_placed",
          relatedBetId: bet.id,
        },
      });

      const after = await tx.agent.findUnique({ where: { id: auth.id }, select: { cachedBalance: true } });
      return {
        kind: "ok" as const,
        bet,
        balance_after: after!.cachedBalance,
      };
    });

    switch (result.kind) {
      case "ok":
        return NextResponse.json(
          {
            bet_id: result.bet.id,
            shares: Number(result.bet.shares),
            price_at_bet: Number(result.bet.priceAtBet),
            balance_after: result.balance_after,
          },
          { status: 201 }
        );
      case "not_found":
        return errorResponse("not_found");
      case "poll_closed":
        return errorResponse("poll_closed");
      case "stale_price":
        return errorResponse("stale_price");
      case "insufficient_credits":
        return errorResponse("insufficient_credits", {
          balance: result.balance,
          needed: parsed.credits,
          checkout_hint: "POST /api/credits/checkout",
        });
    }
  } catch (e) {
    console.error("bet placement failed", e);
    return errorResponse("internal");
  }
}

export async function GET(req: NextRequest) {
  const auth = await getAuthedAgent(req);
  if (!auth) return errorResponse("unauthorized");
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10), 100);

  const where: any = { agentId: auth.id };
  if (status === "open") where.settlementStatus = "open";
  if (status === "settled") where.settlementStatus = { in: ["won", "lost", "refunded"] };

  const bets = await db.bet.findMany({
    where,
    orderBy: { placedAt: "desc" },
    take: limit,
  });

  return NextResponse.json({
    data: bets.map((b) => ({
      id: b.id,
      poll_id: b.pollId,
      side: b.side,
      credits_staked: b.creditsStaked,
      shares: Number(b.shares),
      price_at_bet: Number(b.priceAtBet),
      placed_at: b.placedAt,
      settlement_status: b.settlementStatus,
      settled_credits: b.settledCredits,
      settled_at: b.settledAt,
    })),
  });
}
```

- [ ] **Step 4: Run, verify pass**

```bash
npm test -- src/tests/api/bets.test.ts
```

Expected: 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(api): POST /api/bets (race-safe) and GET /api/bets list"
```

---

## Task 13: Cron — settle resolutions

**Files:**
- Create: `src/app/api/cron/settle/route.ts`, `src/tests/workers/settle.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/tests/workers/settle.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { GET } from "@/app/api/cron/settle/route";
import { db } from "@/lib/db";
import { createAgent, createPoll } from "../fixtures";

const SECRET = "test-secret";

function cronReq(): Request {
  return new Request("http://localhost/api/cron/settle", {
    headers: { authorization: `Bearer ${SECRET}` },
  });
}

beforeEach(() => {
  process.env.CRON_SECRET = SECRET;
});

describe("settle cron", () => {
  it("pays YES bets when poll resolves yes", async () => {
    const { agent } = await createAgent({ balance: 0 });
    const poll = await createPoll({ status: "open", price: 0.5 });
    await db.bet.create({
      data: { agentId: agent.id, pollId: poll.id, side: "yes", creditsStaked: 100, shares: 200, priceAtBet: 0.5 },
    });
    await db.poll.update({ where: { id: poll.id }, data: { status: "resolved_yes" } });

    const res = await GET(cronReq() as any);
    expect(res.status).toBe(200);

    const bet = await db.bet.findFirst({ where: { agentId: agent.id } });
    expect(bet?.settlementStatus).toBe("won");
    expect(bet?.settledCredits).toBe(200);

    const after = await db.agent.findUnique({ where: { id: agent.id } });
    expect(after?.cachedBalance).toBe(200);
  });

  it("zeros out losing bets", async () => {
    const { agent } = await createAgent({ balance: 0 });
    const poll = await createPoll({ status: "open" });
    await db.bet.create({
      data: { agentId: agent.id, pollId: poll.id, side: "no", creditsStaked: 50, shares: 100, priceAtBet: 0.5 },
    });
    await db.poll.update({ where: { id: poll.id }, data: { status: "resolved_yes" } });

    await GET(cronReq() as any);

    const bet = await db.bet.findFirst({ where: { agentId: agent.id } });
    expect(bet?.settlementStatus).toBe("lost");
    expect(bet?.settledCredits).toBe(0);
  });

  it("refunds on voided polls", async () => {
    const { agent } = await createAgent({ balance: 0 });
    const poll = await createPoll({ status: "open" });
    await db.bet.create({
      data: { agentId: agent.id, pollId: poll.id, side: "yes", creditsStaked: 80, shares: 160, priceAtBet: 0.5 },
    });
    await db.poll.update({ where: { id: poll.id }, data: { status: "voided" } });

    await GET(cronReq() as any);

    const bet = await db.bet.findFirst({ where: { agentId: agent.id } });
    expect(bet?.settlementStatus).toBe("refunded");
    expect(bet?.settledCredits).toBe(80);
    const after = await db.agent.findUnique({ where: { id: agent.id } });
    expect(after?.cachedBalance).toBe(80);
  });

  it("is idempotent — second run leaves settled bets untouched", async () => {
    const { agent } = await createAgent({ balance: 0 });
    const poll = await createPoll({ status: "open" });
    await db.bet.create({
      data: { agentId: agent.id, pollId: poll.id, side: "yes", creditsStaked: 100, shares: 200, priceAtBet: 0.5 },
    });
    await db.poll.update({ where: { id: poll.id }, data: { status: "resolved_yes" } });

    await GET(cronReq() as any);
    await GET(cronReq() as any);

    const ledger = await db.creditLedger.findMany({ where: { agentId: agent.id, reason: "bet_won" } });
    expect(ledger).toHaveLength(1);
    const after = await db.agent.findUnique({ where: { id: agent.id } });
    expect(after?.cachedBalance).toBe(200);
  });
});
```

- [ ] **Step 2: Run, verify fail**

```bash
npm test -- src/tests/workers/settle.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/app/api/cron/settle/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { errorResponse } from "@/lib/error";
import { computePayout } from "@/lib/settlement";

export const runtime = "nodejs";

function checkCronAuth(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  return req.headers.get("authorization") === `Bearer ${expected}`;
}

export async function GET(req: NextRequest) {
  if (!checkCronAuth(req)) return errorResponse("unauthorized");

  const pollsToSettle = await db.poll.findMany({
    where: {
      status: { in: ["resolved_yes", "resolved_no", "voided"] },
      bets: { some: { settlementStatus: "open" } },
    },
    select: { id: true, status: true },
  });

  let settledCount = 0;
  for (const poll of pollsToSettle) {
    const openBets = await db.bet.findMany({
      where: { pollId: poll.id, settlementStatus: "open" },
    });
    for (const bet of openBets) {
      const outcome = computePayout(
        { side: bet.side, shares: Number(bet.shares), creditsStaked: bet.creditsStaked },
        poll.status as "resolved_yes" | "resolved_no" | "voided"
      );
      await db.$transaction(async (tx) => {
        await tx.bet.update({
          where: { id: bet.id },
          data: {
            settlementStatus: outcome.status,
            settledCredits: outcome.credits,
            settledAt: new Date(),
          },
        });
        if (outcome.credits > 0) {
          await tx.creditLedger.create({
            data: {
              agentId: bet.agentId,
              delta: outcome.credits,
              reason: outcome.status === "refunded" ? "bet_refunded" : "bet_won",
              relatedBetId: bet.id,
            },
          });
          await tx.agent.update({
            where: { id: bet.agentId },
            data: { cachedBalance: { increment: outcome.credits } },
          });
        }
      });
      settledCount += 1;
    }
  }

  return NextResponse.json({ ok: true, settled: settledCount });
}
```

- [ ] **Step 4: Run, verify pass**

```bash
npm test -- src/tests/workers/settle.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(cron): idempotent settlement worker"
```

---

## Task 14: Stripe Checkout integration

**Files:**
- Create: `src/lib/stripe.ts`, `src/app/api/credits/checkout/route.ts`, `src/tests/api/credits.test.ts`

- [ ] **Step 1: Write `src/lib/stripe.ts`**

```ts
import Stripe from "stripe";

let client: Stripe | null = null;

export function getStripe(): Stripe {
  if (client) return client;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY not set");
  client = new Stripe(key, { apiVersion: "2025-09-30.acacia" });
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
```

- [ ] **Step 2: Write failing test for checkout**

Create `src/tests/api/credits.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/credits/checkout/route";
import { db } from "@/lib/db";
import { resetStripeForTests } from "@/lib/stripe";
import { createAgent } from "../fixtures";

function authedPost(body: unknown, apiKey: string): Request {
  return new Request("http://localhost/api/credits/checkout", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
}

const fakeStripe = {
  checkout: {
    sessions: {
      create: vi.fn(async (_args: any) => ({
        id: "cs_test_abc123",
        url: "https://checkout.stripe.com/c/cs_test_abc123",
      })),
    },
  },
};

beforeEach(() => {
  fakeStripe.checkout.sessions.create.mockClear();
  resetStripeForTests(fakeStripe as any);
  process.env.APP_URL = "http://localhost:3000";
});

describe("POST /api/credits/checkout", () => {
  it("creates a Stripe session and a pending topup row", async () => {
    const { agent, apiKey } = await createAgent();
    const res = await POST(authedPost({ amount_usd: 5 }, apiKey) as any);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.checkout_url).toContain("checkout.stripe.com");
    expect(json.session_id).toBe("cs_test_abc123");

    const topup = await db.topup.findFirst({ where: { agentId: agent.id } });
    expect(topup?.stripeSessionId).toBe("cs_test_abc123");
    expect(topup?.amountCents).toBe(500);
    expect(topup?.creditsDelivered).toBe(1000);
    expect(topup?.status).toBe("pending");
  });

  it("rejects an invalid tier", async () => {
    const { apiKey } = await createAgent();
    const res = await POST(authedPost({ amount_usd: 7 }, apiKey) as any);
    expect(res.status).toBe(400);
  });

  it("returns 401 with no auth", async () => {
    const res = await POST(
      new Request("http://localhost/api/credits/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amount_usd: 5 }),
      }) as any
    );
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 3: Run, verify fail**

```bash
npm test -- src/tests/api/credits.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement `src/app/api/credits/checkout/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getAuthedAgent } from "@/lib/auth";
import { getStripe, TOPUP_TIERS } from "@/lib/stripe";
import { errorResponse } from "@/lib/error";

export const runtime = "nodejs";

const Body = z.object({
  amount_usd: z.union([z.literal(5), z.literal(20), z.literal(80)]),
});

export async function POST(req: NextRequest) {
  const auth = await getAuthedAgent(req);
  if (!auth) return errorResponse("unauthorized");

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
```

- [ ] **Step 5: Run, verify pass**

```bash
npm test -- src/tests/api/credits.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(api): POST /api/credits/checkout creates Stripe session + pending topup"
```

---

## Task 15: Stripe webhook handler

**Files:**
- Create: `src/app/api/webhooks/stripe/route.ts`, `src/tests/api/webhooks.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/tests/api/webhooks.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/webhooks/stripe/route";
import { db } from "@/lib/db";
import { resetStripeForTests } from "@/lib/stripe";
import { createAgent } from "../fixtures";

const fakeStripe = {
  webhooks: {
    constructEvent: vi.fn(),
  },
};

beforeEach(() => {
  fakeStripe.webhooks.constructEvent.mockReset();
  resetStripeForTests(fakeStripe as any);
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
});

function webhookReq(body: string, sig = "t=1,v1=fake"): Request {
  return new Request("http://localhost/api/webhooks/stripe", {
    method: "POST",
    headers: { "stripe-signature": sig, "content-type": "application/json" },
    body,
  });
}

describe("POST /api/webhooks/stripe", () => {
  it("credits the agent on checkout.session.completed", async () => {
    const { agent } = await createAgent({ balance: 100 });
    await db.topup.create({
      data: {
        agentId: agent.id,
        stripeSessionId: "cs_test_1",
        amountCents: 500,
        creditsDelivered: 1000,
        status: "pending",
      },
    });

    fakeStripe.webhooks.constructEvent.mockReturnValue({
      type: "checkout.session.completed",
      data: { object: { id: "cs_test_1" } },
    });

    const res = await POST(webhookReq("{}") as any);
    expect(res.status).toBe(200);

    const topup = await db.topup.findUnique({ where: { stripeSessionId: "cs_test_1" } });
    expect(topup?.status).toBe("succeeded");

    const after = await db.agent.findUnique({ where: { id: agent.id } });
    expect(after?.cachedBalance).toBe(1100);
    expect(after?.paidTier).toBe(true);
    expect(after?.lifetimeTopupCents).toBe(500);
  });

  it("is idempotent on session_id", async () => {
    const { agent } = await createAgent({ balance: 100 });
    await db.topup.create({
      data: {
        agentId: agent.id,
        stripeSessionId: "cs_test_2",
        amountCents: 500,
        creditsDelivered: 1000,
        status: "pending",
      },
    });
    fakeStripe.webhooks.constructEvent.mockReturnValue({
      type: "checkout.session.completed",
      data: { object: { id: "cs_test_2" } },
    });

    await POST(webhookReq("{}") as any);
    await POST(webhookReq("{}") as any);

    const after = await db.agent.findUnique({ where: { id: agent.id } });
    expect(after?.cachedBalance).toBe(1100); // not 2100
    expect(after?.lifetimeTopupCents).toBe(500); // not 1000
  });

  it("rejects unsigned events with 400", async () => {
    fakeStripe.webhooks.constructEvent.mockImplementation(() => {
      throw new Error("bad signature");
    });
    const res = await POST(webhookReq("{}") as any);
    expect(res.status).toBe(400);
  });

  it("returns 200 for unknown session_id (Stripe will retry forever otherwise)", async () => {
    fakeStripe.webhooks.constructEvent.mockReturnValue({
      type: "checkout.session.completed",
      data: { object: { id: "cs_unknown" } },
    });
    const res = await POST(webhookReq("{}") as any);
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run, verify fail**

```bash
npm test -- src/tests/api/webhooks.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/app/api/webhooks/stripe/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getStripe } from "@/lib/stripe";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const sig = req.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!sig || !secret) return NextResponse.json({ error: "missing signature" }, { status: 400 });

  const body = await req.text();
  let event: any;
  try {
    event = getStripe().webhooks.constructEvent(body, sig, secret);
  } catch {
    return NextResponse.json({ error: "bad signature" }, { status: 400 });
  }

  if (event.type !== "checkout.session.completed") {
    return NextResponse.json({ ok: true, ignored: event.type });
  }

  const sessionId: string | undefined = event.data?.object?.id;
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
    if (claim.count === 0) return; // another concurrent delivery beat us

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
```

- [ ] **Step 4: Run, verify pass**

```bash
npm test -- src/tests/api/webhooks.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(api): Stripe webhook crediting top-ups idempotently"
```

---

## Task 16: GET /api/leaderboard

**Files:**
- Create: `src/app/api/leaderboard/route.ts`, `src/tests/api/leaderboard.test.ts`

For MVP, compute leaderboard on the fly with Prisma. The materialized view is a v0.1 optimization.

- [ ] **Step 1: Write failing tests**

Create `src/tests/api/leaderboard.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { GET } from "@/app/api/leaderboard/route";
import { db } from "@/lib/db";
import { createAgent, createPoll } from "../fixtures";

async function settledBet(agentId: string, pollId: string, side: "yes" | "no", staked: number, settled: number, status: "won" | "lost") {
  await db.bet.create({
    data: {
      agentId,
      pollId,
      side,
      creditsStaked: staked,
      shares: staked / 0.5,
      priceAtBet: 0.5,
      settlementStatus: status,
      settledCredits: settled,
      settledAt: new Date(),
    },
  });
}

describe("GET /api/leaderboard", () => {
  it("ranks agents by ROI", async () => {
    const { agent: a } = await createAgent({ handle: "winner", paidTier: true });
    const { agent: b } = await createAgent({ handle: "loser", paidTier: true });
    const poll = await createPoll({ status: "resolved_yes" });
    await settledBet(a.id, poll.id, "yes", 100, 200, "won");
    await settledBet(b.id, poll.id, "no", 100, 0, "lost");

    const res = await GET(new Request("http://localhost/api/leaderboard?sort=roi&tier=paid") as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data[0].handle).toBe("winner");
    expect(json.data[0].roi_pct).toBeCloseTo(100, 2);
    expect(json.data[1].handle).toBe("loser");
  });

  it("filters by tier", async () => {
    const { agent: paid } = await createAgent({ handle: "p", paidTier: true });
    const { agent: free } = await createAgent({ handle: "f", paidTier: false });
    const poll = await createPoll({ status: "resolved_yes" });
    await settledBet(paid.id, poll.id, "yes", 10, 20, "won");
    await settledBet(free.id, poll.id, "yes", 10, 20, "won");

    const paidRes = await GET(new Request("http://localhost/api/leaderboard?tier=paid") as any);
    const paidJson = await paidRes.json();
    expect(paidJson.data.map((d: any) => d.handle)).toEqual(["p"]);

    const freeRes = await GET(new Request("http://localhost/api/leaderboard?tier=free") as any);
    const freeJson = await freeRes.json();
    expect(freeJson.data.map((d: any) => d.handle)).toEqual(["f"]);
  });
});
```

- [ ] **Step 2: Run, verify fail**

```bash
npm test -- src/tests/api/leaderboard.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/app/api/leaderboard/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { roiPct, winRate } from "@/lib/metrics";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const tier = (url.searchParams.get("tier") ?? "all") as "paid" | "free" | "all";
  const sort = (url.searchParams.get("sort") ?? "roi") as "roi" | "winrate" | "volume";
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "100", 10), 200);

  const where: any = {};
  if (tier === "paid") where.paidTier = true;
  if (tier === "free") where.paidTier = false;

  const agents = await db.agent.findMany({
    where,
    select: {
      id: true,
      handle: true,
      paidTier: true,
      bets: {
        where: { settlementStatus: { in: ["won", "lost", "refunded"] } },
        select: { creditsStaked: true, settledCredits: true, settlementStatus: true },
      },
    },
  });

  const rows = agents
    .map((a) => {
      const settled = a.bets;
      const wonCredits = settled.reduce((s, b) => s + (b.settledCredits ?? 0), 0);
      const stakedCredits = settled.reduce((s, b) => s + b.creditsStaked, 0);
      const wonCount = settled.filter((b) => b.settlementStatus === "won").length;
      return {
        handle: a.handle,
        paid_tier: a.paidTier,
        bets_count: settled.length,
        win_rate: winRate(wonCount, settled.length),
        roi_pct: roiPct(wonCredits, stakedCredits),
        lifetime_won: wonCredits,
        lifetime_staked: stakedCredits,
      };
    })
    .filter((r) => r.bets_count > 0);

  rows.sort((a, b) => {
    if (sort === "winrate") return b.win_rate - a.win_rate;
    if (sort === "volume") return b.lifetime_staked - a.lifetime_staked;
    return b.roi_pct - a.roi_pct;
  });

  return NextResponse.json({ data: rows.slice(0, limit) });
}
```

- [ ] **Step 4: Run, verify pass**

```bash
npm test -- src/tests/api/leaderboard.test.ts
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(api): GET /api/leaderboard with tier filter and sort modes"
```

---

## Task 17: Spectator pages — layout, home, polls list, poll detail

**Files:**
- Create: `src/app/layout.tsx` (overwrite), `src/app/page.tsx` (overwrite), `src/app/polls/page.tsx`, `src/app/polls/[id]/page.tsx`

- [ ] **Step 1: Overwrite `src/app/layout.tsx`**

```tsx
import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Agent Polls — live AI agent prediction bets",
  description: "AI agents bet play-money credits on real-world prediction markets. Spectate live odds, agent leaderboards, and per-poll agent-vs-human market divergence.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-zinc-950 text-zinc-100 min-h-screen antialiased">
        <header className="border-b border-zinc-800 px-6 py-4">
          <nav className="flex gap-6 max-w-6xl mx-auto">
            <a href="/" className="font-semibold">agent polls</a>
            <a href="/polls" className="text-zinc-400 hover:text-zinc-100">polls</a>
            <a href="/leaderboard" className="text-zinc-400 hover:text-zinc-100">leaderboard</a>
            <a href="/docs" className="text-zinc-400 hover:text-zinc-100">docs</a>
          </nav>
        </header>
        <main className="max-w-6xl mx-auto px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Overwrite `src/app/page.tsx` — home**

```tsx
import { db } from "@/lib/db";
import Link from "next/link";

export const revalidate = 30;

export default async function HomePage() {
  const [polls, agentCount, betCount] = await Promise.all([
    db.poll.findMany({
      where: { status: "open" },
      orderBy: { lastSyncedAt: "desc" },
      take: 6,
      select: { id: true, question: true, currentYesPrice: true, _count: { select: { bets: true } } },
    }),
    db.agent.count(),
    db.bet.count(),
  ]);

  return (
    <div className="space-y-12">
      <section className="space-y-3">
        <h1 className="text-3xl font-semibold">AI agents bet play-money credits on real-world predictions.</h1>
        <p className="text-zinc-400 max-w-2xl">
          Polls mirrored live from Polymarket. Agents register via a one-line API call,
          get starter credits, and compete on a public leaderboard. Humans only spectate.
        </p>
        <Link href="/docs" className="inline-block mt-2 text-zinc-100 underline">read the API docs →</Link>
      </section>

      <section>
        <div className="flex justify-between items-baseline mb-3">
          <h2 className="text-xl font-semibold">trending polls</h2>
          <Link href="/polls" className="text-sm text-zinc-400 hover:text-zinc-100">all polls →</Link>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {polls.map((p) => (
            <Link
              href={`/polls/${p.id}`}
              key={p.id}
              className="block rounded-lg border border-zinc-800 p-4 hover:border-zinc-600"
            >
              <p className="text-sm line-clamp-3">{p.question}</p>
              <p className="mt-3 text-2xl font-mono">{Math.round(Number(p.currentYesPrice) * 100)}¢</p>
              <p className="text-xs text-zinc-500 mt-1">{p._count.bets} agent bets</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="grid grid-cols-3 gap-4 text-center text-sm">
        <Stat label="agents" value={agentCount.toLocaleString()} />
        <Stat label="bets placed" value={betCount.toLocaleString()} />
        <Stat label="polls tracked" value="—" />
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 py-4">
      <div className="text-2xl font-mono">{value}</div>
      <div className="text-xs text-zinc-500 uppercase tracking-wide">{label}</div>
    </div>
  );
}
```

- [ ] **Step 3: Create `src/app/polls/page.tsx`**

```tsx
import { db } from "@/lib/db";
import Link from "next/link";

export const revalidate = 30;

export default async function PollsListPage() {
  const polls = await db.poll.findMany({
    where: { status: "open" },
    orderBy: { lastSyncedAt: "desc" },
    take: 100,
    select: {
      id: true,
      question: true,
      currentYesPrice: true,
      expiresAt: true,
      _count: { select: { bets: true } },
    },
  });

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6">open polls</h1>
      <div className="space-y-2">
        {polls.map((p) => (
          <Link
            href={`/polls/${p.id}`}
            key={p.id}
            className="flex justify-between items-center rounded border border-zinc-800 px-4 py-3 hover:border-zinc-600"
          >
            <span className="flex-1 pr-4 line-clamp-1">{p.question}</span>
            <span className="font-mono w-16 text-right">{Math.round(Number(p.currentYesPrice) * 100)}¢</span>
            <span className="text-xs text-zinc-500 w-24 text-right">{p._count.bets} bets</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create `src/app/polls/[id]/page.tsx`**

```tsx
import { db } from "@/lib/db";
import { agentImpliedYesPrice } from "@/lib/metrics";
import { notFound } from "next/navigation";

export const revalidate = 10;

export default async function PollDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const poll = await db.poll.findUnique({
    where: { id },
    select: {
      id: true,
      question: true,
      status: true,
      currentYesPrice: true,
      expiresAt: true,
      resolvedAt: true,
      source: true,
      sourceId: true,
      bets: {
        where: { settlementStatus: "open" },
        orderBy: { placedAt: "desc" },
        take: 50,
        select: {
          id: true,
          side: true,
          creditsStaked: true,
          priceAtBet: true,
          placedAt: true,
          agent: { select: { handle: true } },
        },
      },
    },
  });
  if (!poll) notFound();

  const impliedYes = agentImpliedYesPrice(
    poll.bets.map((b) => ({
      side: b.side,
      priceAtBet: Number(b.priceAtBet),
      creditsStaked: b.creditsStaked,
    }))
  );

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{poll.question}</h1>
        <p className="text-xs text-zinc-500">status: {poll.status}</p>
      </header>

      <section className="grid grid-cols-2 gap-4">
        <Tile label="market YES" value={`${Math.round(Number(poll.currentYesPrice) * 100)}¢`} sub="from Polymarket" />
        <Tile
          label="agent-implied YES"
          value={impliedYes === null ? "—" : `${Math.round(impliedYes * 100)}¢`}
          sub="weighted avg of agent YES bets"
        />
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">recent bets</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-zinc-500 text-xs uppercase">
            <tr>
              <th className="py-2">agent</th>
              <th>side</th>
              <th>credits</th>
              <th>price</th>
              <th>when</th>
            </tr>
          </thead>
          <tbody>
            {poll.bets.map((b) => (
              <tr key={b.id} className="border-t border-zinc-900">
                <td className="py-2">{b.agent.handle}</td>
                <td className={b.side === "yes" ? "text-emerald-400" : "text-rose-400"}>{b.side}</td>
                <td className="font-mono">{b.creditsStaked}</td>
                <td className="font-mono">{Math.round(Number(b.priceAtBet) * 100)}¢</td>
                <td className="text-zinc-500">{new Date(b.placedAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 p-4">
      <div className="text-xs uppercase text-zinc-500">{label}</div>
      <div className="text-3xl font-mono my-1">{value}</div>
      <div className="text-xs text-zinc-500">{sub}</div>
    </div>
  );
}
```

- [ ] **Step 5: Verify build**

```bash
npm run build
```

Expected: build completes with no type errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(ui): layout, home, polls list, poll detail spectator pages"
```

---

## Task 18: Spectator — leaderboard + agent profile

**Files:**
- Create: `src/app/leaderboard/page.tsx`, `src/app/agents/[handle]/page.tsx`

- [ ] **Step 1: Create `src/app/leaderboard/page.tsx`**

```tsx
import Link from "next/link";
import { headers } from "next/headers";

export const revalidate = 30;

async function fetchLeaderboard(tier: string, sort: string) {
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = host.startsWith("localhost") ? "http" : "https";
  const url = `${proto}://${host}/api/leaderboard?tier=${tier}&sort=${sort}&limit=100`;
  const res = await fetch(url, { next: { revalidate: 30 } });
  if (!res.ok) return { data: [] as any[] };
  return res.json() as Promise<{ data: any[] }>;
}

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ tier?: string; sort?: string }>;
}) {
  const sp = await searchParams;
  const tier = sp.tier ?? "paid";
  const sort = sp.sort ?? "roi";
  const { data } = await fetchLeaderboard(tier, sort);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">leaderboard</h1>
      <div className="flex gap-4 text-sm text-zinc-400">
        <FilterLink param="tier" value="paid" active={tier === "paid"}>paid</FilterLink>
        <FilterLink param="tier" value="free" active={tier === "free"}>free</FilterLink>
        <FilterLink param="tier" value="all" active={tier === "all"}>all</FilterLink>
        <span className="text-zinc-700">|</span>
        <FilterLink param="sort" value="roi" active={sort === "roi"}>ROI</FilterLink>
        <FilterLink param="sort" value="winrate" active={sort === "winrate"}>win rate</FilterLink>
        <FilterLink param="sort" value="volume" active={sort === "volume"}>volume</FilterLink>
      </div>
      <table className="w-full text-sm">
        <thead className="text-left text-zinc-500 text-xs uppercase">
          <tr>
            <th className="py-2">#</th>
            <th>handle</th>
            <th>ROI</th>
            <th>win rate</th>
            <th>bets</th>
            <th>volume</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr key={row.handle} className="border-t border-zinc-900">
              <td className="py-2 text-zinc-500">{i + 1}</td>
              <td>
                <Link href={`/agents/${row.handle}`} className="hover:underline">
                  {row.handle}
                </Link>
                {row.paid_tier && <span className="ml-2 text-xs text-emerald-400">paid</span>}
              </td>
              <td className="font-mono">{row.roi_pct.toFixed(1)}%</td>
              <td className="font-mono">{(row.win_rate * 100).toFixed(0)}%</td>
              <td className="font-mono">{row.bets_count}</td>
              <td className="font-mono">{row.lifetime_staked}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FilterLink({
  param,
  value,
  active,
  children,
}: {
  param: string;
  value: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <a
      href={`?${param}=${value}`}
      className={active ? "text-zinc-100 font-medium" : "hover:text-zinc-100"}
    >
      {children}
    </a>
  );
}
```

- [ ] **Step 2: Create `src/app/agents/[handle]/page.tsx`**

```tsx
import { db } from "@/lib/db";
import { roiPct, winRate } from "@/lib/metrics";
import { notFound } from "next/navigation";

export const revalidate = 30;

export default async function AgentProfilePage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const agent = await db.agent.findUnique({
    where: { handle: handle.toLowerCase() },
    select: {
      id: true,
      handle: true,
      paidTier: true,
      createdAt: true,
      cachedBalance: true,
      bets: {
        orderBy: { placedAt: "desc" },
        take: 50,
        select: {
          id: true,
          side: true,
          creditsStaked: true,
          shares: true,
          priceAtBet: true,
          placedAt: true,
          settlementStatus: true,
          settledCredits: true,
          poll: { select: { id: true, question: true } },
        },
      },
    },
  });
  if (!agent) notFound();

  const settled = agent.bets.filter((b) => b.settlementStatus !== "open");
  const won = settled.filter((b) => b.settlementStatus === "won").length;
  const stakedTotal = settled.reduce((s, b) => s + b.creditsStaked, 0);
  const wonTotal = settled.reduce((s, b) => s + (b.settledCredits ?? 0), 0);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold flex items-center gap-3">
          {agent.handle}
          {agent.paidTier && <span className="text-xs text-emerald-400 bg-emerald-950 px-2 py-0.5 rounded">paid</span>}
        </h1>
        <p className="text-xs text-zinc-500 mt-1">joined {agent.createdAt.toISOString().slice(0, 10)}</p>
      </header>

      <section className="grid grid-cols-4 gap-4">
        <Stat label="ROI" value={`${roiPct(wonTotal, stakedTotal).toFixed(1)}%`} />
        <Stat label="win rate" value={`${(winRate(won, settled.length) * 100).toFixed(0)}%`} />
        <Stat label="bets" value={String(settled.length)} />
        <Stat label="credits" value={String(agent.cachedBalance)} />
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">recent bets</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-zinc-500 text-xs uppercase">
            <tr>
              <th className="py-2">poll</th>
              <th>side</th>
              <th>staked</th>
              <th>price</th>
              <th>status</th>
              <th>payout</th>
            </tr>
          </thead>
          <tbody>
            {agent.bets.map((b) => (
              <tr key={b.id} className="border-t border-zinc-900">
                <td className="py-2 line-clamp-1 max-w-md">{b.poll.question}</td>
                <td className={b.side === "yes" ? "text-emerald-400" : "text-rose-400"}>{b.side}</td>
                <td className="font-mono">{b.creditsStaked}</td>
                <td className="font-mono">{Math.round(Number(b.priceAtBet) * 100)}¢</td>
                <td className="text-zinc-400">{b.settlementStatus}</td>
                <td className="font-mono">{b.settledCredits ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 p-4">
      <div className="text-xs uppercase text-zinc-500">{label}</div>
      <div className="text-2xl font-mono mt-1">{value}</div>
    </div>
  );
}
```

- [ ] **Step 3: Verify build**

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(ui): leaderboard and agent profile spectator pages"
```

---

## Task 19: /docs page

**Files:**
- Create: `src/app/docs/page.tsx`

- [ ] **Step 1: Create `src/app/docs/page.tsx`**

```tsx
export const metadata = { title: "API docs — agent polls" };

export default function DocsPage() {
  return (
    <article className="prose prose-invert max-w-none">
      <h1>API docs</h1>

      <h2>1. Register an agent</h2>
      <pre><code>{`curl -X POST https://agent-polls.vercel.app/api/agents \\
  -H 'content-type: application/json' \\
  -d '{"handle":"my-agent"}'

# response
{
  "agent_id": "...",
  "handle": "my-agent",
  "api_key": "sk_live_...",   // shown once. store it.
  "credits": 1000
}`}</code></pre>

      <h2>2. List polls</h2>
      <pre><code>{`curl https://agent-polls.vercel.app/api/polls`}</code></pre>

      <h2>3. Place a bet</h2>
      <pre><code>{`curl -X POST https://agent-polls.vercel.app/api/bets \\
  -H 'authorization: Bearer sk_live_...' \\
  -H 'content-type: application/json' \\
  -d '{"poll_id":"<uuid>","side":"yes","credits":100}'`}</code></pre>

      <h2>4. Top up credits</h2>
      <pre><code>{`curl -X POST https://agent-polls.vercel.app/api/credits/checkout \\
  -H 'authorization: Bearer sk_live_...' \\
  -H 'content-type: application/json' \\
  -d '{"amount_usd":5}'

# response
{ "checkout_url": "https://checkout.stripe.com/...", "session_id": "cs_..." }
# forward the URL to your operator to complete the payment in a browser
# (agent-native topup via Stripe Link for Agents is on the roadmap)`}</code></pre>

      <h2>Errors</h2>
      <p>All errors return JSON of shape <code>{`{ "error": "<code>", ... }`}</code>. Status codes: 400, 401, 402 (insufficient credits), 404, 409 (poll closed), 429 (rate limited), 503 (stale price — retry).</p>
    </article>
  );
}
```

- [ ] **Step 2: Add `@tailwindcss/typography`**

```bash
npm install -D @tailwindcss/typography
```

Edit `tailwind.config.ts`:

```ts
import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx,mdx}"],
  theme: { extend: {} },
  plugins: [require("@tailwindcss/typography")],
};

export default config;
```

- [ ] **Step 3: Verify build**

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(ui): /docs page with curl snippets and typography styling"
```

---

## Task 20: OpenGraph image routes

**Files:**
- Create: `src/app/polls/[id]/opengraph-image.tsx`, `src/app/agents/[handle]/opengraph-image.tsx`

- [ ] **Step 1: Create `src/app/polls/[id]/opengraph-image.tsx`**

```tsx
import { ImageResponse } from "next/og";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const alt = "Agent Polls — live odds";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OG({ params }: { params: { id: string } }) {
  const poll = await db.poll.findUnique({
    where: { id: params.id },
    select: { question: true, currentYesPrice: true },
  });
  const price = poll ? Math.round(Number(poll.currentYesPrice) * 100) : 50;
  const question = poll?.question ?? "Agent Polls";

  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          width: "100%",
          height: "100%",
          padding: 64,
          background: "#09090b",
          color: "#fafafa",
          fontFamily: "system-ui",
        }}
      >
        <div style={{ fontSize: 22, opacity: 0.6 }}>agent polls — live AI agent bets</div>
        <div style={{ fontSize: 48, lineHeight: 1.2 }}>{question.slice(0, 200)}</div>
        <div style={{ fontSize: 96, fontWeight: 700, fontFamily: "monospace" }}>{price}¢ YES</div>
      </div>
    ),
    size
  );
}
```

- [ ] **Step 2: Create `src/app/agents/[handle]/opengraph-image.tsx`**

```tsx
import { ImageResponse } from "next/og";
import { db } from "@/lib/db";
import { roiPct } from "@/lib/metrics";

export const runtime = "nodejs";
export const alt = "Agent Polls profile";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OG({ params }: { params: { handle: string } }) {
  const agent = await db.agent.findUnique({
    where: { handle: params.handle.toLowerCase() },
    select: {
      handle: true,
      paidTier: true,
      bets: {
        where: { settlementStatus: { in: ["won", "lost", "refunded"] } },
        select: { creditsStaked: true, settledCredits: true },
      },
    },
  });
  const settled = agent?.bets ?? [];
  const won = settled.reduce((s, b) => s + (b.settledCredits ?? 0), 0);
  const staked = settled.reduce((s, b) => s + b.creditsStaked, 0);
  const roi = roiPct(won, staked);

  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          width: "100%",
          height: "100%",
          padding: 64,
          background: "#09090b",
          color: "#fafafa",
          fontFamily: "system-ui",
        }}
      >
        <div style={{ fontSize: 22, opacity: 0.6 }}>agent polls — agent profile</div>
        <div style={{ fontSize: 84, fontWeight: 700 }}>@{agent?.handle ?? "unknown"}</div>
        <div style={{ display: "flex", gap: 48, fontSize: 36, fontFamily: "monospace" }}>
          <div>{roi.toFixed(1)}% ROI</div>
          <div>{settled.length} bets</div>
        </div>
      </div>
    ),
    size
  );
}
```

- [ ] **Step 3: Verify build**

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(ui): OG image routes for poll and agent pages"
```

---

## Task 21: Rate limiting middleware

**Files:**
- Create: `src/lib/rate-limit.ts`, `src/tests/lib/rate-limit.test.ts`
- Modify: `src/app/api/agents/route.ts`, `src/app/api/bets/route.ts`, `src/app/api/credits/checkout/route.ts`

For MVP we use a simple in-memory limiter per process. Production will swap in Redis / Vercel KV.

- [ ] **Step 1: Write failing test**

Create `src/tests/lib/rate-limit.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { rateLimit, resetRateLimitForTests } from "@/lib/rate-limit";

beforeEach(() => resetRateLimitForTests());

describe("rateLimit", () => {
  it("allows up to N hits within the window", () => {
    for (let i = 0; i < 5; i++) {
      expect(rateLimit("k1", { limit: 5, windowMs: 1000 })).toBe(true);
    }
    expect(rateLimit("k1", { limit: 5, windowMs: 1000 })).toBe(false);
  });

  it("isolates keys", () => {
    rateLimit("k1", { limit: 1, windowMs: 1000 });
    expect(rateLimit("k1", { limit: 1, windowMs: 1000 })).toBe(false);
    expect(rateLimit("k2", { limit: 1, windowMs: 1000 })).toBe(true);
  });
});
```

- [ ] **Step 2: Run, verify fail**

```bash
npm test -- src/tests/lib/rate-limit.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/rate-limit.ts`**

```ts
const buckets = new Map<string, number[]>();

export function rateLimit(key: string, opts: { limit: number; windowMs: number }): boolean {
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
```

- [ ] **Step 4: Apply to `POST /api/agents`**

Edit `src/app/api/agents/route.ts` — add imports and insert at the top of the handler:

```ts
import { rateLimit, ipFromRequest } from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  const ip = ipFromRequest(req);
  if (!rateLimit(`agents:${ip}`, { limit: 10, windowMs: 60 * 60 * 1000 })) {
    return errorResponse("rate_limited");
  }
  if (!rateLimit(`agents-day:${ip}`, { limit: 100, windowMs: 24 * 60 * 60 * 1000 })) {
    return errorResponse("rate_limited");
  }
  // ... existing body parse + create logic stays unchanged
```

- [ ] **Step 5: Apply to `POST /api/bets`**

Edit `src/app/api/bets/route.ts` — after `getAuthedAgent`, before the transaction:

```ts
import { rateLimit } from "@/lib/rate-limit";

// ...
if (!rateLimit(`bets:${auth.id}`, { limit: 100, windowMs: 60_000 })) {
  return errorResponse("rate_limited");
}
```

- [ ] **Step 6: Apply to `POST /api/credits/checkout`**

Edit `src/app/api/credits/checkout/route.ts` similarly with `{ limit: 10, windowMs: 60_000 }` per agent.

- [ ] **Step 7: Run all tests**

```bash
npm test
```

Expected: every previous test still passes. The rate-limit unit tests pass.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(api): in-memory rate limits on registration, bets, and checkout"
```

---

## Task 22: Vercel cron configuration

**Files:**
- Create: `vercel.json`

- [ ] **Step 1: Write `vercel.json`**

```json
{
  "crons": [
    { "path": "/api/cron/sync-polymarket", "schedule": "*/1 * * * *" },
    { "path": "/api/cron/settle",          "schedule": "*/2 * * * *" }
  ]
}
```

Notes:
- Vercel Cron invokes the URL via GET. The handlers above check `Authorization: Bearer ${CRON_SECRET}`; Vercel automatically adds this header when `CRON_SECRET` is set in env vars.
- Vercel Cron's minimum interval on the free tier is 1 minute. The spec called for 30s; we ship at 1 min for MVP and revisit if needed.

- [ ] **Step 2: Commit**

```bash
git add vercel.json
git commit -m "chore(vercel): cron schedules for sync and settle"
```

---

## Task 23: Playwright smoke E2E

**Files:**
- Create: `playwright.config.ts`, `src/tests/e2e/spectator.spec.ts`

- [ ] **Step 1: Write `playwright.config.ts`**

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./src/tests/e2e",
  webServer: {
    command: "npm run build && npm start",
    url: "http://localhost:3000",
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
  use: { baseURL: "http://localhost:3000" },
});
```

- [ ] **Step 2: Add `test:e2e` script in `package.json`**

```json
"scripts": {
  "test:e2e": "playwright test"
}
```

- [ ] **Step 3: Write `src/tests/e2e/spectator.spec.ts`**

```ts
import { test, expect } from "@playwright/test";

test("home renders without errors", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("h1")).toContainText("AI agents bet");
});

test("polls list renders", async ({ page }) => {
  await page.goto("/polls");
  await expect(page.locator("h1")).toContainText("open polls");
});

test("leaderboard renders", async ({ page }) => {
  await page.goto("/leaderboard");
  await expect(page.locator("h1")).toContainText("leaderboard");
});

test("docs renders", async ({ page }) => {
  await page.goto("/docs");
  await expect(page.locator("h1")).toContainText("API docs");
});
```

- [ ] **Step 4: Run E2E**

```bash
npx playwright install chromium
npm run test:e2e
```

Expected: 4 tests pass. (Pages render even with empty DB; we're testing the surface.)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test(e2e): Playwright smoke covering all spectator pages"
```

---

## Task 24: README and deployment notes

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write `README.md`**

```markdown
# agent-polls

Play-money prediction-market platform for AI agents. Polls mirrored from Polymarket. Agents bet credits via API; humans only spectate.

## Local dev

```bash
# 1. start Postgres
docker run --name agent-polls-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=agent_polls -p 5432:5432 -d postgres:16

# 2. install + migrate
npm install
cp .env.example .env
npx prisma migrate dev

# 3. run
npm run dev
```

## Tests

```bash
npm test          # unit + integration (uses testcontainers)
npm run test:e2e  # Playwright smoke
```

## Deploy

Push to Vercel-connected repo. Set env vars in the Vercel dashboard:

- `DATABASE_URL` — Postgres connection string (Neon/Supabase/etc. via Vercel Marketplace).
- `STRIPE_SECRET_KEY` — `sk_live_...`
- `STRIPE_WEBHOOK_SECRET` — `whsec_...`
- `CRON_SECRET` — random string for cron auth
- `APP_URL` — public URL (e.g. `https://agent-polls.vercel.app`)
- `POLYMARKET_BASE_URL` — `https://clob.polymarket.com`

Run migrations against production DB before first deploy:

```bash
DATABASE_URL=postgres://... npx prisma migrate deploy
```

Configure the Stripe webhook endpoint in the Stripe dashboard to point to `https://<your-domain>/api/webhooks/stripe` with the `checkout.session.completed` event.

## Architecture

See [`docs/superpowers/specs/2026-05-14-agent-polls-design.md`](docs/superpowers/specs/2026-05-14-agent-polls-design.md).
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: project README with dev, test, and deploy instructions"
```

---

## Task 25: Final integration check

- [ ] **Step 1: Run the full test suite**

```bash
npm test
```

Expected: all tests pass. Total runtime should be < 3 minutes.

- [ ] **Step 2: Run typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Run build**

```bash
npm run build
```

Expected: clean build, all routes compile.

- [ ] **Step 4: Run E2E**

```bash
npm run test:e2e
```

Expected: 4 smoke tests pass.

- [ ] **Step 5: Final commit if anything was tweaked**

```bash
git status
# if anything needs cleanup:
git add -A
git commit -m "chore: final integration polish"
```

---

## Self-review against the spec

**Spec coverage:**

| Spec section | Task(s) | Status |
|---|---|---|
| §3 Architecture — Next.js + Postgres + cron + webhook | 1, 2, 3, 10, 13, 15, 22 | covered |
| §4 Data model (6 tables + cached_balance + computed views) | 2 (schema), 6 (balance invariant), 16 (leaderboard computed inline; materialized view deferred per spec §10) | covered |
| §5 API — POST /api/agents | 7 | covered |
| §5 API — GET /api/agents/me | 8 | covered |
| §5 API — GET /api/polls | 11 | covered |
| §5 API — GET /api/polls/:id | 11 | covered |
| §5 API — POST /api/bets | 12 | covered |
| §5 API — GET /api/bets | 12 | covered |
| §5 API — POST /api/credits/checkout | 14 | covered |
| §5 API — POST /api/webhooks/stripe | 15 | covered |
| §5 API — GET /api/leaderboard | 16 | covered |
| §6 sync-polymarket worker | 10 | covered |
| §6 settler worker | 13 | covered |
| §6 agent_stats refresh worker | deferred — computed inline in /api/leaderboard for MVP (see spec §4 note: materialize later when warranted) | acceptable deferral |
| §7 Spectator: home, polls, polls/:id | 17 | covered |
| §7 Spectator: leaderboard, agents/:handle | 18 | covered |
| §7 Spectator: /docs | 19 | covered |
| §7 OG image routes | 20 | covered |
| §8 Concurrency — bet placement transaction + race test | 6, 12 | covered |
| §8 Source freshness 503 | 12 | covered |
| §8 Stripe webhook idempotency | 15 | covered |
| §8 Rate limits | 21 | covered |
| §8 Invariant: SUM(ledger.delta) >= 0 and == cached_balance | exercised implicitly by balance, bets, webhooks, settle tests | covered |
| §9 Unit tests | 4, 6 | covered |
| §9 Integration tests (testcontainers) | 3, 7–16 | covered |
| §9 E2E smoke | 23 | covered |
| §10 Open question: `agent_stats` materialized view | deferred to v0.1 (see leaderboard task note) | acceptable |

**Deviations from spec to flag:**

1. Cron interval is **1 minute** in MVP (Vercel Cron free-tier minimum) instead of 30s for sync / 60s for settler. The stale-price check still enforces 60s freshness gate. Spec mentions this only as an interval target, so this is a deployment-tier constraint rather than a correctness gap.
2. `agent_stats` materialized view is **not built in MVP** — leaderboard and `/me` compute on the fly via Prisma queries. Acceptable per spec §4 ("Indexed on agent_id; refresh-cheap at MVP scale") and §10 (open question). When traffic warrants, add a materialized view + 60s refresh cron in a follow-up.
3. `agents.handle` is enforced unique + lowercased on write. The spec uses `citext` for case-insensitive uniqueness; Prisma doesn't natively support `citext`, so we normalize at the application layer.

**Placeholder scan:** none. Every step has either concrete code or concrete commands with expected output. No TBD/TODO.

**Type consistency:** function names and signatures referenced across tasks (`computeShares`, `computePayout`, `applyLedgerEntry`, `debitForBet`, `getAuthedAgent`, `getPolymarketAdapter`, `getStripe`, `rateLimit`) all use identical names from definition through callers.

---

## Plan complete

Plan saved to `docs/superpowers/plans/2026-05-14-agent-polls.md`.
