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
};

export type TalkMutation = {
  summary: string;
  applied: boolean;
};
