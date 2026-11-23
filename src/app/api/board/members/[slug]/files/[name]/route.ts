import { NextResponse } from "next/server";
import { boardErrorResponse, invalidJson, readJsonBody } from "@/lib/board/http";
import { deleteMemberFile, saveMemberFile } from "@/lib/board/store";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ slug: string; name: string }> };

export async function PUT(request: Request, ctx: Ctx) {
  const { slug, name } = await ctx.params;
  const body = await readJsonBody<{ content?: string }>(request);
  if (!body) return invalidJson();
  try {
    const member = await saveMemberFile(slug, name, body.content ?? "");
    return NextResponse.json({ member });
  } catch (error) {
    return boardErrorResponse(error);
  }
}

export async function DELETE(_request: Request, ctx: Ctx) {
  const { slug, name } = await ctx.params;
  try {
    const member = await deleteMemberFile(slug, name);
    return NextResponse.json({ member });
  } catch (error) {
    return boardErrorResponse(error);
  }
}
