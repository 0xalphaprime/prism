import { hashJson } from "@/lib/hash";
import rawSet from "../../../data/eval/prime-leftovers.v1.json";
import type { EvalItem, EvalSet } from "./types";
import { EVAL_SET_FILE_KIND } from "./types";

function asEvalSet(raw: unknown): EvalSet {
  const parsed = raw as EvalSet;
  if (!parsed || parsed.kind !== EVAL_SET_FILE_KIND || !Array.isArray(parsed.items)) {
    throw new Error("Invalid eval set file");
  }
  return parsed;
}

export const PRIME_LEFTOVERS_V1 = asEvalSet(rawSet);

export const EVAL_SETS: EvalSet[] = [PRIME_LEFTOVERS_V1];

export function listEvalSets(): EvalSet[] {
  return EVAL_SETS;
}

export function getEvalSet(id: string): EvalSet | undefined {
  return EVAL_SETS.find((set) => set.id === id);
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
