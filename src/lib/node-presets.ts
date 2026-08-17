import type {
  NodeBudget,
  NodeForward,
  NodePublish,
  NodeSampling,
  PrismNodeData,
} from "./types";
import { newId } from "./id";
import type { ModelRef } from "./providers";

export const NODE_PRESETS_KEY = "prism.nodePresets.v1";

export type PresetKind = "router" | "agent" | "merge";

/** Role pack fields saved on a preset (no runtime output/status). */
export type NodePresetData = {
  label: string;
  role?: string;
  steer?: string;
  prompt?: string;
  model?: ModelRef;
  budget?: NodeBudget;
  sampling?: NodeSampling;
  toolsAllowlist?: string[];
  outputSchema?: string;
  forward?: NodeForward;
  evalRubric?: string;
  publish?: NodePublish;
};

export type NodePreset = {
  id: string;
  name: string;
  kind: PresetKind;
  builtIn?: boolean;
  tags?: string[];
  data: NodePresetData;
  updatedAt: number;
};

function pack(
  kind: PresetKind,
  name: string,
  data: NodePresetData,
  tags: string[],
  id: string,
): NodePreset {
  return {
    id,
    name,
    kind,
    builtIn: true,
    tags,
    data,
    updatedAt: 0,
  };
}

/** Seeded, read-only role packs. */
export const BUILT_IN_PRESETS: NodePreset[] = [
  pack(
    "router",
    "Split (route)",
    {
      label: "Split",
      role: "Fan context into specialist lanes",
      steer: "Keep lanes distinct; don’t collapse the brief into one generic ask.",
      prompt:
        "Decide which specialist lanes should run. Activate only lanes that add real variety; skip redundant ones. Give each activated lane a short brief.",
      model: "openai:gpt-4o-mini",
      sampling: { temperature: 0.2 },
      forward: { keepK: 3, stopOnConsensus: false, maxRounds: 1 },
      publish: { includeInSamples: true, redactOutput: false },
    },
    ["router", "moa"],
    "builtin-split-route",
  ),
  pack(
    "agent",
    "Researcher",
    {
      label: "Researcher",
      role: "Surface competitive patterns and open wedges",
      steer: "Name real products and concrete gaps — skip vague category talk.",
      prompt:
        "From the upstream context, list the closest products and what is still open for a MoA sandbox.",
      model: "openai:gpt-4o-mini",
      sampling: { temperature: 0.7 },
      publish: { includeInSamples: true, redactOutput: false },
    },
    ["agent", "moa"],
    "builtin-researcher",
  ),
  pack(
    "agent",
    "Writer",
    {
      label: "Writer",
      role: "Draft a crisp product narrative",
      steer: "Demo-ready voice; short, sharp, no fluff.",
      prompt:
        "Write a short product statement and three demo beats using the upstream context.",
      model: "openai:gpt-4o",
      sampling: { temperature: 0.7 },
      publish: { includeInSamples: true, redactOutput: false },
    },
    ["agent", "moa"],
    "builtin-writer",
  ),
  pack(
    "agent",
    "Critic",
    {
      label: "Critic",
      role: "Pressure-test clarity and differentiation",
      steer: "Attack mushy claims; protect what must stay distinct.",
      prompt:
        "Critique the idea for mushy positioning. Name what must stay sharp.",
      model: "openai:gpt-4o-mini",
      sampling: { temperature: 0.5 },
      publish: { includeInSamples: true, redactOutput: false },
    },
    ["agent", "moa"],
    "builtin-critic",
  ),
  pack(
    "agent",
    "Summarizer",
    {
      label: "Summarizer",
      role: "Compress branch outputs before judgment",
      steer: "Bullets only — preserve decisions, drop fluff.",
      prompt: "Summarize upstream specialist outputs into crisp bullets.",
      model: "openai:gpt-4o-mini",
      sampling: { temperature: 0.3 },
      publish: { includeInSamples: true, redactOutput: false },
    },
    ["agent", "utility"],
    "builtin-summarizer",
  ),
  pack(
    "agent",
    "Red-team",
    {
      label: "Red-team",
      role: "Find failure modes and adversarial angles",
      steer: "Assume the happy path is wrong; name concrete break cases.",
      prompt:
        "Red-team the upstream proposal. List the top failure modes, who gets hurt, and what would falsify the claim.",
      model: "openai:gpt-4o-mini",
      sampling: { temperature: 0.6 },
      publish: { includeInSamples: true, redactOutput: false },
    },
    ["agent", "security"],
    "builtin-redteam",
  ),
  pack(
    "agent",
    "Nemo (student)",
    {
      label: "Nemo",
      role: "Local student — attempt the run intent from Hub only",
      steer:
        "Do the job as Prime. Omit what you don’t have. Never invent. Never mention the eval harness.",
      prompt:
        "From the architecture prompt and Hub notes only, produce the outbound draft. If a fact is missing, say we don’t have it.",
      model: "ollama:nemotron-3.5-lightning:latest",
      sampling: { temperature: 0.4 },
      publish: { includeInSamples: true, redactOutput: false },
    },
    ["agent", "student", "foundry"],
    "builtin-nemo-student",
  ),
  pack(
    "merge",
    "Judge (crisp)",
    {
      label: "Judge",
      role: "Merge branches into one recommendation",
      steer: "One crisp recommendation beats a laundry list.",
      prompt:
        "Synthesize upstream branches into a single weekend-ready recommendation with tradeoffs.",
      model: "openai:gpt-4o",
      sampling: { temperature: 0.3 },
      forward: { keepK: 3, stopOnConsensus: true, maxRounds: 2 },
      publish: { includeInSamples: true, redactOutput: false },
    },
    ["judge", "moa"],
    "builtin-judge-crisp",
  ),
];

