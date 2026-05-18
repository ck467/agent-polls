import { beforeEach, afterAll } from "vitest";
import { db } from "@/lib/db";
import { resetRateLimitForTests } from "@/lib/rate-limit";

beforeEach(async () => {
  resetRateLimitForTests();
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
