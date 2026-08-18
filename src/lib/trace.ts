import type { Edge, Node } from "@xyflow/react";
import { parseCharacteristics } from "./compose-messages";
import type { PrismDocument } from "./document";
import { hashJson } from "./hash";
import { runIsolationHolds } from "./isolation";
import { backfillIngestOnNodes } from "./run-engine";
import {
  directParents,
  isExecutableKind,
  isLlmKind,
  topoOrder,
} from "./run-graph";
import type { NodeResult, RunRecord } from "./runs";
import { STUDENT_NODE_ID } from "./student-graph";
import type {
  IsolationReport,
  JudgeCharacteristics,
  NamedIngest,
  NodeIngest,
  NodeKind,
  NodeMetrics,
  NodePublish,
  PrismNodeData,
  RunStatus,
  StoredRoutePlan,
} from "./types";

export const TRACE_FILE_KIND = "prism.trace" as const;
export const ATTRIBUTION_FILE_KIND = "prism.attribution" as const;
export const CAUSAL_FILE_KIND = "prism.causal" as const;
export const TRACE_SCHEMA_VERSION = 2;

export function traceCellDomId(nodeId: string) {
  return `trace-cell-${nodeId}`;
}

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
  namedIngest?: NamedIngest;
  isolation?: IsolationReport;
  metrics?: NodeMetrics;
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
  publish?: NodePublish;
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
  parentRunId?: string;
  graphFingerprint?: string;
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
  parentRunId?: string;
  graphFingerprint?: string;
  totals?: RunRecord["totals"];
};

export type TraceJsonlCell = {
  type: "cell";
} & TraceCell;

export type AttributionCell = Omit<TraceCell, "reasoning" | "ingest"> & {
  ingest?: Omit<NodeIngest, "messages"> & { messages?: NodeIngest["messages"] };
  reasoning?: string;
};

export type AttributionPack = {
  kind: typeof ATTRIBUTION_FILE_KIND;
  schemaVersion: number;
  runId: string;
  architectureId: string;
  architectureName: string;
  prompt: string;
  status: RunRecord["status"];
  startedAt: number;
  finishedAt?: number;
  pathwayLabel?: string;
  parentRunId?: string;
  graphFingerprint?: string;
  spine: TraceSpineLine[];
  cells: AttributionCell[];
};

export type CausalRow = {
  kind: typeof CAUSAL_FILE_KIND;
  schemaVersion: number;
  runId: string;
  nodeId: string;
  label: string;
  ingestHash?: string;
  model?: string;
  servedModel?: string;
  messages: NodeIngest["messages"];
  output: string;
};

function pick<T>(a: T | undefined, b: T | undefined): T | undefined {
  return a !== undefined ? a : b;
}

function graphFingerprint(
  nodes: Node<PrismNodeData>[],
  edges: Edge[],
  prompt: string,
): string {
  return hashJson({
    nodes: nodes.map((n) => n.id).sort(),
    edges: edges.map((e) => `${e.source}>${e.target}`).sort(),
    prompt: prompt.trim(),
  });
}

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

function cellFromParts(
  step: number,
  node: Node<PrismNodeData> | undefined,
  result?: NodeResult,
): TraceCell {
  const d = node?.data;
  return {
    step,
    nodeId: result?.nodeId ?? node?.id ?? "",
    kind: result?.kind ?? d?.kind ?? "agent",
    label: result?.label ?? d?.label ?? "",
    role: pick(result?.role, d?.role),
    steer: d?.steer,
    nodePrompt: d?.prompt,
    model: pick(result?.model, d?.model),
    status: result?.status ?? d?.status ?? "idle",
    output: pick(result?.output, d?.output),
    reasoning: pick(result?.reasoning, d?.reasoning),
    ingest: pick(result?.ingest, d?.ingest),
    namedIngest:
      pick(result?.namedIngest, d?.namedIngest) ??
      pick(result?.ingest?.named, d?.ingest?.named),
    isolation: pick(result?.isolation, d?.isolation),
    metrics: pick(result?.metrics, d?.metrics),
    provider: pick(result?.provider, d?.provider),
    servedModel: pick(result?.servedModel, d?.servedModel),
    finishReason: pick(result?.finishReason, d?.finishReason),
    startedAt: pick(result?.startedAt, d?.startedAt),
    finishedAt: pick(result?.finishedAt, d?.finishedAt),
    ingestHash: pick(result?.ingestHash, d?.ingestHash),
    truncated: pick(result?.truncated, d?.truncated),
    errorDetail: pick(result?.errorDetail, d?.errorDetail),
    routePlan: pick(result?.routePlan, d?.routePlan),
    characteristics: pick(result?.characteristics, d?.characteristics),
    publish: pick(result?.publish, d?.publish),
  };
}

