import { NextResponse } from "next/server";
import { boardErrorResponse, readJsonBody } from "@/lib/board/http";
import { liveDeps } from "@/lib/board/server";
import {
  runNotesStep,
  runPlanStep,
  runResearchStep,
  skipResearch,
  type StepOutcome,
} from "@/lib/board/session-runner";
import { readSessionView } from "@/lib/board/session-store";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string; step: string }> };

type StepBody = {
  member?: string;
  force?: boolean;
  approve?: boolean;
  queries?: unknown;
};

/**
 * Runs one step for one member and returns the session as it now stands.
 * A step that fails (model or search trouble) still answers 200 with
 * `ok: false`; the failure is saved on the step so the screen can offer a retry.
 */
export async function POST(request: Request, ctx: Ctx) {
  const { id, step } = await ctx.params;
  const body = (await readJsonBody<StepBody>(request)) ?? {};
  const member = typeof body.member === "string" ? body.member : "";
  const force = Boolean(body.force);
  try {
    const deps = liveDeps();
    let outcome: StepOutcome = { ok: true };
    switch (step) {
      case "plan":
        outcome = await runPlanStep(id, member, deps, { force });
        break;
      case "research":
        outcome = await runResearchStep(id, member, deps, {
          force,
          approve: Boolean(body.approve),
          queries: body.queries,
        });
        break;
      case "skip-research":
        await skipResearch(id, member);
        break;
      case "notes":
        outcome = await runNotesStep(id, member, deps, { force });
        break;
      default:
        return NextResponse.json({ error: "Unknown step" }, { status: 404 });
    }
    return NextResponse.json({ ...outcome, session: await readSessionView(id) });
  } catch (error) {
    return boardErrorResponse(error);
  }
}
