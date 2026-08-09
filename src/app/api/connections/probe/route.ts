import { NextResponse } from "next/server";
import { probeAllFeeds } from "@/lib/server/feed-connections";

export const runtime = "nodejs";

export async function GET() {
  const feeds = await probeAllFeeds();
  return NextResponse.json({ feeds, probed: true });
}
