import type { Edge, Node } from "@xyflow/react";
import { extractJsonObject, type ChatMessage } from "./compose-messages";
import {
  CONTEXT_SOURCE_OPTIONS,
  type ContextSourceKind,
} from "./context-sources";
import {
  createDocumentFromGraph,
  type PrismDocument,
} from "./document";
import type { PrismUser } from "./identity";
import { layoutPrismFlow } from "./layout-flow";
import {
  defaultModelForProvider,
  MODEL_OPTIONS,
  normalizeModelRef,
  parseModelRef,
  type ModelRef,
  type ProviderId,
} from "./providers";
import {
  CRITIC_MODEL,
  HUB_ONLY_SPECIALIST_IDS,
  INFORMED_NODE_ID,
  JUDGE_MODEL,
  STUDENT_MODEL,
  STUDENT_NODE_ID,
  TEACHER_MODEL,
} from "./student-graph";
import type { NodeForward, NodeKind, PrismNodeData } from "./types";

export const BUILDER_TEMPLATE_ID = "builder";
export const BUILDER_MODEL: ModelRef = "openrouter:x-ai/grok-4.6";
export const BUILDER_NODE_CAP = 12;
export const BUILDER_ROLE =
  "Prism architecture builder — you author mixture-of-agents graphs, not run them.";

const NODE_KINDS: NodeKind[] = [
  "context",
  "context-source",
  "router",
  "agent",
  "merge",
];

const SOURCE_KINDS = new Set(
  CONTEXT_SOURCE_OPTIONS.map((o) => o.kind),
);

const CATALOG_REFS = MODEL_OPTIONS.map((m) => m.ref).join(", ");

export const BUILDER_STEER = `Emit JSON only (optional markdown fence). No prose.

Always include exactly one Context Hub (kind "context", prefer id "context").
Kinds: context | context-source | router | agent | merge.
Prefer Hub → optional Split (router) → named specialists (agent) → Judge (merge).
DAG — no cycles. Cap ${BUILDER_NODE_CAP} nodes.
Every router/agent/merge needs label, role, steer, prompt (short, opinionated).
Models are provider:model from this catalog, or omit and we fill the lab default: ${CATALOG_REFS}.
Do not put Ollama/Nemo on every specialist. Nemo is only the student hop (id "student") and optional post-Judge hop (id "informed").
If Nemo/student is present, Teacher (id "teacher") and Critic (id "critique") must be Hub-only: edges from context, never from student.

Named archetypes:
- Starter MoA: context → router → research / draft / critique → judge
- Parallel debate: context → advocate + skeptic → judge (Split optional)
- Student vs teachers: context → student + teacher + critique → judge → informed. Teachers Hub-only. Second Nemo id "informed".
- Blank spine: context + router only
- SMoA: Split or Judge may set forward.keepK (often 3)
- Dual judge: two merge nodes is allowed if the DAG stays acyclic

context-source needs sourceKind (notes, documents, urls, knowledge, …) and should feed the Hub.

JSON shape:
{
  "name": "short architecture name",
  "description": "one line",
  "prompt": "run intent for the whole pathway",
  "tags": ["moa"],
  "nodes": [
    { "id": "context", "kind": "context", "label": "Context Hub", "content": "hub notes" },
    { "id": "research", "kind": "agent", "label": "Researcher", "role": "…", "steer": "…", "prompt": "…" }
  ],
  "edges": [{ "source": "context", "target": "research" }]
}

Ids: lowercase slug, letter first (student, judge, advocate). Edge ids optional.`;

export type BuilderNodeSpec = {
  id: string;
  kind: NodeKind;
  label: string;
  role?: string;
  steer?: string;
  prompt?: string;
  content?: string;
  model?: string;
  sourceKind?: ContextSourceKind;
  keepK?: number;
};

export type BuilderEdgeSpec = {
  source: string;
  target: string;
};

export type BuilderGraphSpec = {
  name: string;
  description: string;
  prompt: string;
  tags: string[];
  nodes: BuilderNodeSpec[];
  edges: BuilderEdgeSpec[];
};

export type BuilderParseResult =
  | { spec: BuilderGraphSpec }
  | { error: string };

export function builderMessages(archetype: string): ChatMessage[] {
  return [
    {
      role: "system",
      content: `You are a node in Prism, a mixture-of-agents lab.\nRole: ${BUILDER_ROLE}\nSteer: ${BUILDER_STEER}`,
    },
    {
      role: "user",
      content: [
        "## Archetype to build",
        archetype.trim(),
        "",
        "## Task",
        "Author one Prism architecture that matches this archetype.",
        "Reply with the JSON spec only.",
      ].join("\n"),
    },
  ];
}

