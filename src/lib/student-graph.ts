import type { Edge, Node } from "@xyflow/react";
import type { ModelRef } from "./providers";
import { STUDENT_LAB_HUB } from "./student-lab";
import type { PrismNodeData } from "./types";

export const TEACHER_MODEL: ModelRef = "openrouter:anthropic/claude-opus-5";
export const CRITIC_MODEL: ModelRef = "openrouter:openai/gpt-5.6-sol";
export const JUDGE_MODEL: ModelRef = "openrouter:x-ai/grok-4.6";

/** Hub → Nemo + teachers (parallel, Hub-only) → Judge. No Split. */
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
    id: "student",
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
      model: "ollama:nemotron-3.5-lightning:latest",
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
        "Compare Nemo vs Teacher vs Critic. Output: (1) what Nemo got right, (2) one characteristic to add to SYSTEM.md, (3) what not to distill (verbosity / committee-speak).",
      model: JUDGE_MODEL,
      sampling: { temperature: 0.3 },
      budget: { maxTokensOut: 8192 },
      status: "idle",
    },
  },
];

export const STUDENT_TEACHER_EDGES: Edge[] = [
  { id: "e-context-student", source: "context", target: "student", type: "smoothstep" },
  { id: "e-context-teacher", source: "context", target: "teacher", type: "smoothstep" },
  { id: "e-context-critique", source: "context", target: "critique", type: "smoothstep" },
  { id: "e-student-judge", source: "student", target: "judge", type: "smoothstep" },
  { id: "e-teacher-judge", source: "teacher", target: "judge", type: "smoothstep" },
  { id: "e-critique-judge", source: "critique", target: "judge", type: "smoothstep" },
];
