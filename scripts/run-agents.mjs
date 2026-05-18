// Demo: register 5 agents with different strategies and have them bet against
// the live API. Saves keys to scripts/.agent-keys.json so the script is
// idempotent across runs.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KEYFILE = path.join(__dirname, ".agent-keys.json");

const BASE = process.env.AGENT_POLLS_URL ?? "https://agent-polls.vercel.app";
// Load production env when hitting production, .env otherwise.
const ENV_FILE = BASE.includes("vercel.app") ? ".env.production" : ".env";
dotenv.config({ path: path.join(__dirname, "..", ENV_FILE) });
const CRON_SECRET = process.env.CRON_SECRET;

const AGENTS = [
  { handle: "yes-cheap-bot",   strategy: "yes-cheap"  },
  { handle: "no-expensive-bot", strategy: "no-expensive" },
  { handle: "midcap-bot",      strategy: "midcap"     },
  { handle: "extreme-follow-bot", strategy: "extreme-follow" },
  { handle: "coinflip-bot",    strategy: "coinflip"   },
];

const BETS_PER_AGENT = 5;
const STAKE = 50;

async function readKeys() {
  try {
    return JSON.parse(await fs.readFile(KEYFILE, "utf8"));
  } catch {
    return {};
  }
}

async function writeKeys(keys) {
  await fs.writeFile(KEYFILE, JSON.stringify(keys, null, 2));
}

async function api(method, path, opts = {}) {
  const { body, key } = opts;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(key ? { authorization: `Bearer ${key}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

async function registerOrLoad(keys, handle) {
  if (keys[handle]) return keys[handle];
  const { status, json } = await api("POST", "/api/agents", { body: { handle } });
  if (status !== 201) {
    throw new Error(`register ${handle} failed: ${status} ${JSON.stringify(json)}`);
  }
  keys[handle] = json.api_key;
  await writeKeys(keys);
  console.log(`  registered @${handle} (saved key)`);
  return json.api_key;
}

function pickBet(strategy, polls, rng) {
  // Each strategy returns { poll_id, side } or null if no suitable poll.
  const open = polls.filter((p) => p.current_yes_price > 0.01 && p.current_yes_price < 0.99);
  if (open.length === 0) return null;

  switch (strategy) {
    case "yes-cheap": {
      const cands = open.filter((p) => p.current_yes_price < 0.4);
      const p = cands[Math.floor(rng() * cands.length)] ?? open[0];
      return { poll_id: p.id, side: "yes", question: p.question, price: p.current_yes_price };
    }
    case "no-expensive": {
      const cands = open.filter((p) => p.current_yes_price > 0.6);
      const p = cands[Math.floor(rng() * cands.length)] ?? open[0];
      return { poll_id: p.id, side: "no", question: p.question, price: p.current_yes_price };
    }
    case "midcap": {
      const cands = open.filter((p) => p.current_yes_price >= 0.4 && p.current_yes_price <= 0.6);
      const p = cands[Math.floor(rng() * cands.length)] ?? open[0];
      return { poll_id: p.id, side: "yes", question: p.question, price: p.current_yes_price };
    }
    case "extreme-follow": {
      const high = open.filter((p) => p.current_yes_price > 0.85);
      const low = open.filter((p) => p.current_yes_price < 0.15);
      const picks = [...high.map((p) => ({ p, side: "yes" })), ...low.map((p) => ({ p, side: "no" }))];
      if (picks.length === 0) return null;
      const pick = picks[Math.floor(rng() * picks.length)];
      return { poll_id: pick.p.id, side: pick.side, question: pick.p.question, price: pick.p.current_yes_price };
    }
    case "coinflip": {
      const p = open[Math.floor(rng() * open.length)];
      return { poll_id: p.id, side: rng() > 0.5 ? "yes" : "no", question: p.question, price: p.current_yes_price };
    }
  }
  return null;
}

function rngFor(seed) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

async function main() {
  console.log(`base: ${BASE}\n`);

  if (CRON_SECRET) {
    console.log("→ triggering Polymarket sync to refresh prices…");
    const r = await fetch(`${BASE}/api/cron/sync-polymarket`, {
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    });
    const j = await r.json();
    console.log(`  ${JSON.stringify(j)}\n`);
  } else {
    console.log("⚠️  no CRON_SECRET — skipping sync (bets may fail with stale_price)\n");
  }

  console.log("→ registering agents…");
  const keys = await readKeys();
  for (const a of AGENTS) {
    await registerOrLoad(keys, a.handle);
  }
  console.log("");

  console.log("→ fetching polls…");
  const pollsRes = await api("GET", "/api/polls?limit=100");
  const polls = pollsRes.json?.data ?? [];
  console.log(`  ${polls.length} polls available\n`);
  if (polls.length === 0) {
    console.error("no polls. bailing.");
    return;
  }

  console.log("→ placing bets…\n");
  const results = [];
  const placedOnPoll = new Set(); // (agentHandle:pollId) — avoid duplicate bets per agent per poll
  for (const a of AGENTS) {
    const key = keys[a.handle];
    const rng = rngFor(a.handle.charCodeAt(0) + Date.now());
    let placed = 0, failed = 0;
    let attempts = 0;
    while (placed < BETS_PER_AGENT && attempts < BETS_PER_AGENT * 4) {
      attempts++;
      const pick = pickBet(a.strategy, polls, rng);
      if (!pick) break;
      const dedup = `${a.handle}:${pick.poll_id}`;
      if (placedOnPoll.has(dedup)) continue;
      placedOnPoll.add(dedup);

      const { status, json } = await api("POST", "/api/bets", {
        key,
        body: { poll_id: pick.poll_id, side: pick.side, credits: STAKE },
      });
      if (status === 201) {
        placed++;
        console.log(`  @${a.handle.padEnd(20)} ${pick.side.toUpperCase()} ${STAKE} on "${pick.question.slice(0, 50)}" @ ${Math.round(pick.price * 100)}¢`);
      } else {
        failed++;
        console.log(`  @${a.handle.padEnd(20)} FAIL ${status}: ${JSON.stringify(json)}`);
      }
    }
    results.push({ handle: a.handle, strategy: a.strategy, placed, failed });
  }

  console.log("\n→ summary:");
  for (const r of results) {
    console.log(`  @${r.handle.padEnd(20)} (${r.strategy.padEnd(15)})  placed=${r.placed}  failed=${r.failed}`);
  }
  console.log("");

  console.log("→ final balances:");
  for (const a of AGENTS) {
    const { json } = await api("GET", "/api/agents/me", { key: keys[a.handle] });
    if (json?.credits !== undefined) {
      console.log(`  @${a.handle.padEnd(20)} credits=${json.credits}  bets_count=${json.stats?.bets_count ?? 0}`);
    }
  }
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
