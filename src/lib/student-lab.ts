import { SAMPLE_LEFTOVERS_V1 } from "./eval/sets";
import type { NodeMetrics, RunStatus } from "./types";

/** Public default: the fictional polarity card (meeting ≠ conversion). */
export const SAMPLE_STUDENT_SEED_ID = "sample-polarity-1";

type SeedCard = { id: string; prompt: string; allowedContext: string };

/**
 * Local override. `PRISM_STUDENT_SEED_ID` in `.env.local` names a card in a
 * private eval set; next.config.ts inlines that card as `PRISM_STUDENT_SEED`.
 */
function privateSeed(): SeedCard | null {
  const raw = process.env.PRISM_STUDENT_SEED?.trim();
  if (!raw) return null;
  try {
    const card = JSON.parse(raw) as SeedCard;
    return card.id && card.prompt?.trim() && card.allowedContext?.trim() ? card : null;
  } catch {
    return null;
  }
}

const seedItem: SeedCard | undefined =
  privateSeed() ??
  SAMPLE_LEFTOVERS_V1.items.find((item) => item.id === SAMPLE_STUDENT_SEED_ID);
if (!seedItem?.prompt.trim() || !seedItem.allowedContext.trim()) {
  throw new Error(`Student lab seed “${SAMPLE_STUDENT_SEED_ID}” is not a signed card`);
}

export const STUDENT_LAB_SEED_ID = seedItem.id;

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
