import { NextResponse } from "next/server";
import { EVAL_ARCHITECTURES } from "@/lib/eval/graphs";
import { runnableItems } from "@/lib/eval/sets";
import { listEvalSetsLive } from "@/lib/eval/sets-disk";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    sets: listEvalSetsLive().map((set) => ({
      ...set,
      runnable: runnableItems(set).length,
      total: set.items.length,
    })),
    architectures: EVAL_ARCHITECTURES.map((arch) => ({
      id: arch.id,
      name: arch.name,
      description: arch.description,
      tags: arch.tags,
    })),
  });
}