function clonePreset(p: NodePreset): NodePreset {
  return {
    ...p,
    tags: p.tags ? [...p.tags] : undefined,
    data: {
      ...p.data,
      budget: p.data.budget ? { ...p.data.budget } : undefined,
      sampling: p.data.sampling ? { ...p.data.sampling } : undefined,
      toolsAllowlist: p.data.toolsAllowlist
        ? [...p.data.toolsAllowlist]
        : undefined,
      forward: p.data.forward ? { ...p.data.forward } : undefined,
      publish: p.data.publish ? { ...p.data.publish } : undefined,
    },
  };
}

export function defaultNodePresets(): NodePreset[] {
  return BUILT_IN_PRESETS.map(clonePreset);
}

function mergeWithBuiltIns(user: NodePreset[]): NodePreset[] {
  const builtIds = new Set(BUILT_IN_PRESETS.map((p) => p.id));
  const userOnly = user
    .filter((p) => !p.builtIn && !builtIds.has(p.id))
    .map(clonePreset);
  return [...defaultNodePresets(), ...userOnly];
}

export function loadNodePresets(): NodePreset[] {
  if (typeof window === "undefined") return defaultNodePresets();
  try {
    const raw = localStorage.getItem(NODE_PRESETS_KEY);
    if (!raw) return defaultNodePresets();
    const parsed = JSON.parse(raw) as { presets?: NodePreset[] };
    if (!Array.isArray(parsed.presets)) return defaultNodePresets();
    return mergeWithBuiltIns(parsed.presets);
  } catch {
    return defaultNodePresets();
  }
}

/** Persist only user-owned presets (built-ins are always re-seeded). */
export function saveNodePresets(presets: NodePreset[]) {
  if (typeof window === "undefined") return;
  const user = presets.filter((p) => !p.builtIn);
  localStorage.setItem(
    NODE_PRESETS_KEY,
    JSON.stringify({ presets: user }),
  );
}

export function extractPresetData(node: PrismNodeData): NodePresetData {
  return {
    label: node.label,
    role: node.role,
    steer: node.steer,
    prompt: node.prompt,
    model: node.model,
    budget: node.budget ? { ...node.budget } : undefined,
    sampling: node.sampling ? { ...node.sampling } : undefined,
    toolsAllowlist: node.toolsAllowlist
      ? [...node.toolsAllowlist]
      : undefined,
    outputSchema: node.outputSchema,
    forward: node.forward ? { ...node.forward } : undefined,
    evalRubric: node.evalRubric,
    publish: node.publish ? { ...node.publish } : undefined,
  };
}

export function presetDataToNodeData(
  kind: PresetKind,
  data: NodePresetData,
): PrismNodeData {
  return {
    kind,
    label: data.label,
    role: data.role,
    steer: data.steer,
    prompt: data.prompt,
    model: data.model,
    budget: data.budget ? { ...data.budget } : undefined,
    sampling: data.sampling ? { ...data.sampling } : undefined,
    toolsAllowlist: data.toolsAllowlist
      ? [...data.toolsAllowlist]
      : undefined,
    outputSchema: data.outputSchema,
    forward: data.forward ? { ...data.forward } : undefined,
    evalRubric: data.evalRubric,
    publish: data.publish ? { ...data.publish } : undefined,
    status: "idle",
  };
}

/**
 * Upsert a user preset by name (same kind). Overwrites existing user preset
 * with the same name; never overwrites built-ins (creates a user copy instead).
 */
export function upsertUserPreset(
  presets: NodePreset[],
  args: {
    name: string;
    kind: PresetKind;
    data: NodePresetData;
  },
): NodePreset[] {
  const name = args.name.trim();
  if (!name) return presets;

  const existingUser = presets.find(
    (p) =>
      !p.builtIn &&
      p.kind === args.kind &&
      p.name.toLowerCase() === name.toLowerCase(),
  );

  const next: NodePreset = {
    id: existingUser?.id ?? `preset-${newId().slice(0, 8)}`,
    name,
    kind: args.kind,
    builtIn: false,
    tags: existingUser?.tags ?? [args.kind],
    data: { ...args.data, label: args.data.label || name },
    updatedAt: Date.now(),
  };

  if (existingUser) {
    return presets.map((p) => (p.id === existingUser.id ? next : p));
  }
  return [...presets, next];
}

export function deleteUserPreset(
  presets: NodePreset[],
  id: string,
): NodePreset[] | null {
  const hit = presets.find((p) => p.id === id);
  if (!hit || hit.builtIn) return null;
  return presets.filter((p) => p.id !== id);
}

export function findPreset(
  presets: NodePreset[],
  id: string,
): NodePreset | undefined {
  return presets.find((p) => p.id === id);
}
