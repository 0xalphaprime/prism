import { NextResponse } from "next/server";
import { boardErrorResponse, readJsonBody } from "@/lib/board/http";
import { liveDeps } from "@/lib/board/server";
import {
  runChairStep,
  runGeneralistMemoStep,
  runGeneralistPlanStep,
  runGeneralistResearchStep,
  runNotesStep,
  runOpinionStep,
  runPlanStep,
  runResearchStep,
  setDropped,
  skipGeneralistResearch,
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
 * Runs one step and returns the session as it now stands. Member steps take
 * `member`; the Chair and generalist steps do not. A step that fails (model or
 * search trouble) still answers 200 with `ok: false`; the failure is saved on
 * the step so the screen can offer a retry.
 */
export async function POST(request: Request, ctx: Ctx) {
  const { id, step } = await ctx.params;
  const body = (await readJsonBody<StepBody>(request)) ?? {};
  const member = typeof body.member === "string" ? body.member : "";
  const force = Boolean(body.force);
  const release = { force, approve: Boolean(body.approve), queries: body.queries };
  try {
    const deps = liveDeps();
    let outcome: StepOutcome = { ok: true };
    switch (step) {
      case "plan":
        outcome = await runPlanStep(id, member, deps, { force });
        break;
      case "research":
        outcome = await runResearchStep(id, member, deps, release);
        break;
      case "skip-research":
        await skipResearch(id, member);
        break;
      case "notes":
        outcome = await runNotesStep(id, member, deps, { force });
        break;
      case "opinion":
        outcome = await runOpinionStep(id, member, deps, { force });
        break;
      case "drop":
        await setDropped(id, member, true);
        break;
      case "restore":
        await setDropped(id, member, false);
        break;
      case "chair":
        outcome = await runChairStep(id, deps, { force });
        break;
      case "generalist-plan":
        outcome = await runGeneralistPlanStep(id, deps, { force });
        break;
      case "generalist-research":
        outcome = await runGeneralistResearchStep(id, deps, release);
        break;
      case "generalist-skip-research":
        await skipGeneralistResearch(id);
        break;
      case "generalist-memo":
        outcome = await runGeneralistMemoStep(id, deps, { force });
        break;
      default:
        return NextResponse.json({ error: "Unknown step" }, { status: 404 });
    }
    return NextResponse.json({ ...outcome, session: await readSessionView(id) });
  } catch (error) {
    return boardErrorResponse(error);
  }
}
