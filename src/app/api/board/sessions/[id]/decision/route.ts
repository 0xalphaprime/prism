import { NextResponse } from "next/server";
import { handoffFile, readDecision, saveDecision } from "@/lib/board/decisions";
import { boardErrorResponse, invalidJson, readJsonBody } from "@/lib/board/http";
import { exists } from "@/lib/board/store";
import type { DecisionDraft } from "@/lib/board/types";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  try {
    const decision = await readDecision(id);
    const file = handoffFile(id);
    return NextResponse.json({ decision, handoff: (await exists(file)) ? file : null });
  } catch (error) {
    return boardErrorResponse(error);
  }
}

export async function PUT(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const body = await readJsonBody<DecisionDraft>(request);
  if (!body) return invalidJson();
  try {
    return NextResponse.json(await saveDecision(id, body));
  } catch (error) {
    return boardErrorResponse(error);
  }
}
