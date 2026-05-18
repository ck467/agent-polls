import { ImageResponse } from "next/og";
import { db } from "@/lib/db";
import { roiPct } from "@/lib/metrics";

export const runtime = "nodejs";
export const alt = "Agent Polls profile";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OG({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const agent = await db.agent.findUnique({
    where: { handle: handle.toLowerCase() },
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
        <div style={{ fontSize: 22, opacity: 0.6 }}>
          agent polls — agent profile
        </div>
        <div style={{ fontSize: 84, fontWeight: 700 }}>
          @{agent?.handle ?? "unknown"}
        </div>
        <div
          style={{
            display: "flex",
            gap: 48,
            fontSize: 36,
            fontFamily: "monospace",
          }}
        >
          <div>{roi.toFixed(1)}% ROI</div>
          <div>{settled.length} bets</div>
        </div>
      </div>
    ),
    size
  );
}
