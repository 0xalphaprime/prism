import { NextResponse } from "next/server";
import { boardErrorResponse, invalidJson, readJsonBody } from "@/lib/board/http";
import {
  createMember,
  duplicateMember,
  listMembers,
  membersDir,
  restoreMissingStarters,
  seedStartersOnFirstRun,
} from "@/lib/board/store";
import type { MemberDraft } from "@/lib/board/types";

export const runtime = "nodejs";

export async function GET() {
  try {
    const seeded = await seedStartersOnFirstRun();
    return NextResponse.json({
      members: await listMembers(),
      dir: membersDir(),
      seeded,
    });
  } catch (error) {
    return boardErrorResponse(error);
  }
}

type PostBody = Partial<MemberDraft> & {
  duplicateOf?: string;
  restoreStarters?: boolean;
};

export async function POST(request: Request) {
  const body = await readJsonBody<PostBody>(request);
  if (!body) return invalidJson();
  try {
    if (body.restoreStarters) {
      const added = await restoreMissingStarters();
      return NextResponse.json({ added, members: await listMembers() });
    }
    if (body.duplicateOf) {
      const member = await duplicateMember(body.duplicateOf);
      return NextResponse.json({ member });
    }
    const member = await createMember({
      name: body.name ?? "",
      title: body.title ?? "",
      profile: body.profile ?? "",
      directives: body.directives ?? "",
      model: body.model,
      sources: body.sources,
    });
    return NextResponse.json({ member });
  } catch (error) {
    return boardErrorResponse(error);
  }
}
