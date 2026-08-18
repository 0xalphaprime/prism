import type { Node } from "@xyflow/react";
import { isExecutableKind } from "@/lib/run-graph";
import {
  HUB_ONLY_SPECIALIST_IDS,
  STUDENT_NODE_ID,
} from "@/lib/student-graph";
import type { IsolationReport, IsolationSight, PrismNodeData } from "@/lib/types";

function sight(node: Node<PrismNodeData>): IsolationSight {
  return { id: node.id, label: node.data.label };
}

function realUpstreamIds(ids: string[] | undefined): string[] {
  return (ids ?? []).filter((id) => id && !id.startsWith("__"));
}

/** Policy only when the student-vs-teachers ids are on this graph.
 * Teacher/Critic must not list Nemo. Second-pass `informed` may see everyone.
 */
export function isolationForbiddenHits(
  nodeId: string,
  nodes: Node<PrismNodeData>[],
  upstreamIds: string[] | undefined,
): string[] {
  const ids = new Set(nodes.map((n) => n.id));
  if (!ids.has(STUDENT_NODE_ID)) return [];
  if (!ids.has("teacher") && !ids.has("critique")) return [];
  if (
    !(HUB_ONLY_SPECIALIST_IDS as readonly string[]).includes(nodeId)
  ) {
    return [];
  }
  return realUpstreamIds(upstreamIds).filter((id) => id === STUDENT_NODE_ID);
}

export function isolationReport(args: {
  nodeId: string;
  nodes: Node<PrismNodeData>[];
  upstreamIds?: string[];
}): IsolationReport {
  const { nodeId, nodes, upstreamIds } = args;
  const peers = nodes.filter((n) => isExecutableKind(n.data.kind));
  const up = new Set(realUpstreamIds(upstreamIds));
  const saw = peers
    .filter((n) => n.id !== nodeId && up.has(n.id))
    .map(sight);
  const notSaw = peers
    .filter((n) => n.id !== nodeId && !up.has(n.id))
    .map(sight);
  const forbiddenHits = isolationForbiddenHits(nodeId, nodes, upstreamIds);
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
