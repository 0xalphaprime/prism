import { newId } from "./id";
import type { ModelRef } from "./providers";
import type { Node } from "@xyflow/react";
import type {
  IsolationReport,
  JudgeCharacteristics,
  NamedIngest,
  NodeIngest,
  NodeKind,
  NodeMetrics,
  NodePublish,
  PrismNodeData,
  RunStatus,
  StoredRoutePlan,
} from "./types";

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
  namedIngest?: NamedIngest;
  isolation?: IsolationReport;
  metrics?: NodeMetrics;
  provider?: string;
  servedModel?: string;
  finishReason?: string;
  startedAt?: number;
  finishedAt?: number;
  ingestHash?: string;
  truncated?: boolean;
  errorDetail?: string;
  routePlan?: StoredRoutePlan;
  characteristics?: JudgeCharacteristics;
  publish?: NodePublish;
  /** 0-based completion order; missing on older runs */
  step?: number;
};

function callMetaFromNode(node: Node<PrismNodeData>): Partial<NodeResult> {
  const d = node.data;
  return {
    namedIngest: d.namedIngest ?? d.ingest?.named,
    isolation: d.isolation,
    provider: d.provider,
    servedModel: d.servedModel,
    finishReason: d.finishReason,
    startedAt: d.startedAt,
    finishedAt: d.finishedAt,
    ingestHash: d.ingestHash,
    truncated: d.truncated,
    errorDetail: d.errorDetail,
    routePlan: d.routePlan,
    characteristics: d.characteristics,
    publish: d.publish,
  };
}

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
    ...callMetaFromNode(node),
    ...(step != null ? { step } : {}),
  };
}

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

function isTerminal(status: RunStatus | undefined) {
  return status === "done" || status === "error";
}

function keep<T>(next: T | undefined, prev: T | undefined): T | undefined {
  return next !== undefined ? next : prev;
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
      ingest: keep(row.ingest, old?.ingest),
      namedIngest: keep(row.namedIngest, old?.namedIngest),
      isolation: keep(row.isolation, old?.isolation),
      reasoning: keep(row.reasoning, old?.reasoning),
      provider: keep(row.provider, old?.provider),
      servedModel: keep(row.servedModel, old?.servedModel),
      finishReason: keep(row.finishReason, old?.finishReason),
      startedAt: keep(row.startedAt, old?.startedAt),
      finishedAt: keep(row.finishedAt, old?.finishedAt),
      ingestHash: keep(row.ingestHash, old?.ingestHash),
      truncated: keep(row.truncated, old?.truncated),
      errorDetail: keep(row.errorDetail, old?.errorDetail),
      routePlan: keep(row.routePlan, old?.routePlan),
      characteristics: keep(row.characteristics, old?.characteristics),
      publish: keep(row.publish, old?.publish),
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