function cellFromNode(
  node: Node<PrismNodeData>,
  step: number,
  result?: NodeResult,
): TraceCell {
  return cellFromParts(step, node, result);
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
      namedIngest: node.data.namedIngest ?? node.data.ingest?.named,
      isolation: node.data.isolation,
      provider: node.data.provider,
      servedModel: node.data.servedModel,
      finishReason: node.data.finishReason,
      startedAt: node.data.startedAt,
      finishedAt: node.data.finishedAt,
      ingestHash: node.data.ingestHash,
      truncated: node.data.truncated,
      errorDetail: node.data.errorDetail,
      routePlan: node.data.routePlan,
      characteristics: node.data.characteristics,
      publish: node.data.publish,
    });
  });
}

function headerFields(
  doc: PrismDocument,
  run: RunRecord | null,
  nodes: Node<PrismNodeData>[],
  edges: Edge[],
  prompt: string,
): Pick<
  PrismTrace,
  | "kind"
  | "schemaVersion"
  | "runId"
  | "architectureId"
  | "architectureName"
  | "prompt"
  | "status"
  | "startedAt"
  | "finishedAt"
  | "pathwayLabel"
  | "parentRunId"
  | "graphFingerprint"
  | "notes"
  | "totals"
  | "spine"
> {
  return {
    kind: TRACE_FILE_KIND,
    schemaVersion: TRACE_SCHEMA_VERSION,
    runId: run?.id ?? "live",
    architectureId: doc.id,
    architectureName: doc.name,
    prompt,
    status: run?.status ?? "idle",
    startedAt: run?.startedAt ?? Date.now(),
    finishedAt: run?.finishedAt,
    pathwayLabel: run?.pathwayLabel ?? doc.name,
    parentRunId: run?.parentRunId,
    graphFingerprint: graphFingerprint(nodes, edges, prompt),
    notes: run?.notes,
    totals: run?.totals,
    spine: traceSpine(nodes, edges),
  };
}

