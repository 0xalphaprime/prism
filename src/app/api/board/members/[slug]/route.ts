import { NextResponse } from "next/server";
import { boardErrorResponse, invalidJson, readJsonBody } from "@/lib/board/http";
import {
  deleteMember,
  memberDir,
  readMember,
  safeSlug,
  updateMember,
} from "@/lib/board/store";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ slug: string }> };

function notFound() {
  return NextResponse.json({ error: "Member not found" }, { status: 404 });
}

export async function GET(_request: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  try {
    if (!safeSlug(slug)) return notFound();
    const member = await readMember(slug);
    if (!member) return notFound();
    return NextResponse.json({ member, dir: memberDir(slug) });
  } catch (error) {
    return boardErrorResponse(error);
  }
}

type PutBody = {
  name?: string;
  title?: string;
  profile?: string;
  directives?: string;
  model?: string;
};

export async function PUT(request: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const body = await readJsonBody<PutBody>(request);
  if (!body) return invalidJson();
  try {
    const patch: PutBody = {};
    for (const key of ["name", "title", "profile", "directives", "model"] as const) {
      if (typeof body[key] === "string") patch[key] = body[key];
    }
    const member = await updateMember(slug, patch);
    return NextResponse.json({ member, dir: memberDir(slug) });
  } catch (error) {
    return boardErrorResponse(error);
  }
}

export async function DELETE(_request: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  try {
    return NextResponse.json(await deleteMember(slug));
  } catch (error) {
    return boardErrorResponse(error);
  }
}
