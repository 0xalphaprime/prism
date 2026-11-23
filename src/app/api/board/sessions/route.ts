import { NextResponse } from "next/server";
import { boardErrorResponse, invalidJson, readJsonBody } from "@/lib/board/http";
import { createSession, listSessions, sessionsDir } from "@/lib/board/session-store";
import type { SessionDraft } from "@/lib/board/types";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json({ sessions: await listSessions(), dir: sessionsDir() });
  } catch (error) {
    return boardErrorResponse(error);
  }
}

export async function POST(request: Request) {
  const body = await readJsonBody<SessionDraft>(request);
  if (!body) return invalidJson();
  try {
    const session = await createSession(body);
    return NextResponse.json({ id: session.id });
  } catch (error) {
    return boardErrorResponse(error);
  }
}
