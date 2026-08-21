import type { Edge, Node } from "@xyflow/react";
import { hashJson } from "@/lib/hash";
import {
  CRITIC_MODEL,
  JUDGE_MODEL,
  STUDENT_MODEL,
  STUDENT_NODE_ID,
  TEACHER_MODEL,
} from "@/lib/student-graph";
import type { PrismNodeData } from "@/lib/types";
import type { EvalArchitectureId, ExperimentProfile } from "./types";

export const EVAL_INFORMED_ID = "informed";

const NEMO_STEER =
  "Do the job as Prime. Omit what you don’t have. Never invent. Never mention the eval harness.";
const NEMO_PROMPT =
  "From the architecture prompt and Hub notes only, produce the outbound draft. If a fact is missing, say we don’t have it.";

function node(
  id: string,
  type: PrismNodeData["kind"],
  position: { x: number; y: number },
  data: Omit<PrismNodeData, "kind" | "status"> & { kind?: PrismNodeData["kind"] },
): Node<PrismNodeData> {
  return {
    id,
    type,
    position,
    data: {
      kind: data.kind ?? type,
      status: "idle",
      ...data,
    },
  };
}

function edge(source: string, target: string): Edge {
  return { id: `e-${source}-${target}`, source, target, type: "smoothstep" };
}

function hubNode(): Node<PrismNodeData> {
  return node("context", "context", { x: 380, y: 40 }, {
    kind: "context",
    label: "Context Hub",
    content: "",
  });
}

function firstNemo(x = 380, y = 280): Node<PrismNodeData> {
  return node(STUDENT_NODE_ID, "agent", { x, y }, {
    kind: "agent",
    label: "Nemo",
    role: "Local student — attempt the run intent from Hub only",
    steer: NEMO_STEER,
    prompt: NEMO_PROMPT,
    model: STUDENT_MODEL,
    sampling: { temperature: 0.4 },
  });
}

export type EvalArchitectureGraph = {
  id: EvalArchitectureId;
  name: string;
  description: string;
  tags: string[];
  nodes: Node<PrismNodeData>[];
  edges: Edge[];
};

