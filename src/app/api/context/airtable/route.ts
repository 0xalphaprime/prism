import { NextResponse } from "next/server";
import {
  listAirtableBases,
  listAirtableRecords,
  listAirtableTables,
} from "@/lib/server/feed-connections";

export const runtime = "nodejs";

const BASE_ID = /^app[a-zA-Z0-9]+$/;
const TABLE_ID = /^tbl[a-zA-Z0-9]+$/;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const baseId = searchParams.get("base") ?? "";
  const tableId = searchParams.get("table") ?? "";
  const tableName = searchParams.get("tableName") ?? "";
  const q = searchParams.get("q") ?? "";

  try {
    if (!baseId) {
      const bases = await listAirtableBases();
      return NextResponse.json({ bases });
    }
    if (!BASE_ID.test(baseId)) {
      return NextResponse.json({ error: "Invalid base id" }, { status: 400 });
    }
    if (!tableId) {
      const tables = await listAirtableTables(baseId);
      return NextResponse.json({ tables });
    }
    if (!TABLE_ID.test(tableId)) {
      return NextResponse.json({ error: "Invalid table id" }, { status: 400 });
    }
    const items = await listAirtableRecords({
      baseId,
      tableId,
      tableName: tableName || undefined,
      query: q,
    });
    return NextResponse.json({ items });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = /AIRTABLE_PAT/i.test(message) ? 503 : 502;
    return NextResponse.json({ error: message, items: [], bases: [], tables: [] }, { status });
  }
}
