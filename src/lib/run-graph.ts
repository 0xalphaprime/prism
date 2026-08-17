import type { Edge, Node } from "@xyflow/react";
import {
  truncateContextText,
  type AttachedContext,
} from "@/lib/context-sources";
import type { PrismNodeData, RunStatus } from "@/lib/types";

export type UpstreamChunk = {
  sourceNodeId: string;
  label: string;
  kind: PrismNodeData["kind"];
  text: string;
};

export type RouteLane = {
  nodeId: string;
  activate: boolean;
  brief?: string;
};

export type RoutePlan = {
  lanes: RouteLane[];
  rationale?: string;
};

/** Nodes that can be advanced by Step (pack or LLM). */
export function isExecutableKind(kind: PrismNodeData["kind"]): boolean {
  return (
    kind === "context-source" ||
    kind === "context" ||
    kind === "router" ||
    kind === "agent" ||
    kind === "merge"
  );
}

export function isLlmKind(kind: PrismNodeData["kind"]): boolean {
  return kind === "router" || kind === "agent" || kind === "merge";
}

export function isTerminalStatus(status: RunStatus | undefined): boolean {
  return status === "done" || status === "error";
}

export function directParents(
  nodeId: string,
  edges: Edge[],
): string[] {
  return edges.filter((e) => e.target === nodeId).map((e) => e.source);
}

export function directChildren(
  nodeId: string,
  edges: Edge[],
): string[] {
  return edges.filter((e) => e.source === nodeId).map((e) => e.target);
}

export function nodeById(
  nodes: Node<PrismNodeData>[],
  id: string,
): Node<PrismNodeData> | undefined {
  return nodes.find((n) => n.id === id);
}

/** Kahn topological order. Within a layer, left-to-right on the canvas (then y, then id). */
export function topoOrder(
  nodes: Node<PrismNodeData>[],
  edges: Edge[],
): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const ids = new Set(nodes.map((n) => n.id));
  const indeg = new Map<string, number>();
  const outs = new Map<string, string[]>();

  const byCanvas = (a: string, b: string) => {
    const na = byId.get(a);
    const nb = byId.get(b);
    const dx = (na?.position.x ?? 0) - (nb?.position.x ?? 0);
    if (dx !== 0) return dx;
    const dy = (na?.position.y ?? 0) - (nb?.position.y ?? 0);
    if (dy !== 0) return dy;
    return a.localeCompare(b);
  };

  for (const id of ids) {
    indeg.set(id, 0);
    outs.set(id, []);
  }

  for (const e of edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) continue;
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
    outs.get(e.source)!.push(e.target);
  }

  const ready = [...ids]
    .filter((id) => (indeg.get(id) ?? 0) === 0)
    .sort(byCanvas);
  const order: string[] = [];

  while (ready.length) {
    const id = ready.shift()!;
    order.push(id);
    for (const child of (outs.get(id) ?? []).slice().sort(byCanvas)) {
      const next = (indeg.get(child) ?? 0) - 1;
      indeg.set(child, next);
      if (next === 0) ready.push(child);
      ready.sort(byCanvas);
    }
  }

  for (const id of [...ids].sort(byCanvas)) {
    if (!order.includes(id)) order.push(id);
  }
  return order;
}

export function isReady(
  nodeId: string,
  nodes: Node<PrismNodeData>[],
  edges: Edge[],
): boolean {
  const node = nodeById(nodes, nodeId);
  if (!node || !isExecutableKind(node.data.kind)) return false;
  if (isTerminalStatus(node.data.status)) return false;

  const parents = directParents(nodeId, edges);
  if (!parents.length) return true;

  return parents.every((pid) => {
    const p = nodeById(nodes, pid);
    return p ? isTerminalStatus(p.data.status) : true;
  });
}

/**
 * Next unfinished ready node in topo order.
 * Prefer selected router/agent/merge when that node is ready.
 */
export function nextSteppable(
  nodes: Node<PrismNodeData>[],
  edges: Edge[],
  selectedId?: string | null,
): string | null {
  if (selectedId) {
    const sel = nodeById(nodes, selectedId);
    if (
      sel &&
      isLlmKind(sel.data.kind) &&
      isReady(selectedId, nodes, edges)
    ) {
      return selectedId;
    }
  }

  for (const id of topoOrder(nodes, edges)) {
    if (isReady(id, nodes, edges)) return id;
  }
  return null;
}

export function childAgents(
  routerId: string,
  nodes: Node<PrismNodeData>[],
  edges: Edge[],
): Node<PrismNodeData>[] {
  return directChildren(routerId, edges)
    .map((id) => nodeById(nodes, id))
    .filter((n): n is Node<PrismNodeData> => Boolean(n && n.data.kind === "agent"));
}

