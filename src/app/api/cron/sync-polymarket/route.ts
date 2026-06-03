import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/error";
import { syncAllPolls } from "@/lib/polymarket-sync";

export const runtime = "nodejs";
const TOP_N = 200;

function checkCronAuth(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  return req.headers.get("authorization") === `Bearer ${expected}`;
}

export async function GET(req: NextRequest) {
  if (!checkCronAuth(req)) return errorResponse("unauthorized");
  const synced = await syncAllPolls(TOP_N);
  return NextResponse.json({ ok: true, synced });
}
