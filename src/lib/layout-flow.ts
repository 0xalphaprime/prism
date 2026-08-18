import type { Node } from "@xyflow/react";
import { INFORMED_NODE_ID } from "./student-graph";
import type { PrismNodeData } from "./types";

/** Approximate rendered heights — used so rows don't collide when zoomed. */
const EST_HEIGHT: Record<string, number> = {
  "context-source": 118,
  context: 118,
  router: 110,
  agent: 140,
  merge: 140,
};

const DEFAULT_HEIGHT = 130;
const CENTER_X = 520;
const ROW_GAP = 72;
const COL_GAP = 280;
const SOURCE_COL_GAP = 260;
const TOP_Y = 32;

function heightOf(node: Node<PrismNodeData>) {
  return EST_HEIGHT[node.data.kind] ?? DEFAULT_HEIGHT;
}

function placeRow(
  nodes: Node<PrismNodeData>[],
  y: number,
  colGap: number,
  centerX: number,
  nodeWidth = 240,
) {
  if (!nodes.length) return [] as Node<PrismNodeData>[];
  const span = Math.max(0, nodes.length - 1) * colGap;
  const startX = centerX - span / 2 - nodeWidth / 2;
  return nodes.map((node, index) => ({
    ...node,
    position: {
      x: Math.round(startX + index * colGap),
      y: Math.round(y),
    },
  }));
}

/**
 * Clean top→bottom Prism layout:
 * channels (row) → Context Hub → Split → agents (row) → Judge → post-Judge hops
 */
export function layoutPrismFlow(
  nodes: Node<PrismNodeData>[],
): Node<PrismNodeData>[] {
  const sources = nodes.filter((n) => n.data.kind === "context-source");
  const hubs = nodes.filter((n) => n.data.kind === "context");
  const routers = nodes.filter((n) => n.data.kind === "router");
  const agents = nodes.filter((n) => n.data.kind === "agent");
  const merges = nodes.filter((n) => n.data.kind === "merge");
  const rest = nodes.filter(
    (n) =>
      n.data.kind !== "context-source" &&
      n.data.kind !== "context" &&
      n.data.kind !== "router" &&
      n.data.kind !== "agent" &&
      n.data.kind !== "merge",
  );

  // Stable, readable order for specialist lanes
  const agentOrder = ["student", "research", "draft", "teacher", "critique", "summarizer"];
  const preMergeAgents = agents.filter((n) => n.id !== INFORMED_NODE_ID);
  const postMergeAgents = agents.filter((n) => n.id === INFORMED_NODE_ID);
  preMergeAgents.sort((a, b) => {
    const ai = agentOrder.indexOf(a.id);
    const bi = agentOrder.indexOf(b.id);
    const aKey = ai === -1 ? 100 : ai;
    const bKey = bi === -1 ? 100 : bi;
    if (aKey !== bKey) return aKey - bKey;
    return a.data.label.localeCompare(b.data.label);
  });

  sources.sort((a, b) =>
    (a.data.sourceKind ?? a.id).localeCompare(b.data.sourceKind ?? b.id),
  );

  let y = TOP_Y;
  const placed: Node<PrismNodeData>[] = [];

  const pushRow = (
    row: Node<PrismNodeData>[],
    colGap: number,
    widthHint: number,
  ) => {
    if (!row.length) return;
    placed.push(...placeRow(row, y, colGap, CENTER_X, widthHint));
    const rowHeight = Math.max(...row.map(heightOf));
    y += rowHeight + ROW_GAP;
  };

  pushRow(sources, SOURCE_COL_GAP, 220);
  pushRow(hubs, COL_GAP, 220);
  pushRow(routers, COL_GAP, 220);
  pushRow([...preMergeAgents, ...rest], COL_GAP, 220);
  pushRow(merges, COL_GAP, 220);
  pushRow(postMergeAgents, COL_GAP, 220);

  // Preserve any node we somehow missed
  const placedIds = new Set(placed.map((n) => n.id));
  for (const node of nodes) {
    if (!placedIds.has(node.id)) {
      placed.push({
        ...node,
        position: { x: CENTER_X, y },
      });
      y += heightOf(node) + ROW_GAP;
    }
  }

  return placed;
}
