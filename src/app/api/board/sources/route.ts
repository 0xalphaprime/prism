import { NextResponse } from "next/server";
import { OWN_SOURCE_NAMES } from "@/lib/board/research";
import { ownSourceStatus } from "@/lib/board/server";
import { OWN_SOURCES } from "@/lib/board/types";

export const runtime = "nodejs";

/** Which of the owner's own records a member could search, and why not where one cannot be. */
export async function GET() {
  const status = ownSourceStatus();
  return NextResponse.json({
    sources: OWN_SOURCES.map((id) => ({ id, name: OWN_SOURCE_NAMES[id], ...status[id] })),
  });
}
