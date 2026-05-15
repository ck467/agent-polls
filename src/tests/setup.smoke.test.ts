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
