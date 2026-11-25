import { hashJson } from "@/lib/hash";
import bundledSet from "../../../data/eval/sample-leftovers.v1.json";
import type { EvalItem, EvalSet } from "./types";
import { EVAL_SET_FILE_KIND } from "./types";

/** Public, fictional demo set. Real company sets live in `data/eval/private/` (git-ignored). */
export const SAMPLE_LEFTOVERS_SET_ID = "sample-leftovers.v1";

/** Client-safe. Live disk reads live in `sets-disk.ts` (server-only). */
export function asEvalSet(raw: unknown): EvalSet {
  const parsed = raw as EvalSet;
  if (!parsed || parsed.kind !== EVAL_SET_FILE_KIND || !Array.isArray(parsed.items)) {
    throw new Error("Invalid eval set file");
  }
  return parsed;
}

export const SAMPLE_LEFTOVERS_V1 = asEvalSet(bundledSet);

/**
 * Sets the server reported (including private ones that are never bundled).
 * The Eval page registers them once `/api/eval/sets` answers, so reports,
 * stats and train exports can resolve item splits and tags client-side.
 */
const liveSets = new Map<string, EvalSet>();

export function rememberEvalSets(sets: EvalSet[]) {
  for (const set of sets) liveSets.set(set.id, set);
}

export function listEvalSets(): EvalSet[] {
  const bundled = liveSets.has(SAMPLE_LEFTOVERS_V1.id) ? [] : [SAMPLE_LEFTOVERS_V1];
  return [...liveSets.values(), ...bundled];
}

export function getEvalSet(id: string): EvalSet | undefined {
  return listEvalSets().find((set) => set.id === id);
}

export function itemContextHash(item: EvalItem): string {
  return hashJson({
    id: item.id,
    prompt: item.prompt.trim(),
    allowedContext: item.allowedContext.trim(),
  });
}

export function evalSetHash(set: EvalSet): string {
  return hashJson({
    id: set.id,
    items: set.items.map((item) => ({
      id: item.id,
      split: item.split,
      prompt: item.prompt,
      allowedContext: item.allowedContext,
      goldFacts: item.goldFacts,
      forbiddenClaims: item.forbiddenClaims,
      bits: item.bits,
    })),
  });
}

export function runnableItems(set: EvalSet): EvalItem[] {
  return set.items.filter((item) => item.prompt.trim() && item.allowedContext.trim());
}

/** Experiment queue is the ids you imported, in that order — not every runnable shell. */
export function pickRunnableItems(set: EvalSet, itemIds: string[]): EvalItem[] {
  const unique: string[] = [];
  for (const id of itemIds) {
    const trimmed = id.trim();
    if (!trimmed || unique.includes(trimmed)) continue;
    unique.push(trimmed);
  }
  if (!unique.length) {
    throw new Error("Import at least one signed item before creating an experiment");
  }
  const runnable = runnableItems(set);
  return unique.map((id) => {
    const item = runnable.find((row) => row.id === id);
    if (!item) {
      throw new Error(
        `“${id}” is not runnable yet. Import a signed JSON with prompt and allowedContext.`,
      );
    }
    return item;
  });
}
