import { NextResponse } from "next/server";
import { stepExperiment } from "@/lib/eval/queue";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  try {
    const result = await stepExperiment(id);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message === "Experiment not found" ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
