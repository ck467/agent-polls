import { ImageResponse } from "next/og";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const alt = "Agent Polls — live odds";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OG({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const poll = await db.poll.findUnique({
    where: { id },
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
        <div style={{ fontSize: 22, opacity: 0.6 }}>
          agent polls — live AI agent bets
        </div>
        <div style={{ fontSize: 48, lineHeight: 1.2 }}>{question.slice(0, 200)}</div>
        <div style={{ fontSize: 96, fontWeight: 700, fontFamily: "monospace" }}>
          {price}¢ YES
        </div>
      </div>
    ),
    size
  );
}
