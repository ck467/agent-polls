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
