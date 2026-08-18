import type { NodeMetrics, RunStatus } from "./types";

/** Foundry missing-fact leftover #8 — frozen eval text (includes the harness phrase on purpose). */
export const STUDENT_LAB_SEED_ID = "missing-fact-8";

export const STUDENT_LAB_PROMPT =
  "Internal Slack to Prime: did we flip Oak Hill off Vidonic? We do not have product-on-shelf or a first case in this prompt. Colten was in front of Mario Saturday — that is all we know.";

export const STUDENT_LAB_HUB =
  "Sharp edge (Foundry leftover): say we don’t have a fact — never invent logistics, ASP, or case counts. Never write “in this prompt.”\n\nGold notes: competitive ASP unobtainable; cables customer-direct (no lot tracking / no truck); Jeff = THR; VPX = CTH.\n\nThis run: KEEP Colten + Mario Saturday. Do not declare Oak Hill flipped. No product-on-shelf / first case.";

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
