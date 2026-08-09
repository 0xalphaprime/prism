import type { ModelRef } from "./providers";
import type { NodeMetrics, RunStatus } from "./types";

/**
 * A single execution of an architecture.
 * Block 2 stores the shell; Block 3 fills nodeResults while running.
 */
export type RunRecord = {
  id: string;
  architectureId: string;
  /** Snapshot of run intent at start */
  prompt: string;
  status: RunStatus | "cancelled";
  startedAt: number;
  finishedAt?: number;
  /** Which pathway / template lineage this run came from */
  pathwayLabel?: string;
  /** Optional parent run when forking / converging experiments */
  parentRunId?: string;
  /** Aggregate metrics */
  totals?: {
    latencyMs?: number;
    tokensIn?: number;
    tokensOut?: number;
    costUsd?: number;
  };
  /** Per-node outcomes for compare / converge UI */
  nodeResults: Array<{
    nodeId: string;
    label: string;
    model?: ModelRef | string;
    status: RunStatus;
    output?: string;
    metrics?: NodeMetrics;
  }>;
  notes?: string;
};

export function createRunStub(args: {
  architectureId: string;
  prompt: string;
  pathwayLabel?: string;
  parentRunId?: string;
}): RunRecord {
  return {
    id: crypto.randomUUID(),
    architectureId: args.architectureId,
    prompt: args.prompt,
    status: "idle",
    startedAt: Date.now(),
    pathwayLabel: args.pathwayLabel,
    parentRunId: args.parentRunId,
    nodeResults: [],
  };
}
