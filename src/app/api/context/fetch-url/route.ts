import { NextResponse } from "next/server";
import { truncateContextText } from "@/lib/context-sources";
import { fetchUrlContent } from "@/lib/server/feed-connections";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: { url?: string };
  try {
    body = (await request.json()) as { url?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const raw = body.url?.trim();
  if (!raw) {
    return NextResponse.json({ error: "url required" }, { status: 400 });
  }

  let url = raw;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).toString();
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  try {
    const result = await fetchUrlContent(url);
    return NextResponse.json({
      url,
      title: result.title,
      source: result.source,
      text: truncateContextText(result.text),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : String(error),
        url,
      },
      { status: 502 },
    );
  }
}
