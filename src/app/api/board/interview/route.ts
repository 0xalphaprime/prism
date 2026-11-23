import { NextResponse } from "next/server";
import { boardErrorResponse, invalidJson, readJsonBody } from "@/lib/board/http";
import { interviewTurn } from "@/lib/board/interview";
import { boardChat } from "@/lib/board/server";

export const runtime = "nodejs";

type Body = { model?: string; transcript?: unknown; finish?: boolean };

/** One turn of the interview that drafts a new member: returns the next question, or the draft. Saves nothing. */
export async function POST(request: Request) {
  const body = await readJsonBody<Body>(request);
  if (!body) return invalidJson();
  try {
    const reply = await interviewTurn(
      { model: body.model ?? "", transcript: body.transcript, finish: Boolean(body.finish) },
      { chat: boardChat },
    );
    return NextResponse.json(reply);
  } catch (error) {
    return boardErrorResponse(error);
  }
}
