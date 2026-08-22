import { readFileSync } from "node:fs";
import path from "node:path";
import { asEvalSet, PRIME_LEFTOVERS_V1 } from "./sets";
import type { EvalSet } from "./types";

/**
 * Server-only. Do not import from client components — Turbopack cannot
 * chunk `node:fs` into `/eval`.
 */
export const PRIME_LEFTOVERS_PATH = path.join(
  process.cwd(),
  "data",
  "eval",
  "prime-leftovers.v1.json",
);

export function loadPrimeLeftoversSet(): EvalSet {
  try {
    return asEvalSet(JSON.parse(readFileSync(PRIME_LEFTOVERS_PATH, "utf8")));
  } catch {
    return PRIME_LEFTOVERS_V1;
  }
}

export function listEvalSetsLive(): EvalSet[] {
  return [loadPrimeLeftoversSet()];
}

export function getEvalSetLive(id: string): EvalSet | undefined {
  return listEvalSetsLive().find((set) => set.id === id);
}