export function buildTrace(doc: PrismDocument, run: RunRecord): PrismTrace {
  const nodeById = new Map(doc.nodes.map((n) => [n.id, n]));
  const ordered = orderNodeResults(run.nodeResults, doc.nodes, doc.edges);
  const cells: TraceCell[] = ordered.map((row, index) => {
    const node = nodeById.get(row.nodeId);
    const step = row.step ?? index;
    return cellFromParts(step, node, row);
  });

  return fillMissingIngest(
    {
      ...headerFields(doc, run, doc.nodes, doc.edges, run.prompt),
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
  const prompt = run?.prompt ?? doc.prompt;
  const cells = cellsFromLiveGraph(liveNodes, liveEdges, run?.nodeResults);
  return fillMissingIngest(
    {
      ...headerFields(doc, run, liveNodes, liveEdges, prompt),
      cells,
    },
    liveNodes,
    liveEdges,
    prompt,
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
    parentRunId: trace.parentRunId,
    graphFingerprint: trace.graphFingerprint,
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
  const filled = backfillIngestOnNodes(nodes, edges, prompt, attachedContext);
  const byId = new Map(filled.map((n) => [n.id, n.data]));
  return {
    ...trace,
    cells: trace.cells.map((cell) => {
      const data = byId.get(cell.nodeId);
      if (!data) return cell;
      return {
        ...cell,
        ingest: cell.ingest ?? data.ingest,
        namedIngest:
          cell.namedIngest ?? data.namedIngest ?? data.ingest?.named,
        isolation: cell.isolation ?? data.isolation,
        ingestHash: cell.ingestHash ?? data.ingestHash,
        truncated: cell.truncated ?? data.truncated,
        characteristics:
          cell.characteristics ??
          data.characteristics ??
          (cell.kind === "merge" && cell.output
            ? parseCharacteristics(cell.output) ?? undefined
            : undefined),
      };
    }),
  };
}

function sawLine(cell: TraceCell): string {
  const iso = cell.isolation;
  if (!iso) return "";
  const saw = iso.saw.length
    ? iso.saw.map((s) => s.label).join(", ")
    : "(none)";
  const fail = iso.ok === false ? " · isolation fail" : "";
  const clip = cell.truncated ? " · truncated pack" : "";
  return `saw: ${saw}${fail}${clip}`;
}

function characteristicsPlain(c: JudgeCharacteristics | undefined): string[] {
  if (!c) return [];
  const lines: string[] = ["", "### characteristics"];
  if (c.keep.length) lines.push(`keep: ${c.keep.join("; ")}`);
  if (c.omit.length) lines.push(`omit: ${c.omit.join("; ")}`);
  if (c.neverSay.length) lines.push(`never-say: ${c.neverSay.join("; ")}`);
  return lines;
}

export function cellToPlain(cell: TraceCell, index: number): string {
  const lines: string[] = [
    `## ${index + 1}. ${cell.label}`,
    `${cell.kind}${cell.servedModel || cell.model ? ` · ${cell.servedModel ?? cell.model}` : ""} · ${cell.status}`,
  ];
  const saw = sawLine(cell);
  if (saw) lines.push(saw);
  if (cell.finishReason && !isBenignFinish(cell.finishReason)) {
    lines.push(`finish: ${cell.finishReason}`);
  }
  if (cell.role?.trim()) lines.push(`role: ${cell.role.trim()}`);
  if (cell.steer?.trim()) lines.push(`steer: ${cell.steer.trim()}`);
  if (cell.metrics) {
    const m = cell.metrics;
    lines.push(
      `metrics: ${m.latencyMs ?? "—"} ms · ${m.tokensIn ?? 0}→${m.tokensOut ?? 0} tok · $${(m.costUsd ?? 0).toFixed(4)}`,
    );
  }
  const named = cell.namedIngest ?? cell.ingest?.named;
  if (named) {
    lines.push("", "### named ingest");
    if (named.runIntent) lines.push(`run intent: ${named.runIntent}`);
    if (named.role) lines.push(`role: ${named.role}`);
    if (named.steer) lines.push(`steer: ${named.steer}`);
    if (named.nodePrompt) lines.push(`node prompt: ${named.nodePrompt}`);
    if (named.outputSchema) lines.push(`schema: ${named.outputSchema}`);
    if (named.upstream?.length) {
      lines.push(
        `upstream: ${named.upstream.map((u) => u.label).join(", ")}`,
      );
    }
  }
  if (cell.ingest?.messages.length) {
    lines.push("", "### ingest");
    if (cell.ingest.temperature != null) {
      lines.push(`temperature: ${cell.ingest.temperature}`);
    }
    if (cell.ingestHash) lines.push(`hash: ${cell.ingestHash}`);
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
  lines.push(...characteristicsPlain(cell.characteristics));
  if (cell.routePlan?.lanes.length) {
    lines.push("", "### route plan");
    for (const lane of cell.routePlan.lanes) {
      lines.push(
        `- ${lane.nodeId}: ${lane.activate ? "on" : "off"}${lane.brief ? ` — ${lane.brief}` : ""}`,
      );
    }
    if (cell.routePlan.rationale) lines.push(cell.routePlan.rationale);
  }
  if (cell.errorDetail) {
    lines.push("", "### error", cell.errorDetail);
  }
  return `${lines.join("\n")}\n`;
}

/** Human-readable dump for chat / eval notes. */
export function traceToPlain(trace: PrismTrace): string {
  const lines: string[] = [
    `# ${trace.architectureName}`,
    `kind: ${trace.kind}  status: ${trace.status}`,
    `run: ${trace.runId}`,
    trace.pathwayLabel ? `pathway: ${trace.pathwayLabel}` : "",
    trace.parentRunId ? `parent: ${trace.parentRunId}` : "",
    trace.graphFingerprint ? `graph: ${trace.graphFingerprint}` : "",
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
    lines.push("", cellToPlain(cell, index).trimEnd());
  });
  return `${lines.filter((line, i, arr) => line !== "" || arr[i - 1] !== "").join("\n")}\n`;
}

function isBenignFinish(reason: string) {
  const r = reason.toLowerCase();
  return r === "stop" || r === "end_turn" || r === "eos";
}

export function isLengthClip(reason: string | undefined) {
  if (!reason) return false;
  const r = reason.toLowerCase();
  return r === "length" || r === "max_tokens" || r === "max_output_tokens";
}

function redactedOutput(cell: TraceCell): string | undefined {
  if (cell.publish?.redactOutput) return "[redacted]";
  return cell.output;
}

export function buildAttribution(
  trace: PrismTrace,
  opts?: { includeReasoning?: boolean },
): AttributionPack {
  const includeReasoning = Boolean(opts?.includeReasoning);
  return {
    kind: ATTRIBUTION_FILE_KIND,
    schemaVersion: TRACE_SCHEMA_VERSION,
    runId: trace.runId,
    architectureId: trace.architectureId,
    architectureName: trace.architectureName,
    prompt: trace.prompt,
    status: trace.status,
    startedAt: trace.startedAt,
    finishedAt: trace.finishedAt,
    pathwayLabel: trace.pathwayLabel,
    parentRunId: trace.parentRunId,
    graphFingerprint: trace.graphFingerprint,
    spine: trace.spine,
    cells: trace.cells.map((cell) => {
      const { reasoning, ingest, output, ...rest } = cell;
      const ingestSlim = ingest
        ? {
            model: ingest.model,
            temperature: ingest.temperature,
            maxTokens: ingest.maxTokens,
            keepK: ingest.keepK,
            laneBrief: ingest.laneBrief,
            upstreamIds: ingest.upstreamIds,
            named: ingest.named ?? cell.namedIngest,
            messages: ingest.messages,
          }
        : undefined;
      return {
        ...rest,
        output: redactedOutput(cell) ?? output,
        ingest: ingestSlim,
        ...(includeReasoning && reasoning ? { reasoning } : {}),
      };
    }),
  };
}

export function attributionToJson(pack: AttributionPack): string {
  return `${JSON.stringify(pack, null, 2)}\n`;
}

export function traceToCausalJsonl(trace: PrismTrace): string {
  const isolationFailed = !runIsolationHolds(
    trace.cells.map((c) => c.isolation),
  );
  const lines: string[] = [];
  for (const cell of trace.cells) {
    if (!isLlmKind(cell.kind)) continue;
    if (cell.kind === "merge") continue;
    if (cell.publish?.includeInSamples === false) continue;
    if (cell.isolation?.ok === false) continue;
    if (isolationFailed && cell.nodeId === STUDENT_NODE_ID) continue;
    if (isLengthClip(cell.finishReason)) continue;
    if (cell.status !== "done") continue;
    const messages = cell.ingest?.messages;
    if (!messages?.length) continue;
    const row: CausalRow = {
      kind: CAUSAL_FILE_KIND,
      schemaVersion: TRACE_SCHEMA_VERSION,
      runId: trace.runId,
      nodeId: cell.nodeId,
      label: cell.label,
      ingestHash: cell.ingestHash,
      model: cell.ingest?.model ?? cell.model,
      servedModel: cell.servedModel,
      messages,
      output: redactedOutput(cell)?.trim() || cell.output?.trim() || "",
    };
    lines.push(JSON.stringify(row));
  }
  return lines.length ? `${lines.join("\n")}\n` : "";
}
