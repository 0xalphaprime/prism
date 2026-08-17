import type { Edge, Node } from "@xyflow/react";
import type { PrismNodeData } from "./types";

/** Top → bottom workflow layout */
export const STARTER_NODES: Node<PrismNodeData>[] = [
  {
    id: "context",
    type: "context",
    position: { x: 380, y: 40 },
    data: {
      kind: "context",
      label: "Context Hub",
      content:
        "Goal: Brief a product team on visual multi-agent orchestration.\n\nConstraints: Keep answers concrete. Prefer tradeoffs over hype.\n\nSeed notes: Prism is a sandbox where context splits into specialist branches you can step through and inspect.",
      status: "idle",
    },
  },
  {
    id: "router",
    type: "router",
    position: { x: 400, y: 280 },
    data: {
      kind: "router",
      label: "Split",
      role: "Fan context into specialist lanes",
      steer: "Keep lanes distinct; don’t collapse the brief into one generic ask.",
      prompt:
        "Decide which specialist lanes should run. Activate only lanes that add real variety; skip redundant ones. Give each activated lane a short brief.",
      model: "openai:gpt-4o-mini",
      sampling: { temperature: 0.2 },
      status: "idle",
    },
  },
  {
    id: "research",
    type: "agent",
    position: { x: 80, y: 480 },
    data: {
      kind: "agent",
      label: "Researcher",
      role: "Surface competitive patterns and open wedges",
      steer: "Name real products and concrete gaps — skip vague category talk.",
      prompt:
        "From the upstream context, list the closest products and what is still open for a MoA sandbox.",
      model: "openai:gpt-4o-mini",
      status: "idle",
    },
  },
  {
    id: "draft",
    type: "agent",
    position: { x: 380, y: 480 },
    data: {
      kind: "agent",
      label: "Writer",
      role: "Draft a crisp product narrative",
      steer: "Demo-ready voice; short, sharp, no fluff.",
      prompt:
        "Write a short product statement and three demo beats for Prism using the upstream context.",
      model: "openai:gpt-4o",
      status: "idle",
    },
  },
  {
    id: "critique",
    type: "agent",
    position: { x: 680, y: 480 },
    data: {
      kind: "agent",
      label: "Critic",
      role: "Pressure-test clarity and differentiation",
      steer: "Attack mushy claims; protect what must stay distinct.",
      prompt:
        "Critique the product idea for mushy positioning. Name what must stay sharp.",
      model: "openai:gpt-4o-mini",
      status: "idle",
    },
  },
  {
    id: "judge",
    type: "merge",
    position: { x: 390, y: 720 },
    data: {
      kind: "merge",
      label: "Judge",
      role: "Merge branches into one recommendation",
      steer: "One crisp recommendation beats a laundry list.",
      prompt:
        "Synthesize research, draft, and critique into a single weekend-ready recommendation.",
      model: "openai:gpt-4o",
      status: "idle",
    },
  },
];

export const STARTER_EDGES: Edge[] = [
  {
    id: "e-context-router",
    source: "context",
    target: "router",
    type: "smoothstep",
  },
  {
    id: "e-router-research",
    source: "router",
    target: "research",
    type: "smoothstep",
  },
  {
    id: "e-router-draft",
    source: "router",
    target: "draft",
    type: "smoothstep",
  },
  {
    id: "e-router-critique",
    source: "router",
    target: "critique",
    type: "smoothstep",
  },
  {
    id: "e-research-judge",
    source: "research",
    target: "judge",
    type: "smoothstep",
  },
  {
    id: "e-draft-judge",
    source: "draft",
    target: "judge",
    type: "smoothstep",
  },
  {
    id: "e-critique-judge",
    source: "critique",
    target: "judge",
    type: "smoothstep",
  },
];
