import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { runStudentLab } from "@/lib/run-student-lab";
import type { StudentLabSeed } from "@/lib/student-lab";

export const runtime = "nodejs";
export const maxDuration = 300;

const DATA_DIR = path.join(process.cwd(), "data");
const LAST_RUN_PATH = path.join(DATA_DIR, "student-lab-last-run.json");

async function readLastRun(): Promise<StudentLabSeed | null> {
  try {
    const raw = await readFile(LAST_RUN_PATH, "utf8");
    return JSON.parse(raw) as StudentLabSeed;
  } catch {
    return null;
  }
}

async function writeLastRun(seed: StudentLabSeed) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(LAST_RUN_PATH, JSON.stringify(seed, null, 2), "utf8");
}

export async function GET() {
  const seed = await readLastRun();
  if (!seed) {
    return NextResponse.json({ error: "No lab run yet" }, { status: 404 });
  }
  return NextResponse.json(seed);
}

export async function POST() {
  try {
    const seed = await runStudentLab();
    await writeLastRun(seed);
    return NextResponse.json(seed, { status: seed.error ? 502 : 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