export const EVAL_ARCHITECTURES: EvalArchitectureGraph[] = [
  {
    id: "eval-baseline",
    name: "Eval · Local baseline",
    description: "Hub → Nemo. What Lightning does unaided.",
    tags: ["eval", "baseline", "foundry"],
    nodes: [hubNode(), firstNemo()],
    edges: [edge("context", STUDENT_NODE_ID)],
  },
  {
    id: "eval-teacher-refine",
    name: "Eval · Teacher refinement",
    description: "Hub → Nemo → Teacher (reads Nemo) → Nemo revise.",
    tags: ["eval", "refine", "foundry"],
    nodes: [
      hubNode(),
      firstNemo(80, 280),
      node("teacher", "agent", { x: 380, y: 280 }, {
        kind: "agent",
        label: "Teacher",
        role: "Read first-pass Nemo and give targeted feedback",
        steer:
          "Name what to keep, what to drop, and the missing fact. Do not rewrite the whole outbound unless needed.",
        prompt:
          "Read Hub notes, the run intent, and first-pass Nemo. Write targeted feedback so the student can revise. Do not mention the eval harness.",
        model: TEACHER_MODEL,
        sampling: { temperature: 0.4 },
        budget: { maxTokensOut: 8192 },
      }),
      node(EVAL_INFORMED_ID, "agent", { x: 380, y: 520 }, {
        kind: "agent",
        label: "Nemo after Teacher",
        role: "Second pass — revise from Teacher feedback",
        steer:
          "Do the job again as Prime. Apply the Teacher notes. Omit unknowns. Never invent. Never write “in this prompt.”",
        prompt:
          "From Hub, your first draft, and Teacher feedback, produce a better outbound draft. Do not quote the Teacher essay.",
        model: STUDENT_MODEL,
        sampling: { temperature: 0.4 },
        publish: { includeInSamples: false, redactOutput: false },
      }),
    ],
    edges: [
      edge("context", STUDENT_NODE_ID),
      edge("context", "teacher"),
      edge(STUDENT_NODE_ID, "teacher"),
      edge("context", EVAL_INFORMED_ID),
      edge(STUDENT_NODE_ID, EVAL_INFORMED_ID),
      edge("teacher", EVAL_INFORMED_ID),
    ],
  },
  {
    id: "eval-teacher-critic",
    name: "Eval · Teacher + critic",
    description:
      "Nemo first pass; independent Teacher + Critic; Judge card; Nemo revises from the card only.",
    tags: ["eval", "critic", "foundry"],
    nodes: [
      hubNode(),
      firstNemo(80, 280),
      node("teacher", "agent", { x: 380, y: 280 }, {
        kind: "agent",
        label: "Teacher",
        role: "Independent specialist on the same Hub — do not use Nemo’s draft",
        steer:
          "Same task as the student. Prefer named facts and explicit omissions. Do not tutor or mention another model.",
        prompt:
          "From the architecture prompt and Hub notes only, produce your own outbound draft. Omit unknowns.",
        model: TEACHER_MODEL,
        sampling: { temperature: 0.4 },
        budget: { maxTokensOut: 8192 },
      }),
      node("critique", "agent", { x: 680, y: 280 }, {
        kind: "agent",
        label: "Critic",
        role: "Pressure-test the brief for leaks and mush — Hub only, not Nemo",
        steer:
          "Name invented facts, PHI, eval-leak (“in this prompt”), and line mix-ups.",
        prompt:
          "From the Hub and run intent only, list the traps a local model is likely to walk into. Do not draft the outbound message.",
        model: CRITIC_MODEL,
        sampling: { temperature: 0.5 },
        budget: { maxTokensOut: 8192 },
      }),
      node("judge", "merge", { x: 390, y: 520 }, {
        kind: "merge",
        label: "Judge",
        role: "Name characteristics and gaps — not a laundry list",
        steer:
          "One characteristic card beats a synthesis essay. What should Nemo keep, omit, and never say?",
        prompt:
          "Compare Nemo vs Teacher vs Critic. Write the characteristic card, then the JSON trailer. keep = what Nemo got right; omit = what not to distill; neverSay = leaks and forbidden phrases. Do not paste Teacher or Critic essays.",
        model: JUDGE_MODEL,
        sampling: { temperature: 0.3 },
        budget: { maxTokensOut: 8192 },
      }),
      node(EVAL_INFORMED_ID, "agent", { x: 390, y: 760 }, {
        kind: "agent",
        label: "Nemo after Judge",
        role: "Second pass — Hub + first Nemo + Judge card only",
        steer:
          "Do the job again as Prime. Prefer Judge keep. Honor omit and never-say. Do not quote the Judge card. Omit unknowns. Never invent. Never write “in this prompt.”",
        prompt:
          "From Hub, your first draft, and the Judge characteristic card, produce a better outbound draft. Do not restate the Judge essay.",
        model: STUDENT_MODEL,
        sampling: { temperature: 0.4 },
        publish: { includeInSamples: false, redactOutput: false },
      }),
    ],
    edges: [
      edge("context", STUDENT_NODE_ID),
      edge("context", "teacher"),
      edge("context", "critique"),
      edge(STUDENT_NODE_ID, "judge"),
      edge("teacher", "judge"),
      edge("critique", "judge"),
      edge("context", EVAL_INFORMED_ID),
      edge(STUDENT_NODE_ID, EVAL_INFORMED_ID),
      edge("judge", EVAL_INFORMED_ID),
    ],
  },
];

export function getEvalArchitecture(id: string): EvalArchitectureGraph | undefined {
  return EVAL_ARCHITECTURES.find((arch) => arch.id === id);
}

export function cloneEvalGraph(id: EvalArchitectureId): {
  nodes: Node<PrismNodeData>[];
  edges: Edge[];
} {
  const arch = getEvalArchitecture(id);
  if (!arch) throw new Error(`Unknown eval architecture: ${id}`);
  return {
    nodes: arch.nodes.map((n) => ({
      ...n,
      data: { ...n.data },
      position: { ...n.position },
    })),
    edges: arch.edges.map((e) => ({ ...e })),
  };
}

export function applyEvalProfile(
  nodes: Node<PrismNodeData>[],
  profile: ExperimentProfile,
): Node<PrismNodeData>[] {
  return nodes.map((n) => {
    if (n.data.model !== STUDENT_MODEL) return n;
    return {
      ...n,
      data: {
        ...n.data,
        sampling: {
          ...n.data.sampling,
          ...(profile.temperature != null ? { temperature: profile.temperature } : {}),
          ...(profile.seed != null ? { seed: profile.seed } : {}),
        },
        budget: {
          ...n.data.budget,
          ...(profile.maxTokens != null ? { maxTokensOut: profile.maxTokens } : {}),
        },
      },
    };
  });
}

export function architectureFingerprint(id: EvalArchitectureId): string {
  const arch = getEvalArchitecture(id);
  if (!arch) return "";
  return hashJson({
    id: arch.id,
    nodes: arch.nodes.map((n) => ({
      id: n.id,
      kind: n.data.kind,
      role: n.data.role,
      steer: n.data.steer,
      prompt: n.data.prompt,
      model: n.data.model,
    })),
    edges: arch.edges.map((e) => `${e.source}>${e.target}`).sort(),
  });
}
