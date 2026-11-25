import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { asEvalSet, SAMPLE_LEFTOVERS_V1 } from "./sets";
import type { EvalSet } from "./types";

/**
 * Server-only. Do not import from client components — Turbopack cannot
 * chunk `node:fs` into `/eval`.
 *
 * Two places hold eval sets:
 * - `data/eval/sample-leftovers.v1.json` — public, fictional, committed.
 * - the private folder (default `data/eval/private/`, git-ignored; override
 *   with `PRISM_PRIVATE_EVAL_DIR`) — real company sets. Never committed.
 */
export const SAMPLE_LEFTOVERS_PATH = path.join(
  process.cwd(),
  "data",
  "eval",
  "sample-leftovers.v1.json",
);

export function privateEvalDir(): string {
  return (
    process.env.PRISM_PRIVATE_EVAL_DIR?.trim() ||
    path.join(process.cwd(), "data", "eval", "private")
  );
}

export type EvalSetOnDisk = { set: EvalSet; file: string; private: boolean };

function readSet(file: string): EvalSet | null {
  try {
    return asEvalSet(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return null;
  }
}

function listPrivateSets(): EvalSetOnDisk[] {
  const dir = privateEvalDir();
  let names: string[];
  try {
    names = readdirSync(dir).filter((name) => name.endsWith(".json")).sort();
  } catch {
    return [];
  }
  const rows: EvalSetOnDisk[] = [];
  for (const name of names) {
    const file = path.join(dir, name);
    const set = readSet(file);
    if (set) rows.push({ set, file, private: true });
  }
  return rows;
}

/** Private sets first (so the Eval page defaults to them), then the public sample. */
export function listEvalSetFiles(): EvalSetOnDisk[] {
  const rows = listPrivateSets();
  if (!rows.some((row) => row.set.id === SAMPLE_LEFTOVERS_V1.id)) {
    rows.push({
      set: readSet(SAMPLE_LEFTOVERS_PATH) ?? SAMPLE_LEFTOVERS_V1,
      file: SAMPLE_LEFTOVERS_PATH,
      private: false,
    });
  }
  return rows;
}

export function listEvalSetsLive(): EvalSet[] {
  return listEvalSetFiles().map((row) => row.set);
}

export function getEvalSetLive(id: string): EvalSet | undefined {
  return listEvalSetsLive().find((set) => set.id === id);
}
