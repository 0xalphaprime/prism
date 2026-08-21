import type { Edge, Node } from "@xyflow/react";
import type { ChatRequestBody } from "@/lib/compose-messages";
import {
  chatBodyForNode,
  composeMessages,
  estimateCostUsd,
  parseCharacteristics,
  parseRoutePlan,
  usageFromChatPayload,
} from "@/lib/compose-messages";
import {
  textLooksTruncated,
  type AttachedContext,
} from "@/lib/context-sources";
import { hashJson } from "@/lib/hash";
import { isolationReport } from "@/lib/isolation";
import { parseModelRef } from "@/lib/providers";
import {
  activatedAgentIds,
  childAgents,
  gatherUpstreamPack,
  laneBriefFor,
  packNodeLocalOutput,
  resolveKeepK,
  type RoutePlan,
} from "@/lib/run-graph";
import type {
  NamedIngest,
  NodeIngest,
  NodeMetrics,
  PrismNodeData,
} from "@/lib/types";

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
  finishReason?: string;
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

function namedIngestFor(
  node: Node<PrismNodeData>,
  architecturePrompt: string,
  upstream: Array<{ sourceNodeId: string; label: string }>,
): NamedIngest {
  return {
    runIntent: architecturePrompt.trim() || undefined,
    role: node.data.role?.trim() || undefined,
    steer: node.data.steer?.trim() || undefined,
    nodePrompt: node.data.prompt?.trim() || undefined,
    outputSchema: node.data.outputSchema?.trim() || undefined,
    upstream: upstream
      .filter((c) => !c.sourceNodeId.startsWith("__"))
      .map((c) => ({ id: c.sourceNodeId, label: c.label })),
  };
}

function namedFromIds(
  node: Node<PrismNodeData>,
  nodes: Node<PrismNodeData>[],
  architecturePrompt: string,
  upstreamIds: string[] | undefined,
): NamedIngest {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return namedIngestFor(
    node,
    architecturePrompt,
    (upstreamIds ?? [])
      .filter((id) => !id.startsWith("__"))
      .map((id) => ({
        sourceNodeId: id,
        label: byId.get(id)?.data.label ?? id,
      })),
  );
}

function ingestLooksTruncated(ingest: NodeIngest | undefined, extra?: string) {
  if (textLooksTruncated(extra)) return true;
  if (!ingest) return false;
  return ingest.messages.some((m) => textLooksTruncated(m.content));
}

function stampIngest(args: {
  node: Node<PrismNodeData>;
  nodes: Node<PrismNodeData>[];
  edges: Edge[];
  ingest: NodeIngest;
}): Pick<
  PrismNodeData,
  "ingest" | "namedIngest" | "isolation" | "ingestHash" | "truncated"
> {
  const { node, nodes, edges, ingest } = args;
  return {
    ingest,
    namedIngest: ingest.named,
    isolation: isolationReport({
      nodeId: node.id,
      nodes,
      edges,
      upstreamIds: ingest.upstreamIds,
    }),
    ingestHash: hashJson(ingest.messages),
    truncated: ingestLooksTruncated(ingest),
  };
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
  const named = namedIngestFor(node, architecturePrompt, upstream);
  return {
    model: body.model,
    temperature: body.temperature,
    maxTokens: body.max_tokens,
    keepK,
    laneBrief,
    upstreamIds: upstream.map((c) => c.sourceNodeId),
    messages,
    named,
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
    if (node.data.kind === "context" || node.data.kind === "context-source") {
      if (node.data.isolation && node.data.truncated !== undefined) return node;
      const output =
        node.data.output ?? packNodeLocalOutput(node, attachedContext);
      return {
        ...node,
        data: {
          ...node.data,
          truncated: node.data.truncated ?? textLooksTruncated(output),
          isolation:
            node.data.isolation ??
            isolationReport({ nodeId: node.id, nodes, edges, upstreamIds: [] }),
        },
      };
    }
    if (node.data.kind !== "router" && node.data.kind !== "agent" && node.data.kind !== "merge") {
      return node;
    }
    const ingest =
      node.data.ingest ??
      buildNodeIngest({
        node,
        nodes,
        edges,
        attachedContext,
        architecturePrompt,
        activeRoutePlan: null,
      });
    if (!ingest) return node;
    const needsStamp =
      !node.data.namedIngest || !node.data.isolation || !node.data.ingestHash;
    if (node.data.ingest && !needsStamp) return node;
    const named =
      ingest.named ??
      namedFromIds(node, nodes, architecturePrompt, ingest.upstreamIds);
    const filled: NodeIngest = { ...ingest, named };
    return {
      ...node,
      data: { ...node.data, ...stampIngest({ node, nodes, edges, ingest: filled }) },
    };
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
  const startedAt = Date.now();

  // Pack-only steps
  if (kind === "context-source" || kind === "context") {
    const output = packNodeLocalOutput(node, attachedContext);
    const finishedAt = Date.now();
    return {
      nodeId,
      patch: {
        status: "done",
        output,
        metrics: undefined,
        startedAt,
        finishedAt,
        truncated: textLooksTruncated(output),
        isolation: isolationReport({
          nodeId,
          nodes,
          edges,
          upstreamIds: [],
        }),
      },
      sidePatches: [],
    };
  }

  if (kind !== "router" && kind !== "agent" && kind !== "merge") {
    return {
      nodeId,
      patch: {
        status: "done",
        output: `(skipped unsupported kind: ${kind})`,
        startedAt,
        finishedAt: Date.now(),
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
        startedAt,
        finishedAt: Date.now(),
        errorDetail: "Missing ingest",
      },
      sidePatches: [],
      error: "Missing ingest",
    };
  }
  const stamped = stampIngest({ node, nodes, edges, ingest });
  const body = chatBodyForNode(node, ingest.messages);
  const requestedProvider = parseModelRef(body.model)?.provider;
  const result = await callChat(body, chat);
  const finishedAt = Date.now();

  if (!result.ok) {
    return {
      nodeId,
      patch: {
        status: "error",
        output: `Error: ${result.error}`,
        ...stamped,
        provider: requestedProvider,
        startedAt,
        finishedAt,
        errorDetail: result.error,
      },
      sidePatches: [],
      error: result.error,
    };
  }

  const content = (result.data.content ?? "").trim() || "(empty model response)";
  const reasoning = result.data.reasoning?.trim() || undefined;
  const metrics = metricsFromChat(result.data, body.model);
  const callMeta: Partial<PrismNodeData> = {
    ...stamped,
    provider: result.data.provider ?? requestedProvider,
    servedModel: result.data.model,
    finishReason: result.data.finishReason,
    startedAt,
    finishedAt,
  };

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
          startedAt,
          finishedAt,
        },
      }));

    return {
      nodeId,
      patch: {
        status: "done",
        output: content,
        reasoning,
        metrics,
        routePlan: plan ?? undefined,
        ...callMeta,
      },
      sidePatches,
      routePlan: plan,
    };
  }

  const characteristics =
    kind === "merge" ? parseCharacteristics(content) ?? undefined : undefined;

  return {
    nodeId,
    patch: {
      status: "done",
      output: content,
      reasoning,
      metrics,
      characteristics,
      ...callMeta,
    },
    sidePatches: [],
  };
}
