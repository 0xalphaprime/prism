import { NextResponse } from "next/server";
import { createAndSaveExperiment } from "@/lib/eval/queue";
import { experimentProgress, listExperiments } from "@/lib/eval/store";
import {
  EVAL_ARCHITECTURE_IDS,
  type EvalArchitectureId,
  type ExperimentProfile,
} from "@/lib/eval/types";

export const runtime = "nodejs";

export async function GET() {
  const items = await listExperiments();
  return NextResponse.json({
    experiments: items.map((exp) => ({
      id: exp.id,
      name: exp.name,
      evalSetId: exp.evalSetId,
      architectureIds: exp.architectureIds,
      status: exp.status,
      createdAt: exp.createdAt,
      updatedAt: exp.updatedAt,
      progress: experimentProgress(exp),
    })),
  });
}

export async function POST(request: Request) {
  let body: {
    evalSetId?: string;
    architectureIds?: string[];
    reps?: number;
    profile?: ExperimentProfile;
    name?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const allowed = new Set<string>(EVAL_ARCHITECTURE_IDS);
  const architectureIds = (body.architectureIds ?? []).filter((id): id is EvalArchitectureId =>
    allowed.has(id),
  );
  if (!body.evalSetId) {
    return NextResponse.json({ error: "evalSetId required" }, { status: 400 });
  }

  try {
    const record = await createAndSaveExperiment({
      evalSetId: body.evalSetId,
      architectureIds,
      reps: body.reps,
      profile: body.profile,
      name: body.name,
    });
    return NextResponse.json({ experiment: record, progress: experimentProgress(record) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