export function builderRepairMessages(
  archetype: string,
  previousRaw: string,
  error: string,
): ChatMessage[] {
  return [
    ...builderMessages(archetype),
    { role: "assistant", content: previousRaw },
    {
      role: "user",
      content: [
        "That spec failed validation:",
        error,
        "",
        "Return a corrected JSON spec only. Keep the same archetype.",
      ].join("\n"),
    },
  ];
}

export function parseBuilderSpec(raw: string): BuilderParseResult {
  const jsonText = extractJsonObject(raw);
  if (!jsonText) {
    return { error: "Builder did not return a JSON object." };
  }
  try {
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;
    return coerceBuilderSpec(parsed);
  } catch {
    return { error: "Builder JSON did not parse." };
  }
}

export function validateBuilderSpec(spec: BuilderGraphSpec): string[] {
  const errors: string[] = [];
  if (!spec.nodes.length) errors.push("Need at least one node.");
  if (spec.nodes.length > BUILDER_NODE_CAP) {
    errors.push(`Cap is ${BUILDER_NODE_CAP} nodes (got ${spec.nodes.length}).`);
  }

  const ids = spec.nodes.map((n) => n.id);
  const unique = new Set(ids);
  if (unique.size !== ids.length) errors.push("Node ids must be unique.");

  for (const node of spec.nodes) {
    if (!/^[a-z][a-z0-9-]{0,47}$/.test(node.id)) {
      errors.push(`Bad node id “${node.id}” — use a lowercase slug.`);
    }
    if (!NODE_KINDS.includes(node.kind)) {
      errors.push(`Unknown kind “${node.kind}” on ${node.id}.`);
    }
    if (!node.label.trim()) errors.push(`Node ${node.id} needs a label.`);
    if (node.kind === "context-source") {
      if (!node.sourceKind || !SOURCE_KINDS.has(node.sourceKind)) {
        errors.push(`Channel ${node.id} needs a valid sourceKind.`);
      }
    }
    if (isLlmKind(node.kind)) {
      if (!node.role?.trim()) errors.push(`${node.id} needs a role.`);
      if (!node.steer?.trim()) errors.push(`${node.id} needs steer.`);
      if (!node.prompt?.trim()) errors.push(`${node.id} needs a prompt.`);
    }
  }

  const hubs = spec.nodes.filter((n) => n.kind === "context");
  if (hubs.length < 1) errors.push("Need one Context Hub (kind context).");

  for (const edge of spec.edges) {
    if (!unique.has(edge.source) || !unique.has(edge.target)) {
      errors.push(`Edge ${edge.source} → ${edge.target} points at a missing node.`);
    }
    if (edge.source === edge.target) {
      errors.push(`Self-edge on ${edge.source} is not allowed.`);
    }
  }

  if (hasCycle(ids, spec.edges)) {
    errors.push("Graph must be a DAG (no cycles).");
  }

  return errors;
}

export function hydrateBuilderSpec(
  spec: BuilderGraphSpec,
  owner: Pick<PrismUser, "id" | "name">,
  defaultProvider: ProviderId,
): PrismDocument {
  const fixed = applyIsolationFixes(spec);
  const nodes: Node<PrismNodeData>[] = fixed.nodes.map((node) =>
    hydrateNode(node, defaultProvider),
  );
  const edges: Edge[] = uniqueEdges(fixed.edges).map((edge) => ({
    id: `e-${edge.source}-${edge.target}`,
    source: edge.source,
    target: edge.target,
    type: "smoothstep",
  }));
  const laid = layoutPrismFlow(nodes);
  const sourceKinds = fixed.nodes
    .map((n) => n.sourceKind)
    .filter((k): k is ContextSourceKind => Boolean(k));

  const doc = createDocumentFromGraph({
    name: fixed.name.trim() || "Built architecture",
    owner,
    prompt: fixed.prompt,
    description: fixed.description,
    tags: fixed.tags.length ? fixed.tags : ["builder"],
    templateId: BUILDER_TEMPLATE_ID,
    nodes: laid,
    edges,
  });
  doc.enabledContextKinds = [...new Set(sourceKinds)];
  return doc;
}

