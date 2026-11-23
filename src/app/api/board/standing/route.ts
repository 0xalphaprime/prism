import { NextResponse } from "next/server";
import { boardErrorResponse, invalidJson, readJsonBody } from "@/lib/board/http";
import { readStanding, writeStanding } from "@/lib/board/session-store";
import { boardRoot } from "@/lib/board/store";

export const runtime = "nodejs";

function file() {
  return `${boardRoot()}/standing.md`;
}

export async function GET() {
  try {
    return NextResponse.json({ standing: await readStanding(), file: file() });
  } catch (error) {
    return boardErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  const body = await readJsonBody<{ standing?: string }>(request);
  if (!body) return invalidJson();
  try {
    return NextResponse.json({ standing: await writeStanding(body.standing ?? ""), file: file() });
  } catch (error) {
    return boardErrorResponse(error);
  }
}
