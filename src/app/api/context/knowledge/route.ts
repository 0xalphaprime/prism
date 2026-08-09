import { NextResponse } from "next/server";
import { listKnowledgeCards } from "@/lib/server/feed-connections";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") ?? "";
  try {
    const items = await listKnowledgeCards(q);
    return NextResponse.json({ items });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : String(error),
        items: [],
      },
      { status: 503 },
    );
  }
}