function coerceBuilderSpec(raw: Record<string, unknown>): BuilderParseResult {
  const nodeRows = Array.isArray(raw.nodes) ? raw.nodes : [];
  const edgeRows = Array.isArray(raw.edges) ? raw.edges : [];
  const nodes: BuilderNodeSpec[] = [];
  for (const item of nodeRows) {
    const node = coerceNode(item);
    if (node) nodes.push(node);
  }
  const edges: BuilderEdgeSpec[] = [];
  for (const item of edgeRows) {
    const edge = coerceEdge(item);
    if (edge) edges.push(edge);
  }

  const tags = Array.isArray(raw.tags)
    ? raw.tags
        .map((t) => (typeof t === "string" ? t.trim() : ""))
        .filter(Boolean)
    : [];

  const spec: BuilderGraphSpec = {
    name: stringField(raw.name) || "Built architecture",
    description: stringField(raw.description),
    prompt: stringField(raw.prompt) || stringField(raw.archetype),
    tags,
    nodes,
    edges,
  };
  const errors = validateBuilderSpec(spec);
  if (errors.length) return { error: errors.join(" ") };
  return { spec };
}

function coerceNode(item: unknown): BuilderNodeSpec | null {
  if (!item || typeof item !== "object") return null;
  const row = item as Record<string, unknown>;
  const id = slugId(stringField(row.id) || stringField(row.nodeId));
  if (!id) return null;
  const kindRaw = (stringField(row.kind) || stringField(row.type)).toLowerCase();
  const kind = (NODE_KINDS.includes(kindRaw as NodeKind)
    ? kindRaw
    : inferKind(kindRaw, id, stringField(row.label))) as NodeKind;
  const sourceKind = coerceSourceKind(row.sourceKind ?? row.channel, id);
  const keepK = numberField(row.keepK) ?? numberField(
    row.forward && typeof row.forward === "object"
      ? (row.forward as Record<string, unknown>).keepK
      : undefined,
  );

  return {
    id,
    kind,
    label: stringField(row.label) || titleFromId(id),
    role: stringField(row.role) || undefined,
    steer: stringField(row.steer) || undefined,
    prompt: stringField(row.prompt) || undefined,
    content: stringField(row.content) || undefined,
    model: stringField(row.model) || undefined,
    sourceKind,
    keepK,
  };
}

function coerceEdge(item: unknown): BuilderEdgeSpec | null {
  if (!item || typeof item !== "object") return null;
  const row = item as Record<string, unknown>;
  const source = slugId(stringField(row.source) || stringField(row.from));
  const target = slugId(stringField(row.target) || stringField(row.to));
  if (!source || !target) return null;
  return { source, target };
}

function inferKind(raw: string, id: string, label: string): NodeKind {
  if (raw === "split" || id === "router" || id === "split") return "router";
  if (raw === "judge" || raw === "synthesizer" || id === "judge") return "merge";
  if (raw === "hub" || id === "context" || /hub/i.test(label)) return "context";
  if (raw === "channel" || raw.startsWith("context-source") || id.startsWith("context-source")) {
    return "context-source";
  }
  return "agent";
}

function coerceSourceKind(raw: unknown, id: string): ContextSourceKind | undefined {
  const text = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (text && SOURCE_KINDS.has(text as ContextSourceKind)) {
    return text as ContextSourceKind;
  }
  for (const kind of SOURCE_KINDS) {
    if (id.includes(kind)) return kind;
  }
  return undefined;
}

function applyIsolationFixes(spec: BuilderGraphSpec): BuilderGraphSpec {
  const ids = new Set(spec.nodes.map((n) => n.id));
  if (!ids.has(STUDENT_NODE_ID)) return spec;
  const hubId =
    spec.nodes.find((n) => n.id === "context")?.id ??
    spec.nodes.find((n) => n.kind === "context")?.id;
  if (!hubId) return spec;

  const specialistSet = new Set<string>(
    HUB_ONLY_SPECIALIST_IDS.filter((id) => ids.has(id)),
  );
  if (!specialistSet.size) return spec;

  const edges = spec.edges.filter(
    (e) => !(e.source === STUDENT_NODE_ID && specialistSet.has(e.target)),
  );
  for (const id of specialistSet) {
    const hasHub = edges.some((e) => e.source === hubId && e.target === id);
    if (!hasHub) edges.push({ source: hubId, target: id });
  }
  return { ...spec, edges };
}

