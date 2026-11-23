import { NextResponse } from "next/server";
import { handoffDir, listDecisions } from "@/lib/board/decisions";
import { boardErrorResponse } from "@/lib/board/http";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json({ decisions: await listDecisions(), handoffDir: handoffDir() });
  } catch (error) {
    return boardErrorResponse(error);
  }
}
