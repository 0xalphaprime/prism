import { NextResponse } from "next/server";
import { coerceEvalItem, upsertEvalItem } from "@/lib/eval/ingest";
import { readSignedDiskCard } from "@/lib/eval/disk-cards";
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
    const diskId =
      body &&
      typeof body === "object" &&
      "diskId" in body &&
      typeof (body as { diskId?: unknown }).diskId === "string"
        ? (body as { diskId: string }).diskId
        : null;
    const payload = diskId ? readSignedDiskCard(diskId) : body;
    const item = coerceEvalItem(payload);
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
