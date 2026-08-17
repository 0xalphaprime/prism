import type { Edge, Node } from "@xyflow/react";
import type { PrismDocument } from "./document";
import { backfillIngestOnNodes } from "./run-engine";
import {
  directParents,
  isExecutableKind,
  topoOrder,
} from "./run-graph";
import type { NodeResult, RunRecord } from "./runs";
import type {
  NodeIngest,
  NodeKind,
  NodeMetrics,
  PrismNodeData,
  RunStatus,
} from "./types";

export const TRACE_FILE_KIND = "prism.trace" as const;
export const TRACE_SCHEMA_VERSION = 1;

export type TraceCell = {
  step: number;
  nodeId: string;
  kind: NodeKind;
  label: string;
  role?: string;
  steer?: string;
  nodePrompt?: string;
  model?: string;
  status: RunStatus;
  output?: string;
  reasoning?: string;
  ingest?: NodeIngest;
  metrics?: NodeMetrics;
};

export type TraceSpineLine = {
  nodeId: string;
  label: string;
  kind: NodeKind;
  depth: number;
};

export type PrismTrace = {
  kind: typeof TRACE_FILE_KIND;
  schemaVersion: number;
  runId: string;
  architectureId: string;
  architectureName: string;
  prompt: string;
  status: RunRecord["status"];
  startedAt: number;
  finishedAt?: number;
  pathwayLabel?: string;
  notes?: string;
  totals?: RunRecord["totals"];
  spine: TraceSpineLine[];
  cells: TraceCell[];
};

export type TraceJsonlRun = {
  type: "run";
  id: string;
  architectureId: string;
  architectureName: string;
  prompt: string;
  status: RunRecord["status"];
  startedAt: number;
  finishedAt?: number;
  pathwayLabel?: string;
  totals?: RunRecord["totals"];
};

export type TraceJsonlCell = {
  type: "cell";
} & TraceCell;

function executableTopoIds(
  nodes: Node<PrismNodeData>[],
  edges: Edge[],
): string[] {
  const executable = nodes.filter((n) => isExecutableKind(n.data.kind));
  const byId = new Map(executable.map((n) => [n.id, n]));
  const ids = topoOrder(executable, edges).filter((id) => byId.has(id));
  for (const n of executable) {
    if (!ids.includes(n.id)) ids.push(n.id);
  }
  return ids;
}

/** Compact DAG spine for the Trace header — one line per executable node. */
export function traceSpine(
  nodes: Node<PrismNodeData>[],
  edges: Edge[],
): TraceSpineLine[] {
  const executable = nodes.filter((n) => isExecutableKind(n.data.kind));
  const byId = new Map(executable.map((n) => [n.id, n]));
  const ids = executableTopoIds(nodes, edges);
  const depth = new Map<string, number>();
  for (const id of ids) {
    const parents = directParents(id, edges).filter((p) => byId.has(p));
    const d = parents.length
      ? 1 + Math.max(...parents.map((p) => depth.get(p) ?? 0))
      : 0;
    depth.set(id, d);
  }
  return ids.map((id) => {
    const node = byId.get(id)!;
    return {
      nodeId: id,
      label: node.data.label,
      kind: node.data.kind,
      depth: depth.get(id) ?? 0,
    };
  });
}

export function spineToPlain(spine: TraceSpineLine[]): string {
  if (!spine.length) return "";
  return spine
    .map((line) => {
      const pad = "  ".repeat(line.depth);
      const arrow = line.depth > 0 ? "→ " : "";
      return `${pad}${arrow}${line.label}`;
    })
    .join("\n");
}

/** Always graph / topo order. `step` on each row is completion index, not list order. */
export function orderNodeResults(
  results: NodeResult[],
  nodes: Node<PrismNodeData>[],
  edges: Edge[],
): NodeResult[] {
  const byId = new Map(results.map((r) => [r.nodeId, r]));
  const ordered: NodeResult[] = [];
  for (const id of executableTopoIds(nodes, edges)) {
    const hit = byId.get(id);
    if (hit) ordered.push(hit);
  }
  for (const row of results) {
    if (!ordered.some((r) => r.nodeId === row.nodeId)) ordered.push(row);
  }
  return ordered;
}

