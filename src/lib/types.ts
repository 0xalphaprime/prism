import type { ContextSourceKind } from "./context-sources";
import type { ModelRef } from "./providers";

export type NodeKind = "context" | "context-source" | "agent" | "router" | "merge";

export type RunStatus = "idle" | "ready" | "running" | "done" | "error";

/** @deprecated Use ModelRef (`provider:model`) from providers.ts */
export type ModelId = ModelRef;

export type NodeMetrics = {
  latencyMs?: number;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
};

/** Per-node spend ceilings — enforced in Block 3 */
export type NodeBudget = {
  maxTokensOut?: number;
  maxLatencyMs?: number;
  maxCostUsd?: number;
};

/** Sampling controls for reproducible sweeps */
export type NodeSampling = {
  temperature?: number;
  seed?: number;
};

/**
 * SMoA-style forward control: how much upstream talk survives
 * and whether deeper rounds stop early.
 */
export type NodeForward = {
  /** Top-k upstream texts to pass forward (e.g. 3) */
  keepK?: number;
  stopOnConsensus?: boolean;
  /** Cap on refine / debate rounds */
  maxRounds?: number;
};

export type NodePublish = {
  includeInSamples?: boolean;
  redactOutput?: boolean;
};

export type PrismNodeData = {
  kind: NodeKind;
  label: string;
  role?: string;
  /**
   * Proximal guidance for this node’s prompt — short steering that shapes
   * how the role/prompt run against upstream context.
   */
  steer?: string;
  prompt?: string;
  model?: ModelRef;
  content?: string;
  output?: string;
  status: RunStatus;
  metrics?: NodeMetrics;
  /** Set on context-source tiles — which channel this upstream node owns */
  sourceKind?: ContextSourceKind;
  budget?: NodeBudget;
  sampling?: NodeSampling;
  /** Narrow tool names/ids this node may use (keep ≤~5) */
  toolsAllowlist?: string[];
  /** Short schema or shape the output should follow */
  outputSchema?: string;
  /** Keep-k / early-stop — typically on router or merge */
  forward?: NodeForward;
  /** Checklist for later run compare / Judge */
  evalRubric?: string;
  publish?: NodePublish;
};

export type TalkMutation = {
  summary: string;
  applied: boolean;
};
