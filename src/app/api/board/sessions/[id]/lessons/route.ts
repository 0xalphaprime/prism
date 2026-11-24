import { NextResponse } from "next/server";
import { boardErrorResponse, invalidJson, readJsonBody } from "@/lib/board/http";
import { decideLesson } from "@/lib/board/lessons";
import { readSessionView } from "@/lib/board/session-store";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

type Body = { member?: string; lesson?: string; action?: string; text?: string };

/** Approves (optionally reworded) or rejects one proposed lesson. Only approval writes to the member's file. */
export async function POST(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const body = await readJsonBody<Body>(request);
  if (!body) return invalidJson();
  if (body.action !== "approve" && body.action !== "reject") {
    return NextResponse.json({ error: "Say whether to approve or reject the lesson" }, { status: 400 });
  }
  try {
    const result = await decideLesson(id, String(body.member ?? ""), String(body.lesson ?? ""), {
      approve: body.action === "approve",
      text: typeof body.text === "string" ? body.text : undefined,
    });
    return NextResponse.json({ file: result.file, session: await readSessionView(id) });
  } catch (error) {
    return boardErrorResponse(error);
  }
}
