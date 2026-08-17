import type { Node } from "@xyflow/react";
import { parseModelRef } from "@/lib/providers";
import { executeNodeStep, type ChatFn } from "@/lib/run-engine";
import { chatCompletion } from "@/lib/server/providers";
import {
  STUDENT_LAB_HUB,
  STUDENT_LAB_PROMPT,
  STUDENT_LAB_SEED_ID,
  STUDENT_LAB_STEP_ORDER,
  type StudentLabSeed,
} from "@/lib/student-lab";
import {
  STUDENT_TEACHER_EDGES,
  STUDENT_TEACHER_NODES,
} from "@/lib/student-graph";
import type { PrismNodeData } from "@/lib/types";

function applyPatch(
  nodes: Node<PrismNodeData>[],
  nodeId: string,
  patch: Partial<PrismNodeData>,
) {
  return nodes.map((n) =>
    n.id === nodeId ? { ...n, data: { ...n.data, ...patch } } : n,
  );
}

const serverChat: ChatFn = async (body) => {
  const parsed = parseModelRef(body.model);
  if (!parsed) return { ok: false, error: `Invalid model ref: ${body.model}` };
  try {
    const data = await chatCompletion({
      provider: parsed.provider,
      model: parsed.model,
      messages: body.messages,
      temperature: body.temperature,
      max_tokens: body.max_tokens ?? 4096,
    });
    return { ok: true, data };
  } catch (error) {
    const err = error as Error & { detail?: unknown };
    const detail =
      typeof err.detail === "string"
        ? err.detail
        : err.detail
          ? JSON.stringify(err.detail).slice(0, 400)
          : err.message;
    return { ok: false, error: detail || "Upstream provider error" };
  }
};

/** Hub → Nemo → Teacher (Opus 5) → Critic → Judge. Teachers never see Nemo. */
export async function runStudentLab(): Promise<StudentLabSeed> {
  let nodes: Node<PrismNodeData>[] = STUDENT_TEACHER_NODES.map((n) => ({
    ...n,
    data: {
      ...n.data,
      content: n.id === "context" ? STUDENT_LAB_HUB : n.data.content,
      status: "idle",
      output: undefined,
      metrics: undefined,
    },
    position: { ...n.position },
  }));
  const edges = STUDENT_TEACHER_EDGES.map((e) => ({ ...e }));

  let error: string | undefined;
  for (const nodeId of STUDENT_LAB_STEP_ORDER) {
    const result = await executeNodeStep({
      nodeId,
      nodes,
      edges,
      attachedContext: [],
      architecturePrompt: STUDENT_LAB_PROMPT,
      activeRoutePlan: null,
      chat: serverChat,
    });
    nodes = applyPatch(nodes, result.nodeId, result.patch);
    for (const side of result.sidePatches) {
      nodes = applyPatch(nodes, side.nodeId, side.patch);
    }
    if (result.error) {
      error = `${nodeId}: ${result.error}`;
      break;
    }
  }

  return {
    id: STUDENT_LAB_SEED_ID,
    prompt: STUDENT_LAB_PROMPT,
    hubContent: STUDENT_LAB_HUB,
    finishedAt: Date.now(),
    error,
    nodes: nodes.map((n) => ({
      id: n.id,
      label: n.data.label,
      model: n.data.model,
      status: n.data.status ?? "idle",
      output: n.data.output,
      metrics: n.data.metrics,
    })),
  };
}
