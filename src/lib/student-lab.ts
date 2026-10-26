import { PRIME_LEFTOVERS_V1 } from "./eval/sets";
import type { NodeMetrics, RunStatus } from "./types";

/**
 * Signed Oak Hill / Vidonic card from prime-leftovers.v1. missing-fact-8 is OUT
 * (frozen, never signed) — do not point the lab back at it.
 */
export const STUDENT_LAB_SEED_ID = "polarity-vidonic-1";

const seedItem = PRIME_LEFTOVERS_V1.items.find(
  (item) => item.id === STUDENT_LAB_SEED_ID,
);
if (!seedItem?.prompt.trim() || !seedItem.allowedContext.trim()) {
  throw new Error(`Student lab seed “${STUDENT_LAB_SEED_ID}” is not a signed card`);
}

export const STUDENT_LAB_PROMPT = seedItem.prompt;

export const STUDENT_LAB_HUB = seedItem.allowedContext;

export const STUDENT_LAB_STEP_ORDER = [
  "context",
  "student",
  "teacher",
  "critique",
  "judge",
  "informed",
] as const;

export type StudentLabNodeResult = {
  id: string;
  label: string;
  model?: string;
  status: RunStatus;
  output?: string;
  metrics?: NodeMetrics;
};

export type StudentLabSeed = {
  id: string;
  prompt: string;
  hubContent: string;
  finishedAt: number;
  error?: string;
  nodes: StudentLabNodeResult[];
};
