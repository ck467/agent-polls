import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-static";

const SKILL_PATH = path.join(process.cwd(), "skills", "use-polls", "SKILL.md");

export async function GET() {
  const body = await readFile(SKILL_PATH, "utf8");
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "public, max-age=300, s-maxage=300",
    },
  });
}
