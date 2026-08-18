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

export type NamedUpstream = {
  id: string;
  label: string;
};

/** Decomposed knobs that produced ingest.messages — not a second prompt. */
export type NamedIngest = {
  runIntent?: string;
  role?: string;
  steer?: string;
  nodePrompt?: string;
  outputSchema?: string;
  upstream?: NamedUpstream[];
};

export type IsolationSight = {
  id: string;
  label: string;
};

/** Who this hop actually saw vs the rest of the executable graph. */
export type IsolationReport = {
  saw: IsolationSight[];
  notSaw: IsolationSight[];
  ok: boolean;
  forbiddenHits?: string[];
};

export type JudgeCharacteristics = {
  keep: string[];
  omit: string[];
  neverSay: string[];
};

export type StoredRouteLane = {
  nodeId: string;
  activate: boolean;
  brief?: string;
};

export type StoredRoutePlan = {
  lanes: StoredRouteLane[];
  rationale?: string;
};

/** What actually went to the model — not the tile fields. */
export type NodeIngest = {
  model: string;
  temperature?: number;
  maxTokens?: number;
  keepK?: number;
  laneBrief?: string;
  upstreamIds?: string[];
  messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }>;
  named?: NamedIngest;
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
  /** Hidden chain-of-thought when the provider returns it separately */
  reasoning?: string;
  /** Assembled request for this step */
  ingest?: NodeIngest;
  namedIngest?: NamedIngest;
  isolation?: IsolationReport;
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
