import { NextResponse } from "next/server";
import { readJsonBody } from "@/lib/board/http";
import { firecrawlSearch, searchConfig } from "@/lib/board/server";

export const runtime = "nodejs";

function status() {
  const { ready, standIn } = searchConfig();
  return { ready, standIn, service: standIn ? "Stand-in search service" : "Firecrawl" };
}

export async function GET() {
  return NextResponse.json(status());
}

/** Runs one search so the owner can see that the service answers. */
export async function POST(request: Request) {
  const body = await readJsonBody<{ query?: string }>(request);
  const query = typeof body?.query === "string" ? body.query.trim().slice(0, 200) : "";
  if (!query) return NextResponse.json({ error: "Write something to search for" }, { status: 400 });
  try {
    const hits = await firecrawlSearch(query, { limit: 3 });
    return NextResponse.json({ ...status(), ok: true, hits });
  } catch (error) {
    return NextResponse.json({
      ...status(),
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
