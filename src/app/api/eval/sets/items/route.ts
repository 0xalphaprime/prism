import { NextResponse } from "next/server";
import { coerceEvalItem, upsertEvalItem } from "@/lib/eval/ingest";
import { runnableItems } from "@/lib/eval/sets";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const item = coerceEvalItem(body);
    const set = upsertEvalItem(item);
    return NextResponse.json({
      item,
      setId: set.id,
      runnable: runnableItems(set).length,
      total: set.items.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
