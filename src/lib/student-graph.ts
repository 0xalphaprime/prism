import type { Edge, Node } from "@xyflow/react";
import type { ModelRef } from "./providers";
import { STUDENT_LAB_HUB } from "./student-lab";
import type { PrismNodeData } from "./types";

/** Hub-only specialists on the student-vs-teachers template. */
export const STUDENT_NODE_ID = "student";
export const INFORMED_NODE_ID = "informed";
export const HUB_ONLY_SPECIALIST_IDS = ["teacher", "critique"] as const;

export const STUDENT_MODEL: ModelRef = "ollama:nemotron-3.5-lightning:latest";
export const TEACHER_MODEL: ModelRef = "openrouter:anthropic/claude-opus-5";
export const CRITIC_MODEL: ModelRef = "openrouter:openai/gpt-5.6-sol";
export const JUDGE_MODEL: ModelRef = "openrouter:x-ai/grok-4.6";

/** Direct parents so second-pass Nemo packs Hub + first Nemo + teachers + Judge. */
export const INFORMED_INGEST_IDS = [
  "context",
  STUDENT_NODE_ID,
  "teacher",
  "critique",
  "judge",
] as const;

function cloneNode(node: Node<PrismNodeData>): Node<PrismNodeData> {
  return {
    ...node,
    data: { ...node.data },
    position: { ...node.position },
  };
}

/** Hub → Nemo + teachers (parallel, Hub-only) → Judge → second Nemo (full ingest). No Split. */
export const STUDENT_TEACHER_NODES: Node<PrismNodeData>[] = [
  {
    id: "context",
    type: "context",
    position: { x: 380, y: 40 },
    data: {
      kind: "context",
      label: "Context Hub",
      content: STUDENT_LAB_HUB,
      status: "idle",
    },
  },
  {
    id: STUDENT_NODE_ID,
    type: "agent",
    position: { x: 80, y: 280 },
    data: {
      kind: "agent",
      label: "Nemo",
      role: "Local student — attempt the run intent from Hub only",
      steer:
        "Do the job as Prime. Omit what you don’t have. Never invent. Never mention the eval harness.",
      prompt:
        "From the architecture prompt and Hub notes only, produce the outbound draft. If a fact is missing, say we don’t have it.",
      model: STUDENT_MODEL,
      sampling: { temperature: 0.4 },
      status: "idle",
    },
  },
  {
    id: "teacher",
    type: "agent",
    position: { x: 380, y: 280 },
    data: {
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
      status: "idle",
    },
  },
  {
    id: "critique",
    type: "agent",
    position: { x: 680, y: 280 },
    data: {
      kind: "agent",
      label: "Critic",
      role: "Pressure-test the brief for leaks and mush — Hub only, not Nemo",
      steer:
        "Name invented facts, PHI, eval-leak (“in this prompt”), and line mix-ups (Jeff=THR, VPX=CTH).",
      prompt:
        "From the Hub and run intent only, list the traps a local model is likely to walk into. Do not draft the outbound message.",
      model: CRITIC_MODEL,
      sampling: { temperature: 0.5 },
      budget: { maxTokensOut: 8192 },
      status: "idle",
    },
  },
  {
    id: "judge",
    type: "merge",
    position: { x: 390, y: 520 },
    data: {
      kind: "merge",
      label: "Judge",
      role: "Name characteristics and gaps — not a laundry list",
      steer:
        "One characteristic card beats a synthesis essay. What should Nemo keep, omit, and never say?",
      prompt:
        "Compare Nemo vs Teacher vs Critic. Write the characteristic card, then the JSON trailer. keep = what Nemo got right; omit = what not to distill (verbosity / committee-speak); neverSay = leaks and forbidden phrases (e.g. “in this prompt”). One characteristic beats an essay. Do not paste this card into the isolated student prompt; second-pass Nemo may read it.",
      model: JUDGE_MODEL,
      sampling: { temperature: 0.3 },
      budget: { maxTokensOut: 8192 },
      status: "idle",
    },
  },
  {
    id: INFORMED_NODE_ID,
    type: "agent",
    position: { x: 390, y: 760 },
    data: {
      kind: "agent",
      label: "Nemo after Judge",
      role: "Second pass — same outbound job, now with Hub + first Nemo + teachers + Judge",
      steer:
        "Do the job again as Prime. Prefer Judge keep. Honor omit and never-say. Do not quote or paraphrase the Judge card. Omit unknowns. Never invent. Never write “in this prompt.”",
      prompt:
        "From the full upstream pack, produce a better outbound draft than first-pass Nemo. Apply keep / omit / never-say. Do not restate the Judge essay.",
      model: STUDENT_MODEL,
      sampling: { temperature: 0.4 },
      publish: { includeInSamples: false, redactOutput: false },
      status: "idle",
    },
  },
];

export const STUDENT_TEACHER_EDGES: Edge[] = [
  { id: "e-context-student", source: "context", target: STUDENT_NODE_ID, type: "smoothstep" },
  { id: "e-context-teacher", source: "context", target: "teacher", type: "smoothstep" },
  { id: "e-context-critique", source: "context", target: "critique", type: "smoothstep" },
  { id: "e-student-judge", source: STUDENT_NODE_ID, target: "judge", type: "smoothstep" },
  { id: "e-teacher-judge", source: "teacher", target: "judge", type: "smoothstep" },
  { id: "e-critique-judge", source: "critique", target: "judge", type: "smoothstep" },
  ...INFORMED_INGEST_IDS.map((source) => ({
    id: `e-${source}-${INFORMED_NODE_ID}`,
    source,
    target: INFORMED_NODE_ID,
    type: "smoothstep" as const,
  })),
];

const INFORMED_TEMPLATE = STUDENT_TEACHER_NODES.find(
  (n) => n.id === INFORMED_NODE_ID,
)!;

/** Add second-pass Nemo + full-ingest edges on older student-vs-teachers graphs. */
export function ensureInformedStudentHop(
  nodes: Node<PrismNodeData>[],
  edges: Edge[],
): { nodes: Node<PrismNodeData>[]; edges: Edge[] } {
  const ids = new Set(nodes.map((n) => n.id));
  if (!ids.has(STUDENT_NODE_ID) || !ids.has("judge")) {
    return { nodes, edges };
  }

  const nextNodes = ids.has(INFORMED_NODE_ID)
    ? nodes
    : [...nodes, cloneNode(INFORMED_TEMPLATE)];
  const present = new Set(nextNodes.map((n) => n.id));
  const nextEdges = [...edges];

  for (const source of INFORMED_INGEST_IDS) {
    if (!present.has(source)) continue;
    const exists = nextEdges.some(
      (e) => e.source === source && e.target === INFORMED_NODE_ID,
    );
    if (exists) continue;
    nextEdges.push({
      id: `e-${source}-${INFORMED_NODE_ID}`,
      source,
      target: INFORMED_NODE_ID,
      type: "smoothstep",
    });
  }

  return { nodes: nextNodes, edges: nextEdges };
}

export function studentTeachersNeedsInformedHop(
  nodes: Node<PrismNodeData>[],
  edges: Edge[],
) {
  const ids = new Set(nodes.map((n) => n.id));
  if (!ids.has(STUDENT_NODE_ID) || !ids.has("judge")) return false;
  if (!ids.has(INFORMED_NODE_ID)) return true;
  return INFORMED_INGEST_IDS.some(
    (source) =>
      ids.has(source) &&
      !edges.some((e) => e.source === source && e.target === INFORMED_NODE_ID),
  );
}
