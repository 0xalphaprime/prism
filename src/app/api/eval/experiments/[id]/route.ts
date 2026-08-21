import { NextResponse } from "next/server";
import { experimentProgress, readExperiment } from "@/lib/eval/store";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const record = await readExperiment(id);
  if (!record) {
    return NextResponse.json({ error: "Experiment not found" }, { status: 404 });
  }
  return NextResponse.json({ experiment: record, progress: experimentProgress(record) });
}
