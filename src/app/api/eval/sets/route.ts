import { NextResponse } from "next/server";
import { EVAL_ARCHITECTURES } from "@/lib/eval/graphs";
import { listEvalSets, runnableItems } from "@/lib/eval/sets";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    sets: listEvalSets().map((set) => ({
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
