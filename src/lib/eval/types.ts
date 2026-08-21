import type { NodeMetrics, RunStatus } from "@/lib/types";
import type { NodeResult, RunRecord } from "@/lib/runs";

export const EXPERIMENT_FILE_KIND = "prism.experiment" as const;
export const EVAL_SET_FILE_KIND = "prism.evalset" as const;
export const TRAIN_FILE_KIND = "prism.train" as const;

export type EvalSplit = "train" | "dev" | "held-out";

export type BinaryBitKind =
  | "must-include"
  | "must-exclude"
  | "must-omit-unknown"
  | "format"
  | "isolation";

export type BinaryBit = {
  id: string;
  kind: BinaryBitKind;
  /** Literal substring or `/regex/flags`. */
  pattern: string;
  weight?: number;
};

export type EvalItem = {
  id: string;
  split: EvalSplit;
  tags: string[];
  prompt: string;
  allowedContext: string;
  goldFacts: string[];
  forbiddenClaims: string[];
  bits: BinaryBit[];
  failureTags: string[];
  referenceAnswer?: string;
};

export type EvalSet = {
  kind: typeof EVAL_SET_FILE_KIND;
  schemaVersion: number;
  id: string;
  name: string;
  description: string;
  items: EvalItem[];
};

export const EVAL_ARCHITECTURE_IDS = [
  "eval-baseline",
  "eval-teacher-refine",
  "eval-teacher-critic",
] as const;

export type EvalArchitectureId = (typeof EVAL_ARCHITECTURE_IDS)[number];

export type ExperimentProfile = {
  temperature?: number;
  seed?: number;
  maxTokens?: number;
};

export type BitResult = {
  id: string;
  kind: BinaryBitKind | "gold" | "forbidden" | "truncated";
  pass: boolean;
  weight: number;
  detail?: string;
};

export type HopScore = {
  output?: string;
  score: number | null;
  bits: BitResult[];
  tags: string[];
  isolationOk: boolean;
  truncated: boolean;
};

export type ExperimentCellTraces = {
  firstNodeId: string;
  revisedNodeId?: string;
  teacher?: string;
  critic?: string;
  judge?: string;
};

export type ExperimentCell = {
  cellId: string;
  itemId: string;
  architectureId: EvalArchitectureId;
  itemHash: string;
  rep: number;
  runId: string;
  status: RunStatus | "cancelled";
  error?: string;
  firstPass: HopScore;
  revised?: HopScore;
  lift: number | null;
  traces: ExperimentCellTraces;
  totals: NodeMetrics;
  nodeResults: NodeResult[];
  run?: RunRecord;
};

export type ExperimentRecord = {
  kind: typeof EXPERIMENT_FILE_KIND;
  schemaVersion: number;
  id: string;
  name: string;
  evalSetId: string;
  architectureIds: EvalArchitectureId[];
  reps: number;
  profile: ExperimentProfile;
  fingerprint: {
    evalSetHash: string;
    archFingerprints: Record<string, string>;
    profileHash: string;
  };
  status: RunStatus | "cancelled";
  createdAt: number;
  updatedAt: number;
  cells: ExperimentCell[];
};
