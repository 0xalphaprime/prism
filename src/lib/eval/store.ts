import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { hashJson } from "@/lib/hash";
import { newId } from "@/lib/id";
import { architectureFingerprint } from "./graphs";
import { evalSetHash, getEvalSet, itemContextHash, runnableItems } from "./sets";
import type {
  EvalArchitectureId,
  ExperimentCell,
  ExperimentProfile,
  ExperimentRecord,
} from "./types";
import { EXPERIMENT_FILE_KIND } from "./types";

const DATA_DIR = path.join(process.cwd(), "data", "eval", "experiments");

async function ensureDir() {
  await mkdir(DATA_DIR, { recursive: true });
}

function experimentPath(id: string) {
  return path.join(DATA_DIR, `${id}.json`);
}

export async function listExperiments(): Promise<ExperimentRecord[]> {
  try {
    await ensureDir();
    const names = await readdir(DATA_DIR);
    const rows: ExperimentRecord[] = [];
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      try {
        const raw = await readFile(path.join(DATA_DIR, name), "utf8");
        const parsed = JSON.parse(raw) as ExperimentRecord;
        if (parsed.kind === EXPERIMENT_FILE_KIND) rows.push(parsed);
      } catch {
        // skip corrupt files
      }
    }
    return rows.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export async function readExperiment(id: string): Promise<ExperimentRecord | null> {
  try {
    const raw = await readFile(experimentPath(id), "utf8");
    return JSON.parse(raw) as ExperimentRecord;
  } catch {
    return null;
  }
}

export async function writeExperiment(record: ExperimentRecord) {
  await ensureDir();
  await writeFile(experimentPath(record.id), JSON.stringify(record, null, 2));
}

export function createExperimentRecord(args: {
  evalSetId: string;
  architectureIds: EvalArchitectureId[];
  reps?: number;
  profile?: ExperimentProfile;
  name?: string;
}): ExperimentRecord {
  const set = getEvalSet(args.evalSetId);
  if (!set) throw new Error(`Unknown eval set: ${args.evalSetId}`);
  const items = runnableItems(set);
  if (!items.length) {
    throw new Error("Eval set has no runnable items (need prompt + allowedContext)");
  }
  const architectureIds = args.architectureIds;
  if (!architectureIds.length) throw new Error("Pick at least one architecture");
  const reps = Math.max(1, Math.min(args.reps ?? 1, 8));
  const profile = args.profile ?? {};
  const now = Date.now();
  const id = newId();
  const cells: ExperimentCell[] = [];

  for (const item of items) {
    for (const architectureId of architectureIds) {
      for (let rep = 1; rep <= reps; rep += 1) {
        cells.push({
          cellId: newId(),
          itemId: item.id,
          architectureId,
          itemHash: itemContextHash(item),
          rep,
          runId: newId(),
          status: "idle",
          firstPass: {
            score: null,
            bits: [],
            tags: [],
            isolationOk: true,
            truncated: false,
          },
          lift: architectureId === "eval-baseline" ? null : null,
          traces: { firstNodeId: "student" },
          totals: {},
          nodeResults: [],
        });
      }
    }
  }

  return {
    kind: EXPERIMENT_FILE_KIND,
    schemaVersion: 1,
    id,
    name: args.name?.trim() || `${set.name} · ${new Date(now).toISOString().slice(0, 16)}`,
    evalSetId: set.id,
    architectureIds,
    reps,
    profile,
    fingerprint: {
      evalSetHash: evalSetHash(set),
      archFingerprints: Object.fromEntries(
        architectureIds.map((archId) => [archId, architectureFingerprint(archId)]),
      ),
      profileHash: hashJson(profile),
    },
    status: "idle",
    createdAt: now,
    updatedAt: now,
    cells,
  };
}

export function nextPendingCell(record: ExperimentRecord): ExperimentCell | undefined {
  return record.cells.find((cell) => cell.status === "idle" || cell.status === "ready");
}

export function experimentProgress(record: ExperimentRecord) {
  const total = record.cells.length;
  const done = record.cells.filter((c) => c.status === "done" || c.status === "error").length;
  const errors = record.cells.filter((c) => c.status === "error").length;
  return { total, done, errors, pending: total - done };
}
