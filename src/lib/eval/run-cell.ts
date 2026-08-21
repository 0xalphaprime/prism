import type { Node } from "@xyflow/react";
import type { ChatFn } from "@/lib/run-engine";
import { executeNodeStep } from "@/lib/run-engine";
import { nextSteppable } from "@/lib/run-graph";
import { parseModelRef } from "@/lib/providers";
import {
  assignResultSteps,
  createRunStub,
  nodeResultFromGraphNode,
  type RunRecord,
} from "@/lib/runs";
import { chatCompletion } from "@/lib/server/providers";
import { STUDENT_NODE_ID } from "@/lib/student-graph";
import type { NodeMetrics, PrismNodeData } from "@/lib/types";
import { newId } from "@/lib/id";
import { applyEvalProfile, cloneEvalGraph, EVAL_INFORMED_ID } from "./graphs";
import { liftBetween, scoreHop } from "./score";
import type { EvalItem, ExperimentCell, ExperimentProfile } from "./types";

function applyPatch(
  nodes: Node<PrismNodeData>[],
  nodeId: string,
  patch: Partial<PrismNodeData>,
) {
  return nodes.map((n) =>
    n.id === nodeId ? { ...n, data: { ...n.data, ...patch } } : n,
  );
}

let ollamaTail: Promise<unknown> = Promise.resolve();

function withOllamaLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = ollamaTail.then(fn, fn);
  ollamaTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

const serverChat: ChatFn = async (body) => {
  const parsed = parseModelRef(body.model);
  if (!parsed) return { ok: false, error: `Invalid model ref: ${body.model}` };

  const invoke = async () => {
    try {
      const data = await chatCompletion({
        provider: parsed.provider,
        model: parsed.model,
        messages: body.messages,
        temperature: body.temperature,
        max_tokens: body.max_tokens ?? 4096,
      });
      return { ok: true as const, data };
    } catch (error) {
      const err = error as Error & { detail?: unknown };
      const detail =
        typeof err.detail === "string"
          ? err.detail
          : err.detail
            ? JSON.stringify(err.detail).slice(0, 400)
            : err.message;
      return { ok: false as const, error: detail || "Upstream provider error" };
    }
  };

  if (parsed.provider === "ollama") return withOllamaLock(invoke);
  return invoke();
};

function sumTotals(nodes: Node<PrismNodeData>[]): NodeMetrics {
  return nodes.reduce<NodeMetrics>(
    (acc, node) => {
      const m = node.data.metrics;
      if (!m) return acc;
      return {
        latencyMs: (acc.latencyMs ?? 0) + (m.latencyMs ?? 0),
        tokensIn: (acc.tokensIn ?? 0) + (m.tokensIn ?? 0),
        tokensOut: (acc.tokensOut ?? 0) + (m.tokensOut ?? 0),
        costUsd: (acc.costUsd ?? 0) + (m.costUsd ?? 0),
      };
    },
    {},
  );
}

export async function executeEvalCell(args: {
  item: EvalItem;
  architectureId: ExperimentCell["architectureId"];
  profile: ExperimentProfile;
  experimentId: string;
  cellId: string;
  runId?: string;
}): Promise<ExperimentCell> {
  const graph = cloneEvalGraph(args.architectureId);
  let nodes: Node<PrismNodeData>[] = applyEvalProfile(graph.nodes, args.profile).map((n) =>
    n.id === "context"
      ? { ...n, data: { ...n.data, content: args.item.allowedContext, status: "idle" } }
      : { ...n, data: { ...n.data, status: "idle", output: undefined, metrics: undefined } },
  );
  const edges = graph.edges;
  const runId = args.runId ?? newId();
  let error: string | undefined;
  let routePlan = null;

  for (let i = 0; i < 32; i += 1) {
    const nodeId = nextSteppable(nodes, edges);
    if (!nodeId) break;
    const result = await executeNodeStep({
      nodeId,
      nodes,
      edges,
      attachedContext: [],
      architecturePrompt: args.item.prompt,
      activeRoutePlan: routePlan,
      chat: serverChat,
    });
    nodes = applyPatch(nodes, result.nodeId, result.patch);
    for (const side of result.sidePatches) {
      nodes = applyPatch(nodes, side.nodeId, side.patch);
    }
    if (result.routePlan) routePlan = result.routePlan;
    if (result.error) {
      error = `${nodeId}: ${result.error}`;
      break;
    }
  }

  const first = nodes.find((n) => n.id === STUDENT_NODE_ID);
  const revised = nodes.find((n) => n.id === EVAL_INFORMED_ID);
  const teacher = nodes.find((n) => n.id === "teacher");
  const critic = nodes.find((n) => n.id === "critique");
  const judge = nodes.find((n) => n.id === "judge");

  const firstPass = scoreHop({
    item: args.item,
    output: first?.data.output,
    isolation: first?.data.isolation,
    truncated: first?.data.truncated,
    finishReason: first?.data.finishReason,
  });
  const revisedScore = revised
    ? scoreHop({
        item: args.item,
        output: revised.data.output,
        isolation: revised.data.isolation,
        truncated: revised.data.truncated,
        finishReason: revised.data.finishReason,
      })
    : undefined;

  const nodeResults = nodes.map((n, idx) => nodeResultFromGraphNode(n, idx));
  const run: RunRecord = {
    ...createRunStub({
      architectureId: args.architectureId,
      prompt: args.item.prompt,
      pathwayLabel: args.architectureId,
      parentRunId: args.experimentId,
    }),
    id: runId,
    status: error ? "error" : "done",
    finishedAt: Date.now(),
    nodeResults: assignResultSteps(undefined, nodeResults),
    totals: sumTotals(nodes),
    notes: `eval ${args.item.id} × ${args.architectureId}`,
  };

  return {
    cellId: args.cellId,
    itemId: args.item.id,
    architectureId: args.architectureId,
    itemHash: "",
    rep: 1,
    runId,
    status: error ? "error" : "done",
    error,
    firstPass,
    revised: revisedScore,
    lift:
      args.architectureId === "eval-baseline"
        ? null
        : liftBetween(firstPass, revisedScore),
    traces: {
      firstNodeId: STUDENT_NODE_ID,
      revisedNodeId: revised ? EVAL_INFORMED_ID : undefined,
      teacher: teacher ? "teacher" : undefined,
      critic: critic ? "critique" : undefined,
      judge: judge ? "judge" : undefined,
    },
    totals: run.totals ?? {},
    nodeResults: run.nodeResults,
    run,
  };
}
