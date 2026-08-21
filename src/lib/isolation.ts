import type { Edge, Node } from "@xyflow/react";
import { directParents, isExecutableKind } from "@/lib/run-graph";
import {
  HUB_ONLY_SPECIALIST_IDS,
  INFORMED_NODE_ID,
  STUDENT_NODE_ID,
} from "@/lib/student-graph";
import type { IsolationReport, IsolationSight, PrismNodeData } from "@/lib/types";

function sight(node: Node<PrismNodeData>): IsolationSight {
  return { id: node.id, label: node.data.label };
}

function realUpstreamIds(ids: string[] | undefined): string[] {
  return (ids ?? []).filter((id) => id && !id.startsWith("__"));
}

function parentSet(nodeId: string, edges: Edge[] | undefined): Set<string> {
  return new Set(edges ? directParents(nodeId, edges) : []);
}

/**
 * Per-architecture isolation.
 * - Teacher/Critic with no student parent edge must not see Nemo (classic lab).
 * - Teacher with a student parent edge must see Nemo (eval refine).
 * - Informed with no teacher/critic parent edges must not ingest their prose
 *   (eval teacher+critic card-only hop).
 */
export function isolationForbiddenHits(
  nodeId: string,
  nodes: Node<PrismNodeData>[],
  upstreamIds: string[] | undefined,
  edges?: Edge[],
): string[] {
  const ids = new Set(nodes.map((n) => n.id));
  const up = realUpstreamIds(upstreamIds);
  const parents = parentSet(nodeId, edges);
  const hits: string[] = [];

  if (
    ids.has(STUDENT_NODE_ID) &&
    (HUB_ONLY_SPECIALIST_IDS as readonly string[]).includes(nodeId)
  ) {
    if (parents.has(STUDENT_NODE_ID)) {
      if (!up.includes(STUDENT_NODE_ID)) hits.push(STUDENT_NODE_ID);
    } else if (ids.has("teacher") || ids.has("critique")) {
      hits.push(...up.filter((id) => id === STUDENT_NODE_ID));
    }
  }

  if (nodeId === INFORMED_NODE_ID && ids.has(STUDENT_NODE_ID)) {
    const cardOnly = !parents.has("teacher") && !parents.has("critique");
    if (cardOnly && parents.size > 0) {
      hits.push(...up.filter((id) => id === "teacher" || id === "critique"));
    }
  }

  return hits;
}

export function isolationReport(args: {
  nodeId: string;
  nodes: Node<PrismNodeData>[];
  edges?: Edge[];
  upstreamIds?: string[];
}): IsolationReport {
  const { nodeId, nodes, edges, upstreamIds } = args;
  const peers = nodes.filter((n) => isExecutableKind(n.data.kind));
  const up = new Set(realUpstreamIds(upstreamIds));
  const saw = peers
    .filter((n) => n.id !== nodeId && up.has(n.id))
    .map(sight);
  const notSaw = peers
    .filter((n) => n.id !== nodeId && !up.has(n.id))
    .map(sight);
  const forbiddenHits = isolationForbiddenHits(
    nodeId,
    nodes,
    upstreamIds,
    edges,
  );
  return {
    saw,
    notSaw,
    ok: forbiddenHits.length === 0,
    ...(forbiddenHits.length ? { forbiddenHits } : {}),
  };
}

export function runIsolationHolds(reports: Array<IsolationReport | undefined>) {
  return reports.every((r) => r?.ok !== false);
}
