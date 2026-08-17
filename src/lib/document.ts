import type { Edge, Node } from "@xyflow/react";
import {
  mergeConnectionPresets,
  normalizeConnection,
  seedConnections,
  type PrismConnection,
} from "./connections";
import { newId } from "./id";
import type { AttachedContext, ContextSourceKind } from "./context-sources";
import type { PrismUser } from "./identity";
import { normalizeModelRef } from "./providers";
import type { RunRecord } from "./runs";
import { STARTER_EDGES, STARTER_NODES } from "./starter-graph";
import type { PrismNodeData } from "./types";

export const DOCUMENT_SCHEMA_VERSION = 3;
export const LIBRARY_KEY = "prism.library.v3";

export type PrismDocument = {
  schemaVersion: number;
  id: string;
  name: string;
  /** Owner identity (local stub until auth) */
  owner: Pick<PrismUser, "id" | "name">;
  /** Run intent */
  prompt: string;
  description: string;
  tags: string[];
  templateId?: string;
  enabledContextKinds: ContextSourceKind[];
  attachedContext: AttachedContext[];
  connections: PrismConnection[];
  nodes: Node<PrismNodeData>[];
  edges: Edge[];
  /** Experiment / pathway history */
  runs: RunRecord[];
  createdAt: number;
  updatedAt: number;
};

export type PrismLibrary = {
  schemaVersion: number;
  activeId: string;
  items: PrismDocument[];
};

function cloneGraph(nodes: Node<PrismNodeData>[], edges: Edge[]) {
  return {
    nodes: nodes.map((n) => ({
      ...n,
      data: {
        ...n.data,
        model: n.data.model ? normalizeModelRef(String(n.data.model)) : n.data.model,
      },
      position: { ...n.position },
    })),
    edges: edges.map((e) => ({ ...e })),
  };
}