function cellFromNode(
  node: Node<PrismNodeData>,
  step: number,
  result?: NodeResult,
): TraceCell {
  return {
    step,
    nodeId: node.id,
    kind: result?.kind ?? node.data.kind,
    label: result?.label ?? node.data.label,
    role: result?.role ?? node.data.role,
    steer: node.data.steer,
    nodePrompt: node.data.prompt,
    model: result?.model ?? node.data.model,
    status: result?.status ?? node.data.status,
    output: result?.output ?? node.data.output,
    reasoning: result?.reasoning ?? node.data.reasoning,
    ingest: result?.ingest ?? node.data.ingest,
    metrics: result?.metrics ?? node.data.metrics,
  };
}

/** Ordered cells from the live canvas (fills as Step proceeds). Topo order; `step` is completion. */
export function cellsFromLiveGraph(
  nodes: Node<PrismNodeData>[],
  edges: Edge[],
  prior?: NodeResult[],
): TraceCell[] {
  const priorById = new Map((prior ?? []).map((r) => [r.nodeId, r]));
  const executable = nodes.filter((n) => isExecutableKind(n.data.kind));
  const byId = new Map(executable.map((n) => [n.id, n]));
  const ids = executableTopoIds(nodes, edges);

  return ids.map((id, index) => {
    const node = byId.get(id)!;
    const prior = priorById.get(id);
    const step = prior?.step ?? index;
    return cellFromNode(node, step, {
      ...prior,
      nodeId: id,
      label: node.data.label,
      kind: node.data.kind,
      role: node.data.role,
      model: node.data.model,
      status: node.data.status,
      output: node.data.output,
      reasoning: node.data.reasoning,
      ingest: node.data.ingest,
      metrics: node.data.metrics,
    });
  });
}

export function buildTrace(doc: PrismDocument, run: RunRecord): PrismTrace {
  const nodeById = new Map(doc.nodes.map((n) => [n.id, n]));
  const ordered = orderNodeResults(run.nodeResults, doc.nodes, doc.edges);
  const cells: TraceCell[] = ordered.map((row, index) => {
    const node = nodeById.get(row.nodeId);
    const step = row.step ?? index;
    if (node) return cellFromNode(node, step, row);
    return {
      step,
      nodeId: row.nodeId,
      kind: row.kind ?? "agent",
      label: row.label,
      role: row.role,
      model: row.model,
      status: row.status,
      output: row.output,
      reasoning: row.reasoning,
      ingest: row.ingest,
      metrics: row.metrics,
    };
  });

  return fillMissingIngest(
    {
      kind: TRACE_FILE_KIND,
      schemaVersion: TRACE_SCHEMA_VERSION,
      runId: run.id,
      architectureId: doc.id,
      architectureName: doc.name,
      prompt: run.prompt,
      status: run.status,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      pathwayLabel: run.pathwayLabel,
      notes: run.notes,
      totals: run.totals,
      spine: traceSpine(doc.nodes, doc.edges),
      cells,
    },
    doc.nodes,
    doc.edges,
    run.prompt,
    doc.attachedContext,
  );
}

export function buildLiveTrace(
  doc: PrismDocument,
  run: RunRecord | null,
  liveNodes: Node<PrismNodeData>[],
  liveEdges: Edge[],
): PrismTrace {
  const cells = cellsFromLiveGraph(liveNodes, liveEdges, run?.nodeResults);
  return fillMissingIngest(
    {
      kind: TRACE_FILE_KIND,
      schemaVersion: TRACE_SCHEMA_VERSION,
      runId: run?.id ?? "live",
      architectureId: doc.id,
      architectureName: doc.name,
      prompt: run?.prompt ?? doc.prompt,
      status: run?.status ?? "idle",
      startedAt: run?.startedAt ?? Date.now(),
      finishedAt: run?.finishedAt,
      pathwayLabel: run?.pathwayLabel ?? doc.name,
      notes: run?.notes,
      totals: run?.totals,
      spine: traceSpine(liveNodes, liveEdges),
      cells,
    },
    liveNodes,
    liveEdges,
    run?.prompt ?? doc.prompt,
    doc.attachedContext,
  );
}

