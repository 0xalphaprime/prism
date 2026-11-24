import { NextResponse } from "next/server";
import { removeHandoff } from "@/lib/board/decisions";
import { boardErrorResponse } from "@/lib/board/http";
import { deleteSession, readSessionView } from "@/lib/board/session-store";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  try {
    return NextResponse.json({ session: await readSessionView(id) });
  } catch (error) {
    return boardErrorResponse(error);
  }
}

export async function DELETE(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  try {
    const result = await deleteSession(id);
    await removeHandoff(id);
    return NextResponse.json(result);
  } catch (error) {
    return boardErrorResponse(error);
  }
}
