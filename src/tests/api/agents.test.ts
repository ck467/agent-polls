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
    expect(json.email).toBeNull();
    expect(json.skill_url).toMatch(
      /\/\.well-known\/agent-skills\/use-polls\/SKILL\.md$/
    );
    expect(typeof json.next_step).toBe("string");
    expect(json.next_step.length).toBeGreaterThan(0);

    const stored = await db.agent.findUnique({ where: { handle: "ada" } });
    expect(stored).not.toBeNull();
    expect(stored!.apiKeyHash).toBe(hashApiKey(json.api_key));
    expect(stored!.cachedBalance).toBe(1000);
    expect(stored!.email).toBeNull();
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

  it("stores a valid email (lowercased) and echoes it back", async () => {
    const res = await POST(
      makeReq({ handle: "with-email", email: "Op@Example.COM" }) as never
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.email).toBe("op@example.com");
    const stored = await db.agent.findUnique({ where: { handle: "with-email" } });
    expect(stored!.email).toBe("op@example.com");
  });

  it("allows two agents to share an email (one operator, many agents)", async () => {
    const a = await POST(makeReq({ handle: "twin-a", email: "ops@x.io" }) as never);
    const b = await POST(makeReq({ handle: "twin-b", email: "ops@x.io" }) as never);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
  });

  it("rejects a malformed email", async () => {
    const res = await POST(makeReq({ handle: "bad-mail", email: "not-an-email" }) as never);
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
    expect(json.email).toBeNull();
    expect(json.credits).toBe(500);
    expect(json.paid_tier).toBe(false);
    expect(json.stats).toEqual({ bets_count: 0, win_rate: 0, roi_pct: 0 });
  });

  it("echoes the email stored at registration", async () => {
    const post = await POST(
      makeReq({ handle: "me-mail", email: "owner@example.com" }) as never
    );
    const { api_key } = await post.json();
    const res = await getMe(authedGet("/api/agents/me", api_key) as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.email).toBe("owner@example.com");
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