export function traceToJsonl(trace: PrismTrace): string {
  const header: TraceJsonlRun = {
    type: "run",
    id: trace.runId,
    architectureId: trace.architectureId,
    architectureName: trace.architectureName,
    prompt: trace.prompt,
    status: trace.status,
    startedAt: trace.startedAt,
    finishedAt: trace.finishedAt,
    pathwayLabel: trace.pathwayLabel,
    totals: trace.totals,
  };
  const lines = [JSON.stringify(header)];
  for (const cell of trace.cells) {
    const row: TraceJsonlCell = { type: "cell", ...cell };
    lines.push(JSON.stringify(row));
  }
  return `${lines.join("\n")}\n`;
}

export function slugForTrace(name: string) {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "prism-trace";
}

function fillMissingIngest(
  trace: PrismTrace,
  nodes: Node<PrismNodeData>[],
  edges: Edge[],
  prompt: string,
  attachedContext: PrismDocument["attachedContext"] = [],
): PrismTrace {
  const needs = trace.cells.some(
    (c) =>
      !c.ingest && (c.kind === "agent" || c.kind === "merge" || c.kind === "router"),
  );
  if (!needs) return trace;
  const filled = backfillIngestOnNodes(nodes, edges, prompt, attachedContext);
  const byId = new Map(filled.map((n) => [n.id, n.data.ingest]));
  return {
    ...trace,
    cells: trace.cells.map((cell) => ({
      ...cell,
      ingest: cell.ingest ?? byId.get(cell.nodeId),
    })),
  };
}

/** Human-readable dump for chat / eval notes. */
export function traceToPlain(trace: PrismTrace): string {
  const lines: string[] = [
    `# ${trace.architectureName}`,
    `kind: ${trace.kind}  status: ${trace.status}`,
    `run: ${trace.runId}`,
    trace.pathwayLabel ? `pathway: ${trace.pathwayLabel}` : "",
    "",
    "## Run intent",
    trace.prompt.trim() || "(none)",
  ];
  const graph = spineToPlain(trace.spine ?? []);
  if (graph) {
    lines.push("", "## Graph", graph);
  }
  if (trace.totals) {
    const t = trace.totals;
    lines.push(
      "",
      `totals: ${t.latencyMs ?? "—"} ms · ${t.tokensIn ?? 0}→${t.tokensOut ?? 0} tok · $${(t.costUsd ?? 0).toFixed(4)}`,
    );
  }
  trace.cells.forEach((cell, index) => {
    lines.push("", `## ${index + 1}. ${cell.label}`);
    lines.push(
      `${cell.kind}${cell.model ? ` · ${cell.model}` : ""} · ${cell.status}`,
    );
    if (cell.role?.trim()) lines.push(`role: ${cell.role.trim()}`);
    if (cell.steer?.trim()) lines.push(`steer: ${cell.steer.trim()}`);
    if (cell.metrics) {
      const m = cell.metrics;
      lines.push(
        `metrics: ${m.latencyMs ?? "—"} ms · ${m.tokensIn ?? 0}→${m.tokensOut ?? 0} tok · $${(m.costUsd ?? 0).toFixed(4)}`,
      );
    }
    if (cell.ingest?.messages.length) {
      lines.push("", "### ingest");
      if (cell.ingest.temperature != null) {
        lines.push(`temperature: ${cell.ingest.temperature}`);
      }
      if (cell.ingest.upstreamIds?.length) {
        lines.push(`upstream: ${cell.ingest.upstreamIds.join(", ")}`);
      }
      for (const msg of cell.ingest.messages) {
        lines.push("", `#### ${msg.role}`, msg.content);
      }
    } else if (cell.nodePrompt?.trim()) {
      lines.push("", "### node prompt", cell.nodePrompt.trim());
    }
    lines.push("", "### output", cell.output?.trim() || "(empty)");
    if (cell.reasoning?.trim()) {
      lines.push("", "### reasoning", cell.reasoning.trim());
    }
  });
  return `${lines.filter((line, i, arr) => line !== "" || arr[i - 1] !== "").join("\n")}\n`;
}
