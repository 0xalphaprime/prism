import { NextResponse } from "next/server";
import { syncHandoff } from "@/lib/board/decisions";
import { boardErrorResponse, readJsonBody } from "@/lib/board/http";
import { proposeLessons } from "@/lib/board/lessons";
import { liveDeps } from "@/lib/board/server";
import {
  runChairStep,
  runCrossStep,
  runGeneralistMemoStep,
  runGeneralistPlanStep,
  runGeneralistResearchStep,
  runMapStep,
  runNotesStep,
  runOpinionStep,
  runPlan2Step,
  runPlanStep,
  runPremortemStep,
  runResearch2Step,
  runResearchStep,
  runRevisedStep,
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
      case "map":
        outcome = await runMapStep(id, deps, { force });
        break;
      case "plan2":
        outcome = await runPlan2Step(id, member, deps, { force });
        break;
      case "research2":
        outcome = await runResearch2Step(id, member, deps, release);
        break;
      case "revised":
        outcome = await runRevisedStep(id, member, deps, { force });
        break;
      case "premortem":
        outcome = await runPremortemStep(id, member, deps, { force });
        break;
      case "cross":
        outcome = await runCrossStep(id, member, deps, { force });
        break;
      case "chair":
        outcome = await runChairStep(id, deps, { force });
        break;
      case "lessons":
        outcome = await proposeLessons(id, member, deps, { force });
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
    // The hand-off file quotes the memo and the positions, so it follows every change to them.
    await syncHandoff(id).catch((error) => console.error("Board hand-off was not written", error));
    return NextResponse.json({ ...outcome, session: await readSessionView(id) });
  } catch (error) {
    return boardErrorResponse(error);
  }
}