function hydrateNode(
  spec: BuilderNodeSpec,
  defaultProvider: ProviderId,
): Node<PrismNodeData> {
  const data: PrismNodeData = {
    kind: spec.kind,
    label: spec.label,
    status: "idle",
  };
  if (spec.kind === "context") {
    data.content = spec.content ?? "";
  }
  if (spec.kind === "context-source") {
    const meta = CONTEXT_SOURCE_OPTIONS.find((o) => o.kind === spec.sourceKind);
    data.sourceKind = spec.sourceKind;
    data.label = spec.label || meta?.label || spec.id;
    data.role = spec.role || meta?.hint;
  }
  if (isLlmKind(spec.kind)) {
    data.role = spec.role;
    data.steer = spec.steer;
    data.prompt = spec.prompt;
    data.model = modelForNode(spec, defaultProvider);
    data.sampling = {
      temperature:
        spec.kind === "router" ? 0.2 : spec.kind === "merge" ? 0.3 : 0.7,
    };
    data.publish = { includeInSamples: true, redactOutput: false };
    const forward = forwardFor(spec);
    if (forward) data.forward = forward;
    if (spec.id === INFORMED_NODE_ID) {
      data.publish = { includeInSamples: false, redactOutput: false };
    }
  }
  return {
    id: spec.id,
    type: spec.kind,
    position: { x: 0, y: 0 },
    data,
  };
}

function modelForNode(
  spec: BuilderNodeSpec,
  defaultProvider: ProviderId,
): ModelRef {
  const id = spec.id;
  const label = spec.label.toLowerCase();
  const isNemo =
    id === STUDENT_NODE_ID ||
    id === INFORMED_NODE_ID ||
    label === "nemo";
  if (isNemo) return STUDENT_MODEL;

  const parsed = spec.model ? parseModelRef(normalizeModelRef(spec.model)) : null;
  if (parsed?.provider === "ollama") {
    return defaultModelForProvider(defaultProvider);
  }
  if (parsed) return normalizeModelRef(spec.model);

  if (id === "teacher" || label === "teacher") return TEACHER_MODEL;
  if (id === "critique" || id === "critic" || label === "critic") return CRITIC_MODEL;
  if (spec.kind === "merge") return JUDGE_MODEL;
  return defaultModelForProvider(defaultProvider);
}

function forwardFor(spec: BuilderNodeSpec): NodeForward | undefined {
  if (spec.kind !== "router" && spec.kind !== "merge") return undefined;
  if (spec.keepK == null) {
    return spec.kind === "router"
      ? { keepK: 3, stopOnConsensus: false, maxRounds: 1 }
      : { keepK: 3, stopOnConsensus: true, maxRounds: 2 };
  }
  return {
    keepK: spec.keepK,
    stopOnConsensus: spec.kind === "merge",
    maxRounds: spec.kind === "merge" ? 2 : 1,
  };
}

function hasCycle(nodeIds: string[], edges: BuilderEdgeSpec[]): boolean {
  const ids = new Set(nodeIds);
  const indeg = new Map<string, number>();
  const outs = new Map<string, string[]>();
  for (const id of ids) {
    indeg.set(id, 0);
    outs.set(id, []);
  }
  for (const edge of edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) continue;
    if (edge.source === edge.target) return true;
    indeg.set(edge.target, (indeg.get(edge.target) ?? 0) + 1);
    outs.get(edge.source)!.push(edge.target);
  }
  const ready = [...ids].filter((id) => (indeg.get(id) ?? 0) === 0);
  const seen: string[] = [];
  while (ready.length) {
    const id = ready.shift()!;
    seen.push(id);
    for (const child of outs.get(id) ?? []) {
      const next = (indeg.get(child) ?? 0) - 1;
      indeg.set(child, next);
      if (next === 0) ready.push(child);
    }
  }
  return seen.length !== ids.size;
}

function uniqueEdges(edges: BuilderEdgeSpec[]): BuilderEdgeSpec[] {
  const seen = new Set<string>();
  const out: BuilderEdgeSpec[] = [];
  for (const edge of edges) {
    const key = `${edge.source}->${edge.target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(edge);
  }
  return out;
}

function isLlmKind(kind: NodeKind): boolean {
  return kind === "router" || kind === "agent" || kind === "merge";
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberField(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function slugId(raw: string): string {
  const s = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return /^[a-z][a-z0-9-]*$/.test(s) ? s : "";
}

function titleFromId(id: string) {
  return id
    .split("-")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}