export function activatedAgentIds(
  plan: RoutePlan | null | undefined,
  routerId: string,
  nodes: Node<PrismNodeData>[],
  edges: Edge[],
): Set<string> {
  const children = childAgents(routerId, nodes, edges);
  const all = new Set(children.map((c) => c.id));
  if (!plan?.lanes?.length) return all;

  const activated = new Set(
    plan.lanes
      .filter((l) => l.activate && all.has(l.nodeId))
      .map((l) => l.nodeId),
  );
  return activated.size ? activated : all;
}

export function laneBriefFor(
  plan: RoutePlan | null | undefined,
  agentId: string,
): string | undefined {
  return plan?.lanes.find((l) => l.nodeId === agentId && l.activate)?.brief;
}

function attachmentText(item: AttachedContext): string {
  const parts: string[] = [`### ${item.title}`];
  if (item.subtitle) parts.push(item.subtitle);
  if (item.payload?.url) parts.push(`URL: ${item.payload.url}`);
  if (item.payload?.text) {
    parts.push(truncateContextText(item.payload.text, 8_000));
  }
  if (!item.payload?.text && !item.payload?.url) {
    parts.push("(no payload text)");
  }
  return parts.join("\n");
}

function packAttachmentsForNode(
  node: Node<PrismNodeData>,
  attached: AttachedContext[],
): string {
  if (node.data.kind === "context-source") {
    const items = attached.filter(
      (a) =>
        a.sourceNodeId === node.id ||
        (node.data.sourceKind && a.kind === node.data.sourceKind),
    );
    if (!items.length) return "(empty — no attachments on this channel)";
    return items.map(attachmentText).join("\n\n");
  }

  if (node.data.kind === "context") {
    const parts: string[] = [];
    if (node.data.content?.trim()) {
      parts.push(`## Hub notes\n${node.data.content.trim()}`);
    }
    if (attached.length) {
      parts.push(
        `## Attached context\n${attached.map(attachmentText).join("\n\n")}`,
      );
    }
    return parts.length
      ? parts.join("\n\n")
      : "(empty hub — no notes or attachments)";
  }

  return "";
}

/**
 * Gather direct-upstream texts for a consumer node.
 * Applies keep-k to prior agent/merge outputs when `keepK` is set.
 */
export function gatherUpstreamPack(
  nodeId: string,
  nodes: Node<PrismNodeData>[],
  edges: Edge[],
  attached: AttachedContext[],
  opts?: { keepK?: number; laneBrief?: string },
): UpstreamChunk[] {
  const parents = directParents(nodeId, edges)
    .map((id) => nodeById(nodes, id))
    .filter((n): n is Node<PrismNodeData> => Boolean(n));

  const chunks: UpstreamChunk[] = [];

  for (const parent of parents) {
    let text = parent.data.output?.trim() ?? "";
    if (!text && (parent.data.kind === "context" || parent.data.kind === "context-source")) {
      text = packAttachmentsForNode(parent, attached);
    }
    if (!text) continue;
    chunks.push({
      sourceNodeId: parent.id,
      label: parent.data.label,
      kind: parent.data.kind,
      text,
    });
  }

  const keepK = opts?.keepK;
  if (keepK != null && keepK > 0) {
    const agentish = chunks.filter(
      (c) => c.kind === "agent" || c.kind === "merge",
    );
    const other = chunks.filter(
      (c) => c.kind !== "agent" && c.kind !== "merge",
    );
    // Prefer longer / more recent (later in list ≈ later topo among siblings)
    const ranked = [...agentish].sort((a, b) => b.text.length - a.text.length);
    const kept = ranked.slice(0, keepK);
    // Preserve original parent order among kept
    const keptIds = new Set(kept.map((k) => k.sourceNodeId));
    const filteredAgents = agentish.filter((c) => keptIds.has(c.sourceNodeId));
    chunks.length = 0;
    chunks.push(...other, ...filteredAgents);
  }

  if (opts?.laneBrief?.trim()) {
    chunks.unshift({
      sourceNodeId: "__lane_brief__",
      label: "Lane brief (from Split)",
      kind: "router",
      text: opts.laneBrief.trim(),
    });
  }

  return chunks;
}

/** Serialize attachments for a pack-only step (channel or hub). */
export function packNodeLocalOutput(
  node: Node<PrismNodeData>,
  attached: AttachedContext[],
): string {
  return packAttachmentsForNode(node, attached);
}

export function resolveKeepK(
  node: Node<PrismNodeData>,
  nodes: Node<PrismNodeData>[],
  edges: Edge[],
): number | undefined {
  if (node.data.forward?.keepK != null) return node.data.forward.keepK;
  // Nearest upstream router/merge with keepK
  for (const pid of directParents(node.id, edges)) {
    const p = nodeById(nodes, pid);
    if (p?.data.forward?.keepK != null) return p.data.forward.keepK;
  }
  return undefined;
}
