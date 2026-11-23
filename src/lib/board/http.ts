import { NextResponse } from "next/server";
import { BoardStoreError } from "./store";

export function boardErrorResponse(error: unknown) {
  if (error instanceof BoardStoreError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : String(error);
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function readJsonBody<T>(request: Request): Promise<T | null> {
  try {
    const body = (await request.json()) as unknown;
    return body && typeof body === "object" ? (body as T) : null;
  } catch {
    return null;
  }
}

export function invalidJson() {
  return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
}
