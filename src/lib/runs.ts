import { newId } from "./id";
import type { ModelRef } from "./providers";
import type { NodeKind, NodeIngest, NodeMetrics, RunStatus } from "./types";
import type { Node } from "@xyflow/react";
import type { PrismNodeData } from "./types";

export type NodeResult = {
  nodeId: string;
  label: string;
  kind?: NodeKind;
  role?: string;
  model?: ModelRef | string;
  status: RunStatus;
  output?: string;
  reasoning?: string;
  ingest?: NodeIngest;
  metrics?: NodeMetrics;
  /** 0-based completion order; missing on older runs */
  step?: number;
};

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
  nodeResults: NodeResult[];
  notes?: string;
};

export function nodeResultFromGraphNode(
  node: Node<PrismNodeData>,
  step?: number,
): NodeResult {
  return {
    nodeId: node.id,
    label: node.data.label,
    kind: node.data.kind,
    role: node.data.role,
    model: node.data.model,
    status: node.data.status,
    output: node.data.output,
    reasoning: node.data.reasoning,
    ingest: node.data.ingest,
    metrics: node.data.metrics,
    ...(step != null ? { step } : {}),
  };
}

function isTerminal(status: RunStatus | undefined) {
  return status === "done" || status === "error";
}

/** Keep existing step numbers; assign the next index when a node first finishes. */
export function assignResultSteps(
  previous: NodeResult[] | undefined,
  next: NodeResult[],
): NodeResult[] {
  const prevById = new Map((previous ?? []).map((r) => [r.nodeId, r]));
  let maxStep = -1;
  for (const row of previous ?? []) {
    if (typeof row.step === "number") maxStep = Math.max(maxStep, row.step);
  }

  return next.map((row) => {
    const old = prevById.get(row.nodeId);
    const merged: NodeResult = {
      ...row,
      ingest: row.ingest ?? old?.ingest,
      reasoning: row.reasoning ?? old?.reasoning,
    };
    if (typeof old?.step === "number") return { ...merged, step: old.step };
    const newlyDone = isTerminal(row.status) && !isTerminal(old?.status);
    if (newlyDone) {
      maxStep += 1;
      return { ...merged, step: maxStep };
    }
    return merged;
  });
}

export function createRunStub(args: {
  architectureId: string;
  prompt: string;
  pathwayLabel?: string;
  parentRunId?: string;
}): RunRecord {
  return {
    id: newId(),
    architectureId: args.architectureId,
    prompt: args.prompt,
    status: "idle",
    startedAt: Date.now(),
    pathwayLabel: args.pathwayLabel,
    parentRunId: args.parentRunId,
    nodeResults: [],
  };
}
