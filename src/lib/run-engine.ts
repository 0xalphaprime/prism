import type { Edge, Node } from "@xyflow/react";
import type { ChatRequestBody } from "@/lib/compose-messages";
import {
  chatBodyForNode,
  composeMessages,
  estimateCostUsd,
  parseRoutePlan,
  usageFromChatPayload,
} from "@/lib/compose-messages";
import type { AttachedContext } from "@/lib/context-sources";
import {
  activatedAgentIds,
  childAgents,
  gatherUpstreamPack,
  laneBriefFor,
  packNodeLocalOutput,
  resolveKeepK,
  type RoutePlan,
} from "@/lib/run-graph";
import type { NodeMetrics, NodeIngest, PrismNodeData } from "@/lib/types";

export type NodeStepResult = {
  nodeId: string;
  patch: Partial<PrismNodeData>;
  /** Extra patches (e.g. skipped agents after Split) */
  sidePatches: Array<{ nodeId: string; patch: Partial<PrismNodeData> }>;
  routePlan?: RoutePlan | null;
  error?: string;
};

type ChatApiOk = {
  content?: string;
  reasoning?: string;
  usage?: unknown;
  latencyMs?: number;
  model?: string;
  provider?: string;
};

export type ChatFn = (
  body: ChatRequestBody,
) => Promise<{ ok: true; data: ChatApiOk } | { ok: false; error: string }>;

async function callChat(
  body: ChatRequestBody,
  chat?: ChatFn,
): Promise<{ ok: true; data: ChatApiOk } | { ok: false; error: string }> {
  if (chat) return chat(body);
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as ChatApiOk & {
      error?: string;
      detail?: unknown;
    };
    if (!res.ok) {
      const detail =
        typeof data.detail === "string"
          ? data.detail
          : data.error || `HTTP ${res.status}`;
      return { ok: false, error: detail };
    }
    return { ok: true, data };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function metricsFromChat(
  data: ChatApiOk,
  modelRef: string,
): NodeMetrics {
  const { tokensIn, tokensOut } = usageFromChatPayload(data.usage);
  const metrics: NodeMetrics = {
    latencyMs: data.latencyMs,
    tokensIn,
    tokensOut,
  };
  if (tokensIn != null || tokensOut != null) {
    metrics.costUsd = estimateCostUsd(
      modelRef,
      tokensIn ?? 0,
      tokensOut ?? 0,
    );
  }
  return metrics;
}

function buildNodeIngest(args: {
  node: Node<PrismNodeData>;
  nodes: Node<PrismNodeData>[];
  edges: Edge[];
  attachedContext: AttachedContext[];
  architecturePrompt: string;
  activeRoutePlan: RoutePlan | null;
}): NodeIngest | undefined {
  const { node, nodes, edges, attachedContext, architecturePrompt, activeRoutePlan } =
    args;
  const kind = node.data.kind;
  if (kind !== "router" && kind !== "agent" && kind !== "merge") return undefined;

  const keepK = resolveKeepK(node, nodes, edges);
  const laneBrief =
    kind === "agent" ? laneBriefFor(activeRoutePlan, node.id) : undefined;
  const upstream = gatherUpstreamPack(node.id, nodes, edges, attachedContext, {
    keepK,
    laneBrief,
  });
  const children = kind === "router" ? childAgents(node.id, nodes, edges) : [];
  const messages = composeMessages({
    architecturePrompt,
    node,
    upstream,
    childAgents: children.map((c) => ({
      id: c.id,
      label: c.data.label,
      role: c.data.role,
    })),
  });
  const body = chatBodyForNode(node, messages);
  return {
    model: body.model,
    temperature: body.temperature,
    maxTokens: body.max_tokens,
    keepK,
    laneBrief,
    upstreamIds: upstream.map((c) => c.sourceNodeId),
    messages,
  };
}

/** Rebuild ingest from a finished graph (seeded runs, older traces). */
export function backfillIngestOnNodes(
  nodes: Node<PrismNodeData>[],
  edges: Edge[],
  architecturePrompt: string,
  attachedContext: AttachedContext[] = [],
): Node<PrismNodeData>[] {
  return nodes.map((node) => {
    if (node.data.ingest) return node;
    if (node.data.kind !== "router" && node.data.kind !== "agent" && node.data.kind !== "merge") {
      return node;
    }
    const ingest = buildNodeIngest({
      node,
      nodes,
      edges,
      attachedContext,
      architecturePrompt,
      activeRoutePlan: null,
    });
    return ingest ? { ...node, data: { ...node.data, ingest } } : node;
  });
}

/**
 * Execute a single ready node. Caller sets status=running before await.
 */
export async function executeNodeStep(args: {
  nodeId: string;
  nodes: Node<PrismNodeData>[];
  edges: Edge[];
  attachedContext: AttachedContext[];
  architecturePrompt: string;
  activeRoutePlan: RoutePlan | null;
  chat?: ChatFn;
}): Promise<NodeStepResult> {
  const {
    nodeId,
    nodes,
    edges,
    attachedContext,
    architecturePrompt,
    activeRoutePlan,
    chat,
  } = args;
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) {
    return {
      nodeId,
      patch: { status: "error", output: "Node not found" },
      sidePatches: [],
      error: "Node not found",
    };
  }

  const kind = node.data.kind;

  // Pack-only steps
  if (kind === "context-source" || kind === "context") {
    const output = packNodeLocalOutput(node, attachedContext);
    return {
      nodeId,
      patch: { status: "done", output, metrics: undefined },
      sidePatches: [],
    };
  }

  if (kind !== "router" && kind !== "agent" && kind !== "merge") {
    return {
      nodeId,
      patch: {
        status: "done",
        output: `(skipped unsupported kind: ${kind})`,
      },
      sidePatches: [],
    };
  }

  const ingest = buildNodeIngest({
    node,
    nodes,
    edges,
    attachedContext,
    architecturePrompt,
    activeRoutePlan,
  });
  if (!ingest) {
    return {
      nodeId,
      patch: {
        status: "error",
        output: "Could not assemble ingest for this node",
      },
      sidePatches: [],
      error: "Missing ingest",
    };
  }
  const body = chatBodyForNode(node, ingest.messages);
  const result = await callChat(body, chat);

  if (!result.ok) {
    return {
      nodeId,
      patch: {
        status: "error",
        output: `Error: ${result.error}`,
        ingest,
      },
      sidePatches: [],
      error: result.error,
    };
  }

  const content = (result.data.content ?? "").trim() || "(empty model response)";
  const reasoning = result.data.reasoning?.trim() || undefined;
  const metrics = metricsFromChat(result.data, body.model);

  if (kind === "router") {
    const children = childAgents(nodeId, nodes, edges);
    const plan = parseRoutePlan(
      content,
      children.map((c) => c.id),
    );
    const activated = activatedAgentIds(plan, nodeId, nodes, edges);
    const sidePatches = children
      .filter((c) => !activated.has(c.id))
      .map((c) => ({
        nodeId: c.id,
        patch: {
          status: "done" as const,
          output: `[Skipped by Split] Not activated in route plan.${
            plan?.rationale ? ` Rationale: ${plan.rationale}` : ""
          }`,
          metrics: undefined,
        },
      }));

    return {
      nodeId,
      patch: { status: "done", output: content, reasoning, metrics, ingest },
      sidePatches,
      routePlan: plan,
    };
  }

  return {
    nodeId,
    patch: { status: "done", output: content, reasoning, metrics, ingest },
    sidePatches: [],
  };
}