export function createDocumentFromGraph(args: {
  name: string;
  owner: Pick<PrismUser, "id" | "name">;
  prompt?: string;
  description?: string;
  tags?: string[];
  templateId?: string;
  nodes?: Node<PrismNodeData>[];
  edges?: Edge[];
}): PrismDocument {
  const graph = cloneGraph(
    args.nodes ?? STARTER_NODES,
    args.edges ?? STARTER_EDGES,
  );
  const now = Date.now();
  return {
    schemaVersion: DOCUMENT_SCHEMA_VERSION,
    id: newId(),
    name: args.name,
    owner: { id: args.owner.id, name: args.owner.name },
    prompt: args.prompt ?? "",
    description: args.description ?? "",
    tags: args.tags ?? [],
    templateId: args.templateId,
    enabledContextKinds: [],
    attachedContext: [],
    connections: seedConnections(),
    nodes: graph.nodes,
    edges: graph.edges,
    runs: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function createStarterDocument(owner: Pick<PrismUser, "id" | "name">) {
  return createDocumentFromGraph({
    name: "Starter MoA",
    owner,
    description: "Classic mixture-of-agents critique loop",
    tags: ["moa", "default"],
    templateId: "starter-moa",
  });
}

export function defaultLibrary(owner: Pick<PrismUser, "id" | "name">): PrismLibrary {
  const starter = createStarterDocument(owner);
  return {
    schemaVersion: DOCUMENT_SCHEMA_VERSION,
    activeId: starter.id,
    items: [starter],
  };
}

function normalizeDoc(raw: Record<string, unknown>, owner: Pick<PrismUser, "id" | "name">): PrismDocument | null {
  if (!raw || typeof raw.id !== "string" || typeof raw.name !== "string") return null;
  const nodes = (raw.nodes as PrismDocument["nodes"]) ?? [];
  if (!nodes.length) return null;

  const prompt =
    typeof raw.prompt === "string"
      ? raw.prompt
      : typeof raw.problem === "string"
        ? (raw.problem as string)
        : "";

  const ownerRaw = raw.owner as PrismDocument["owner"] | undefined;

  return {
    schemaVersion: DOCUMENT_SCHEMA_VERSION,
    id: raw.id,
    name: raw.name,
    owner: ownerRaw?.id ? ownerRaw : { id: owner.id, name: owner.name },
    prompt,
    description: typeof raw.description === "string" ? raw.description : "",
    tags: Array.isArray(raw.tags) ? (raw.tags as string[]) : [],
    templateId: typeof raw.templateId === "string" ? raw.templateId : undefined,
    enabledContextKinds: Array.isArray(raw.enabledContextKinds)
      ? (raw.enabledContextKinds as ContextSourceKind[])
      : [],
    attachedContext: Array.isArray(raw.attachedContext)
      ? (raw.attachedContext as AttachedContext[]).map((item) => ({
          ...item,
          sourceNodeId:
            item.sourceNodeId ||
            (item.kind ? `context-source-${item.kind}` : "context"),
        }))
      : [],
    connections: mergeConnectionPresets(
      Array.isArray(raw.connections)
        ? (raw.connections as Record<string, unknown>[])
            .map((c) => normalizeConnection(c))
            .filter((c): c is PrismConnection => Boolean(c))
        : seedConnections(),
    ),
    nodes: nodes.map((n) => ({
      ...n,
      data: {
        ...n.data,
        model: n.data.model ? normalizeModelRef(String(n.data.model)) : n.data.model,
      },
    })),
    edges: (raw.edges as PrismDocument["edges"]) ?? [],
    runs: Array.isArray(raw.runs) ? (raw.runs as RunRecord[]) : [],
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : Date.now(),
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : Date.now(),
  };
}

export function loadLibrary(owner: Pick<PrismUser, "id" | "name">): PrismLibrary {
  if (typeof window === "undefined") return defaultLibrary(owner);
  try {
    const raw =
      localStorage.getItem(LIBRARY_KEY) ??
      localStorage.getItem("prism.architectures.v2") ??
      localStorage.getItem("prism.architectures.v1");
    if (!raw) return defaultLibrary(owner);
    const parsed = JSON.parse(raw) as {
      activeId?: string;
      items?: Record<string, unknown>[];
    };
    const items = (parsed.items ?? [])
      .map((item) => normalizeDoc(item, owner))
      .filter((item): item is PrismDocument => Boolean(item));
    if (!items.length) return defaultLibrary(owner);
    const activeId = items.some((i) => i.id === parsed.activeId)
      ? (parsed.activeId as string)
      : items[0].id;
    const library = { schemaVersion: DOCUMENT_SCHEMA_VERSION, activeId, items };
    saveLibrary(library);
    return library;
  } catch {
    return defaultLibrary(owner);
  }
}

export function saveLibrary(library: PrismLibrary) {
  if (typeof window === "undefined") return;
  localStorage.setItem(
    LIBRARY_KEY,
    JSON.stringify({ ...library, schemaVersion: DOCUMENT_SCHEMA_VERSION }),
  );
}

export function exportDocument(doc: PrismDocument) {
  return JSON.stringify(doc, null, 2);
}

export function importDocument(
  json: string,
  owner: Pick<PrismUser, "id" | "name">,
): PrismDocument | null {
  try {
    const raw = JSON.parse(json) as Record<string, unknown>;
    const doc = normalizeDoc(raw, owner);
    if (!doc) return null;
    return {
      ...doc,
      id: newId(),
      owner: { id: owner.id, name: owner.name },
      updatedAt: Date.now(),
    };
  } catch {
    return null;
  }
}

export function clearRunFields(nodes: Node<PrismNodeData>[]) {
  return nodes.map((node) => ({
    ...node,
    data: {
      ...node.data,
      output: undefined,
      metrics: undefined,
      ingest: undefined,
      reasoning: undefined,
      status: "idle" as const,
    },
  }));
}

/** @deprecated alias during migration */
export type Architecture = PrismDocument;
