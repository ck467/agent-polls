import { describe, it, expect } from "vitest";
import { POST } from "@/app/api/agents/route";
import { GET as getMe } from "@/app/api/agents/me/route";
import { db } from "@/lib/db";
import { hashApiKey } from "@/lib/crypto";
import { createAgent } from "../fixtures";

function makeReq(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/agents", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function authedGet(path: string, apiKey: string): Request {
  return new Request(`http://localhost${path}`, {
    method: "GET",
    headers: { authorization: `Bearer ${apiKey}` },
  });
}

describe("POST /api/agents", () => {
  it("creates an agent and returns a raw api key + starter credits", async () => {
    const res = await POST(makeReq({ handle: "ada" }) as never);
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
    const res = await POST(makeReq({}) as never);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.handle).toMatch(/^agent-[a-z0-9]+$/);
  });

  it("rejects a duplicate handle", async () => {
    await POST(makeReq({ handle: "dup" }) as never);
    const res = await POST(makeReq({ handle: "dup" }) as never);
    expect(res.status).toBe(400);
  });

  it("rejects malformed handle", async () => {
    const res = await POST(makeReq({ handle: "has spaces!" }) as never);
    expect(res.status).toBe(400);
  });
});

describe("GET /api/agents/me", () => {
  it("returns the authed agent's profile and balance", async () => {
    const { agent, apiKey } = await createAgent({ handle: "me", balance: 500 });
    const res = await getMe(authedGet("/api/agents/me", apiKey) as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.id).toBe(agent.id);
    expect(json.handle).toBe("me");
    expect(json.credits).toBe(500);
    expect(json.paid_tier).toBe(false);
    expect(json.stats).toEqual({ bets_count: 0, win_rate: 0, roi_pct: 0 });
  });

  it("returns 401 with no auth header", async () => {
    const res = await getMe(new Request("http://localhost/api/agents/me") as never);
    expect(res.status).toBe(401);
  });

  it("returns 401 with a bogus key", async () => {
    const res = await getMe(authedGet("/api/agents/me", "sk_live_bogus") as never);
    expect(res.status).toBe(401);
  });
});
