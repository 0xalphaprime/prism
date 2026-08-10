"use client";

import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  reconnectEdge,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import { create } from "zustand";
import {
  clearRunFields,
  createDocumentFromGraph,
  createStarterDocument,
  defaultLibrary,
  exportDocument,
  importDocument,
  loadLibrary,
  saveLibrary,
  type PrismDocument,
} from "@/lib/document";
import {
  loadContextCatalog,
  saveContextCatalog,
  toggleKindInCatalog,
  type ContextCatalog,
} from "@/lib/context-catalog";
import {
  CONTEXT_SOURCE_OPTIONS,
  type ContextLibraryItem,
  type ContextSourceKind,
} from "@/lib/context-sources";
import type { PrismConnection } from "@/lib/connections";
import { loadUser, renameUser, touchUser, type PrismUser } from "@/lib/identity";
import { layoutPrismFlow } from "@/lib/layout-flow";
import { normalizeModelRef } from "@/lib/providers";
import { createRunStub, type RunRecord } from "@/lib/runs";
import { STARTER_EDGES, STARTER_NODES } from "@/lib/starter-graph";
import { getTemplate, TEMPLATES } from "@/lib/templates";
import type { NodeKind, PrismNodeData, TalkMutation } from "@/lib/types";

const SSR_OWNER = { id: "local", name: "Local builder" };

function renameContextHub(nodes: Node<PrismNodeData>[]) {
  return nodes.map((node) =>
    node.data.kind === "context" &&
    (!node.data.label || node.data.label === "Context")
      ? { ...node, data: { ...node.data, label: "Context Hub" } }
      : node,
  );
}

function normalizeGraphLayout(nodes: Node<PrismNodeData>[]) {
  return layoutPrismFlow(renameContextHub(nodes));
}

function normalizeNodes(nodes: Node<PrismNodeData>[]) {
  return nodes.map((n) => ({
    ...n,
    data: {
      ...n.data,
      model: n.data.model ? normalizeModelRef(String(n.data.model)) : n.data.model,
    },
    position: { ...n.position },
  }));
}

type GraphState = {
  hydrated: boolean;
  user: PrismUser;
  architectures: PrismDocument[];
  activeId: string;
  nodes: Node<PrismNodeData>[];
  edges: Edge[];
  selectedNodeId: string | null;
  selectedRunId: string | null;
  talkDraft: string;
  lastTalkMutation: TalkMutation | null;
  dirty: boolean;
  promptOpen: boolean;
  connectionsOpen: boolean;
  runsOpen: boolean;
  contextPrefsOpen: boolean;
  contextCatalog: ContextCatalog;
  contextIntakeActive: boolean;
  layoutEpoch: number;
  hydrate: () => void;
  renameLocalUser: (name: string) => void;
  relayoutFlow: (opts?: { quiet?: boolean }) => void;
  onNodesChange: (changes: NodeChange<Node<PrismNodeData>>[]) => void;
  onEdgesChange: (changes: EdgeChange<Edge>[]) => void;
  onConnect: (connection: Connection) => void;
  selectNode: (id: string | null) => void;
  updateSelectedNode: (patch: Partial<PrismNodeData>) => void;
  updateNode: (id: string, patch: Partial<PrismNodeData>) => void;
  addNode: (
    kind: Exclude<PrismNodeData["kind"], "context-source"> | "context-source",
    opts?: { sourceKind?: ContextSourceKind },
  ) => string | null;
  deleteNode: (id: string) => boolean;
  deleteSelectedNode: () => boolean;
  onReconnect: (oldEdge: Edge, newConnection: Connection) => void;
  setTalkDraft: (value: string) => void;
  resetRunState: () => void;
  applyTalkEdit: () => void;
  selectArchitecture: (id: string) => void;
  cycleArchitecture: (dir: -1 | 1) => void;
  renameArchitecture: (name: string) => void;
  setArchitecturePrompt: (prompt: string) => void;
  setArchitectureMeta: (patch: Partial<Pick<PrismDocument, "description" | "tags">>) => void;
  setPromptOpen: (open: boolean) => void;
  setConnectionsOpen: (open: boolean) => void;
  setRunsOpen: (open: boolean) => void;
  setContextPrefsOpen: (open: boolean) => void;
  toggleCatalogKind: (kind: ContextSourceKind) => void;
  setContextIntakeActive: (open: boolean) => void;
  beginContextPass: (kinds: ContextSourceKind[]) => void;
  toggleContextKind: (kind: ContextSourceKind) => void;
  attachContextItem: (item: ContextLibraryItem, sourceNodeId: string) => void;
  removeAttachedContext: (id: string) => void;
  updateConnection: (id: string, patch: Partial<PrismConnection>) => void;
  /** Apply live /api/providers?probe=1 results onto provider connections */
  applyProviderProbes: (
    probes: Array<{
      id: string;
      ok: boolean;
      detail?: string;
    }>,
  ) => void;
  /** Apply /api/connections/probe results onto feed connections (by connectionKey) */
  applyFeedProbes: (
    probes: Array<{
      id: string;
      ok: boolean;
      detail?: string;
    }>,
  ) => void;
  selectRun: (id: string | null) => void;
  recordRunStub: (notes?: string) => void;
  saveArchitecture: () => void;
  saveArchitectureAs: (name: string) => void;
  createArchitecture: (name?: string) => void;
  createFromTemplate: (templateId: string) => void;
  duplicateArchitecture: () => void;
  deleteArchitecture: () => void;
  exportActiveArchitecture: () => string;
  importArchitectureJson: (json: string) => void;
  loadStarterIntoActive: () => void;
};

function cloneStarterGraph() {
  const nodes = STARTER_NODES.map((n) => ({
    ...n,
    data: { ...n.data },
    position: { ...n.position },
  }));
  return {
    nodes: layoutPrismFlow(nodes),
    edges: STARTER_EDGES.map((e) => ({ ...e })),
  };
}

function flushActive(get: () => GraphState): PrismDocument[] {
  const { architectures, activeId, nodes, edges, user } = get();
  return architectures.map((arch) =>
    arch.id === activeId
      ? {
          ...arch,
          owner: { id: user.id, name: user.name },
          nodes: normalizeNodes(nodes),
          edges: edges.map((e) => ({ ...e })),
          updatedAt: Date.now(),
        }
      : arch,
  );
}

function persist(get: () => GraphState) {
  const { activeId } = get();
  const nextItems = flushActive(get);
  saveLibrary({ schemaVersion: 3, activeId, items: nextItems });
  return nextItems;
}

function activeArch(state: Pick<GraphState, "architectures" | "activeId">) {
  return state.architectures.find((a) => a.id === state.activeId) ?? null;
}

function loadArchOntoCanvas(doc: PrismDocument) {
  const nodes = normalizeGraphLayout(normalizeNodes(doc.nodes));
  return {
    nodes,
    edges: doc.edges.map((e) => ({ ...e })),
    selectedNodeId: null as string | null,
    selectedRunId: doc.runs[0]?.id ?? null,
  };
}

export const useGraphStore = create<GraphState>((set, get) => {
  const boot = defaultLibrary(SSR_OWNER);
  const active = boot.items[0];
  const bootNodes = normalizeGraphLayout(normalizeNodes(active.nodes));

  return {
    hydrated: false,
    user: { ...SSR_OWNER, updatedAt: Date.now() },
    architectures: boot.items.map((arch) =>
      arch.id === active.id ? { ...arch, nodes: bootNodes } : arch,
    ),
    activeId: boot.activeId,
    nodes: bootNodes,
    edges: active.edges,
    selectedNodeId: null,
    selectedRunId: null,
    talkDraft: "",
    lastTalkMutation: null,
    dirty: false,
    promptOpen: false,
    connectionsOpen: false,
    runsOpen: false,
    contextPrefsOpen: false,
    contextCatalog: {
      enabledKinds: CONTEXT_SOURCE_OPTIONS.map((o) => o.kind),
    },
    contextIntakeActive: false,
    layoutEpoch: 0,

    hydrate: () => {
      if (get().hydrated) return;
      const user = touchUser(loadUser());
      const contextCatalog = loadContextCatalog();
      const library = loadLibrary(user);
      const current =
        library.items.find((a) => a.id === library.activeId) ?? library.items[0];
      const canvas = loadArchOntoCanvas(current);
      const items = library.items.map((arch) =>
        arch.id === current.id
          ? { ...arch, nodes: canvas.nodes, owner: { id: user.id, name: user.name } }
          : {
              ...arch,
              nodes: normalizeGraphLayout(normalizeNodes(arch.nodes)),
              owner: arch.owner ?? { id: user.id, name: user.name },
            },
      );
      set({
        hydrated: true,
        user,
        contextCatalog,
        architectures: items,
        activeId: current.id,
        ...canvas,
        dirty: false,
        layoutEpoch: get().layoutEpoch + 1,
      });
      saveLibrary({ schemaVersion: 3, activeId: current.id, items });
    },

    renameLocalUser: (name) => {
      const user = renameUser(get().user, name);
      const architectures = get().architectures.map((a) => ({
        ...a,
        owner: { id: user.id, name: user.name },
      }));
      set({ user, architectures, dirty: true });
      saveLibrary({
        schemaVersion: 3,
        activeId: get().activeId,
        items: architectures,
      });
    },

    relayoutFlow: (opts) => {
      const nodes = normalizeGraphLayout(get().nodes);
      set({
        nodes,
        dirty: true,
        layoutEpoch: get().layoutEpoch + 1,
        ...(opts?.quiet
          ? {}
          : {
              lastTalkMutation: {
                summary: "Re-spread the graph for a clean vertical flow.",
                applied: true,
              },
            }),
      });
    },

    onNodesChange: (changes) => {
      const removes = changes.filter(
        (c): c is NodeChange<Node<PrismNodeData>> & { type: "remove"; id: string } =>
          c.type === "remove",
      );
      const rest = changes.filter((c) => c.type !== "remove");
      if (rest.length) {
        set({ nodes: applyNodeChanges(rest, get().nodes), dirty: true });
      }
      for (const change of removes) {
        get().deleteNode(change.id);
      }
    },

    onEdgesChange: (changes) =>
      set({ edges: applyEdgeChanges(changes, get().edges), dirty: true }),

    onConnect: (connection) =>
      set({
        edges: addEdge({ ...connection, type: "smoothstep" }, get().edges),
        dirty: true,
      }),

    selectNode: (id) => set({ selectedNodeId: id }),

    updateSelectedNode: (patch) => {
      const { selectedNodeId } = get();
      if (!selectedNodeId) return;
      get().updateNode(selectedNodeId, patch);
    },

    updateNode: (id, patch) => {
      const { nodes } = get();
      const nextPatch =
        patch.model != null
          ? { ...patch, model: normalizeModelRef(String(patch.model)) }
          : patch;
      set({
        dirty: true,
        nodes: nodes.map((node) =>
          node.id === id
            ? { ...node, data: { ...node.data, ...nextPatch } }
            : node,
        ),
      });
    },

    addNode: (kind, opts) => {
      const state = get();
      const selected = state.nodes.find((n) => n.id === state.selectedNodeId);
      const anchor = selected?.position ?? {
        x: 400,
        y: Math.max(0, ...state.nodes.map((n) => n.position.y)) + 160,
      };
      const position = {
        x: Math.round(anchor.x + (selected ? 40 : 0)),
        y: Math.round(anchor.y + (selected ? 140 : 0)),
      };

      if (kind === "context-source") {
        const sourceKind = opts?.sourceKind;
        if (!sourceKind) {
          set({
            lastTalkMutation: {
              summary: "Pick a context channel kind to add.",
              applied: false,
            },
          });
          return null;
        }
        const existing = state.nodes.find(
          (n) =>
            n.data.kind === "context-source" && n.data.sourceKind === sourceKind,
        );
        if (existing) {
          set({
            selectedNodeId: existing.id,
            lastTalkMutation: {
              summary: `${existing.data.label} is already on the graph.`,
              applied: true,
            },
          });
          return existing.id;
        }

        const meta = CONTEXT_SOURCE_OPTIONS.find((o) => o.kind === sourceKind);
        const id = `context-source-${sourceKind}`;
        const hub =
          state.nodes.find((n) => n.data.kind === "context") ??
          state.nodes.find((n) => n.id === "context");
        const node: Node<PrismNodeData> = {
          id,
          type: "context-source",
          position,
          data: {
            kind: "context-source",
            label: meta?.label ?? sourceKind,
            sourceKind,
            role: meta?.hint,
            status: "idle",
          },
        };
        const edges = [...state.edges];
        if (hub) {
          edges.push({
            id: `e-${id}-${hub.id}`,
            source: id,
            target: hub.id,
            type: "smoothstep",
          });
        }
        const kinds = [
          ...new Set([
            ...(activeArch(state)?.enabledContextKinds ?? []),
            sourceKind,
          ]),
        ];
        const architectures = state.architectures.map((a) =>
          a.id === state.activeId
            ? { ...a, enabledContextKinds: kinds, updatedAt: Date.now() }
            : a,
        );
        set({
          architectures,
          nodes: [...state.nodes, node],
          edges,
          selectedNodeId: id,
          dirty: true,
          lastTalkMutation: {
            summary: `Added ${node.data.label} channel (wired to Context Hub when present). Expand to manage — or drag a handle for late inject.`,
            applied: true,
          },
        });
        return id;
      }

      const id = `${kind}-${crypto.randomUUID().slice(0, 8)}`;
      const stubs: Record<
        Exclude<NodeKind, "context-source">,
        PrismNodeData
      > = {
        context: {
          kind: "context",
          label: "Context Hub",
          content: "",
          status: "idle",
        },
        router: {
          kind: "router",
          label: "Split",
          role: "Fan context into specialist lanes",
          steer: "Keep lanes distinct; don’t collapse the brief into one generic ask.",
          status: "idle",
          forward: { keepK: 3, stopOnConsensus: false, maxRounds: 1 },
          publish: { includeInSamples: true, redactOutput: false },
        },
        agent: {
          kind: "agent",
          label: "Agent",
          role: "",
          steer: "",
          prompt: "",
          model: "openai:gpt-4o-mini",
          status: "idle",
          budget: {},
          sampling: { temperature: 0.7 },
          toolsAllowlist: [],
          outputSchema: "",
          evalRubric: "",
          publish: { includeInSamples: true, redactOutput: false },
        },
        merge: {
          kind: "merge",
          label: "Judge",
          role: "Merge branches into one recommendation",
          steer: "One crisp recommendation beats a laundry list.",
          prompt: "",
          model: "openai:gpt-4o",
          status: "idle",
          budget: {},
          sampling: { temperature: 0.3 },
          toolsAllowlist: [],
          outputSchema: "",
          forward: { keepK: 3, stopOnConsensus: true, maxRounds: 2 },
          evalRubric: "",
          publish: { includeInSamples: true, redactOutput: false },
        },
      };

      const data = stubs[kind];
      const node: Node<PrismNodeData> = {
        id,
        type: kind,
        position,
        data,
      };

      set({
        nodes: [...state.nodes, node],
        selectedNodeId: id,
        dirty: true,
        lastTalkMutation: {
          summary: `Added ${data.label}. Expand to edit attributes; drag handles to wire it in.`,
          applied: true,
        },
      });
      return id;
    },

    deleteNode: (id) => {
      const state = get();
      const target = state.nodes.find((n) => n.id === id);
      if (!target) return false;

      if (target.data.kind === "context") {
        const hubs = state.nodes.filter((n) => n.data.kind === "context");
        if (hubs.length <= 1) {
          set({
            lastTalkMutation: {
              summary: "Keep at least one Context Hub on the graph.",
              applied: false,
            },
          });
          return false;
        }
      }

      const nodes = state.nodes.filter((n) => n.id !== id);
      const edges = state.edges.filter((e) => e.source !== id && e.target !== id);

      let architectures = state.architectures;
      if (target.data.kind === "context-source" && target.data.sourceKind) {
        const sk = target.data.sourceKind;
        architectures = state.architectures.map((a) =>
          a.id === state.activeId
            ? {
                ...a,
                enabledContextKinds: a.enabledContextKinds.filter((k) => k !== sk),
                attachedContext: a.attachedContext.filter(
                  (item) => item.kind !== sk && item.sourceNodeId !== id,
                ),
                updatedAt: Date.now(),
              }
            : a,
        );
      }

      set({
        architectures,
        nodes,
        edges,
        selectedNodeId: state.selectedNodeId === id ? null : state.selectedNodeId,
        dirty: true,
        lastTalkMutation: {
          summary: `Removed “${target.data.label}” and its edges.`,
          applied: true,
        },
      });
      return true;
    },

    deleteSelectedNode: () => {
      const id = get().selectedNodeId;
      if (!id) return false;
      return get().deleteNode(id);
    },

    onReconnect: (oldEdge, newConnection) => {
      set({
        edges: reconnectEdge(oldEdge, newConnection, get().edges),
        dirty: true,
      });
    },

    setTalkDraft: (value) => set({ talkDraft: value }),

    resetRunState: () =>
      set({
        dirty: true,
        nodes: clearRunFields(get().nodes),
      }),

    selectArchitecture: (id) => {
      const state = get();
      if (id === state.activeId) return;
      const flushed = persist(get);
      const next = flushed.find((a) => a.id === id);
      if (!next) return;
      const canvas = loadArchOntoCanvas(next);
      set({
        architectures: flushed,
        activeId: next.id,
        ...canvas,
        dirty: false,
        lastTalkMutation: null,
        layoutEpoch: state.layoutEpoch + 1,
      });
      saveLibrary({ schemaVersion: 3, activeId: next.id, items: flushed });
    },

    cycleArchitecture: (dir) => {
      const { architectures, activeId } = get();
      if (architectures.length < 2) return;
      const idx = architectures.findIndex((a) => a.id === activeId);
      const next = architectures[(idx + dir + architectures.length) % architectures.length];
      get().selectArchitecture(next.id);
    },

    renameArchitecture: (name) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const { activeId, architectures } = get();
      const next = architectures.map((a) =>
        a.id === activeId ? { ...a, name: trimmed, updatedAt: Date.now() } : a,
      );
      set({ architectures: next, dirty: true });
    },

    setArchitecturePrompt: (prompt) => {
      const { activeId, architectures } = get();
      const next = architectures.map((a) =>
        a.id === activeId ? { ...a, prompt, updatedAt: Date.now() } : a,
      );
      set({ architectures: next, dirty: true });
    },

    setArchitectureMeta: (patch) => {
      const { activeId, architectures } = get();
      const next = architectures.map((a) =>
        a.id === activeId ? { ...a, ...patch, updatedAt: Date.now() } : a,
      );
      set({ architectures: next, dirty: true });
    },

    setPromptOpen: (open) => set({ promptOpen: open }),
    setConnectionsOpen: (open) => set({ connectionsOpen: open }),
    setRunsOpen: (open) => set({ runsOpen: open }),
    setContextPrefsOpen: (open) => set({ contextPrefsOpen: open }),
    toggleCatalogKind: (kind) => {
      const next = toggleKindInCatalog(get().contextCatalog, kind);
      saveContextCatalog(next);
      set({ contextCatalog: next });
    },
    setContextIntakeActive: (open) => set({ contextIntakeActive: open }),

    beginContextPass: (kinds) => {
      const unique = [...new Set(kinds)];
      if (!unique.length) return;

      const state = get();

      let nodes = state.nodes.filter((n) => n.data.kind !== "context-source");
      let edges = state.edges.filter((e) => {
        const source = state.nodes.find((n) => n.id === e.source);
        const target = state.nodes.find((n) => n.id === e.target);
        if (source?.data.kind === "context-source") return false;
        if (target?.data.kind === "context-source") return false;
        return true;
      });

      let contextNode = nodes.find((n) => n.id === "context" || n.data.kind === "context");
      if (!contextNode) {
        contextNode = {
          id: "context",
          type: "context",
          position: { x: 0, y: 0 },
          data: {
            kind: "context",
            label: "Context Hub",
            content: "",
            status: "idle",
          },
        };
        nodes = [contextNode, ...nodes];
      } else {
        nodes = nodes.map((n) =>
          n.id === contextNode!.id
            ? {
                ...n,
                type: "context",
                data: {
                  ...n.data,
                  kind: "context",
                  label:
                    !n.data.label || n.data.label === "Context"
                      ? "Context Hub"
                      : n.data.label,
                },
              }
            : n,
        );
        contextNode = nodes.find((n) => n.id === contextNode!.id)!;
      }

      const router =
        nodes.find((n) => n.data.kind === "router") ??
        nodes.find(
          (n) => n.id !== contextNode!.id && n.data.kind !== "context-source",
        );
      edges = edges.filter((e) => e.source !== contextNode!.id);
      if (router) {
        edges = [
          {
            id: `e-${contextNode.id}-${router.id}`,
            source: contextNode.id,
            target: router.id,
            type: "smoothstep",
          },
          ...edges,
        ];
      }

      const sourceNodes = unique.map((kind) => {
        const meta = CONTEXT_SOURCE_OPTIONS.find((o) => o.kind === kind);
        return {
          id: `context-source-${kind}`,
          type: "context-source" as const,
          position: { x: 0, y: 0 },
          data: {
            kind: "context-source" as const,
            label: meta?.label ?? kind,
            sourceKind: kind,
            role: meta?.hint,
            status: "idle" as const,
          },
        };
      });

      const sourceEdges = sourceNodes.map((node) => ({
        id: `e-${node.id}-${contextNode!.id}`,
        source: node.id,
        target: contextNode!.id,
        type: "smoothstep" as const,
      }));

      const laidOut = normalizeGraphLayout([...sourceNodes, ...nodes]);

      const kindSet = new Set(unique);
      const nextArch = state.architectures.map((a) =>
        a.id === state.activeId
          ? {
              ...a,
              enabledContextKinds: unique,
              attachedContext: a.attachedContext.filter((item) =>
                kindSet.has(item.kind),
              ),
              updatedAt: Date.now(),
            }
          : a,
      );

      set({
        architectures: nextArch,
        nodes: laidOut,
        edges: [...sourceEdges, ...edges],
        selectedNodeId: sourceNodes[0]?.id ?? contextNode.id,
        contextIntakeActive: true,
        dirty: true,
        layoutEpoch: state.layoutEpoch + 1,
        lastTalkMutation: {
          summary: `Created ${unique.length} upstream channel${unique.length === 1 ? "" : "s"} feeding Context Hub.`,
          applied: true,
        },
      });
    },

    toggleContextKind: (kind) => {
      const { activeId, architectures } = get();
      const next = architectures.map((a) => {
        if (a.id !== activeId) return a;
        const has = a.enabledContextKinds.includes(kind);
        return {
          ...a,
          enabledContextKinds: has
            ? a.enabledContextKinds.filter((k) => k !== kind)
            : [...a.enabledContextKinds, kind],
          updatedAt: Date.now(),
        };
      });
      set({ architectures: next, dirty: true });
    },

    attachContextItem: (item, sourceNodeId) => {
      const { activeId, architectures } = get();
      const next = architectures.map((a) => {
        if (a.id !== activeId) return a;
        if (a.attachedContext.some((c) => c.id === item.id)) return a;
        return {
          ...a,
          attachedContext: [
            ...a.attachedContext,
            { ...item, attachedAt: Date.now(), sourceNodeId },
          ],
          updatedAt: Date.now(),
        };
      });
      set({
        architectures: next,
        dirty: true,
        lastTalkMutation: {
          summary: `Attached “${item.title}” → Context Hub.`,
          applied: true,
        },
      });
    },

    removeAttachedContext: (id) => {
      const { activeId, architectures } = get();
      const next = architectures.map((a) =>
        a.id === activeId
          ? {
              ...a,
              attachedContext: a.attachedContext.filter((c) => c.id !== id),
              updatedAt: Date.now(),
            }
          : a,
      );
      set({ architectures: next, dirty: true });
    },

    updateConnection: (id, patch) => {
      const { activeId, architectures } = get();
      const next = architectures.map((a) => {
        if (a.id !== activeId) return a;
        return {
          ...a,
          connections: a.connections.map((c) =>
            c.id === id
              ? {
                  ...c,
                  ...patch,
                  config: { ...c.config, ...(patch.config ?? {}) },
                  updatedAt: Date.now(),
                }
              : c,
          ),
          updatedAt: Date.now(),
        };
      });
      set({ architectures: next, dirty: true });
    },

    applyProviderProbes: (probes) => {
      const byId = new Map(probes.map((p) => [p.id, p]));
      const now = Date.now();
      const { activeId, architectures } = get();
      const next = architectures.map((a) => {
        if (a.id !== activeId) return a;
        return {
          ...a,
          connections: a.connections.map((c) => {
            if (c.kind !== "provider" || !c.config.providerId) return c;
            const probe = byId.get(c.config.providerId);
            if (!probe) return c;
            if (probe.ok) {
              return {
                ...c,
                enabled: true,
                lastCheckedAt: now,
                lastError: undefined,
                updatedAt: now,
              };
            }
            return {
              ...c,
              lastCheckedAt: undefined,
              lastError: probe.detail || "Verification failed",
              updatedAt: now,
            };
          }),
          updatedAt: now,
        };
      });
      set({
        architectures: next,
        dirty: true,
        lastTalkMutation: {
          summary: "Verified model provider keys against live APIs.",
          applied: true,
        },
      });
    },

    applyFeedProbes: (probes) => {
      const byId = new Map(probes.map((p) => [p.id, p]));
      const now = Date.now();
      const { activeId, architectures } = get();
      const next = architectures.map((a) => {
        if (a.id !== activeId) return a;
        return {
          ...a,
          connections: a.connections.map((c) => {
            const key = c.config.connectionKey;
            if (!key) return c;
            const probe = byId.get(key);
            if (!probe) return c;
            if (probe.ok) {
              return {
                ...c,
                enabled: true,
                lastCheckedAt: now,
                lastError: undefined,
                updatedAt: now,
              };
            }
            return {
              ...c,
              lastCheckedAt: undefined,
              lastError: probe.detail || "Verification failed",
              updatedAt: now,
            };
          }),
          updatedAt: now,
        };
      });
      set({
        architectures: next,
        dirty: true,
        lastTalkMutation: {
          summary: "Verified context feed connections.",
          applied: true,
        },
      });
    },

    selectRun: (id) => set({ selectedRunId: id }),

    recordRunStub: (notes) => {
      const state = get();
      const arch = activeArch(state);
      if (!arch) return;
      const stub = createRunStub({
        architectureId: arch.id,
        prompt: arch.prompt,
        pathwayLabel: arch.name,
      });
      const run: RunRecord = {
        ...stub,
        status: "idle",
        notes,
        nodeResults: state.nodes
          .filter((n) => n.data.kind === "agent" || n.data.kind === "merge")
          .map((n) => ({
            nodeId: n.id,
            label: n.data.label,
            model: n.data.model,
            status: n.data.status,
            output: n.data.output,
            metrics: n.data.metrics,
          })),
      };
      const architectures = state.architectures.map((a) =>
        a.id === state.activeId
          ? { ...a, runs: [run, ...a.runs], updatedAt: Date.now() }
          : a,
      );
      set({
        architectures,
        selectedRunId: run.id,
        runsOpen: true,
        dirty: true,
        lastTalkMutation: {
          summary: "Logged a run checkpoint (execution fills results in Block 3).",
          applied: true,
        },
      });
    },

    saveArchitecture: () => {
      const items = persist(get);
      set({ architectures: items, dirty: false });
    },

    saveArchitectureAs: (name) => {
      const trimmed = name.trim() || "Untitled architecture";
      const state = get();
      const current = activeArch(state);
      const copy = createDocumentFromGraph({
        name: trimmed,
        owner: state.user,
        prompt: current?.prompt ?? "",
        description: current?.description ?? "",
        tags: [...(current?.tags ?? [])],
        templateId: current?.templateId,
        nodes: state.nodes,
        edges: state.edges,
      });
      copy.enabledContextKinds = [...(current?.enabledContextKinds ?? [])];
      copy.attachedContext = [...(current?.attachedContext ?? [])];
      copy.connections = (current?.connections ?? copy.connections).map((c) => ({
        ...c,
        id: crypto.randomUUID(),
        updatedAt: Date.now(),
      }));
      copy.runs = [];
      const flushed = persist(get);
      const items = [...flushed, copy];
      set({
        architectures: items,
        activeId: copy.id,
        dirty: false,
        selectedRunId: null,
        lastTalkMutation: {
          summary: `Saved as “${trimmed}”.`,
          applied: true,
        },
      });
      saveLibrary({ schemaVersion: 3, activeId: copy.id, items });
    },

    createArchitecture: (name) => {
      const flushed = persist(get);
      const created = createStarterDocument(get().user);
      created.name = name?.trim() || `Architecture ${flushed.length + 1}`;
      const laid = normalizeGraphLayout(created.nodes);
      created.nodes = laid;
      const items = [...flushed, created];
      set({
        architectures: items,
        activeId: created.id,
        nodes: laid,
        edges: created.edges,
        selectedNodeId: null,
        selectedRunId: null,
        dirty: false,
        layoutEpoch: get().layoutEpoch + 1,
        lastTalkMutation: {
          summary: `Created “${created.name}”.`,
          applied: true,
        },
      });
      saveLibrary({ schemaVersion: 3, activeId: created.id, items });
    },

    createFromTemplate: (templateId) => {
      const template = getTemplate(templateId);
      const built = template.build();
      const flushed = persist(get);
      const created = createDocumentFromGraph({
        name: built.name,
        owner: get().user,
        prompt: built.prompt,
        description: built.description,
        tags: built.tags,
        templateId: built.templateId,
        nodes: built.nodes,
        edges: built.edges,
      });
      const laid = normalizeGraphLayout(created.nodes);
      created.nodes = laid;
      const items = [...flushed, created];
      set({
        architectures: items,
        activeId: created.id,
        nodes: laid,
        edges: created.edges,
        selectedNodeId: null,
        selectedRunId: null,
        dirty: false,
        layoutEpoch: get().layoutEpoch + 1,
        lastTalkMutation: {
          summary: `Started from template “${template.name}”.`,
          applied: true,
        },
      });
      saveLibrary({ schemaVersion: 3, activeId: created.id, items });
    },

    duplicateArchitecture: () => {
      const arch = activeArch(get());
      if (!arch) return;
      get().saveArchitectureAs(`${arch.name} copy`);
    },

    deleteArchitecture: () => {
      const state = get();
      if (state.architectures.length <= 1) {
        set({
          lastTalkMutation: {
            summary: "Keep at least one architecture.",
            applied: false,
          },
        });
        return;
      }
      const remaining = state.architectures.filter((a) => a.id !== state.activeId);
      const next = remaining[0];
      const canvas = loadArchOntoCanvas(next);
      set({
        architectures: remaining,
        activeId: next.id,
        ...canvas,
        dirty: false,
        layoutEpoch: state.layoutEpoch + 1,
        lastTalkMutation: {
          summary: `Deleted architecture. Now on “${next.name}”.`,
          applied: true,
        },
      });
      saveLibrary({ schemaVersion: 3, activeId: next.id, items: remaining });
    },

    exportActiveArchitecture: () => {
      const items = persist(get);
      set({ architectures: items, dirty: false });
      const active = items.find((a) => a.id === get().activeId);
      return active ? exportDocument(active) : "";
    },

    importArchitectureJson: (json) => {
      const doc = importDocument(json, get().user);
      if (!doc) {
        set({
          lastTalkMutation: {
            summary: "Import failed — JSON didn’t look like a Prism document.",
            applied: false,
          },
        });
        return;
      }
      const flushed = persist(get);
      const laid = normalizeGraphLayout(normalizeNodes(doc.nodes));
      doc.nodes = laid;
      const items = [...flushed, doc];
      set({
        architectures: items,
        activeId: doc.id,
        nodes: laid,
        edges: doc.edges,
        selectedNodeId: null,
        selectedRunId: doc.runs[0]?.id ?? null,
        dirty: false,
        layoutEpoch: get().layoutEpoch + 1,
        lastTalkMutation: {
          summary: `Imported “${doc.name}”.`,
          applied: true,
        },
      });
      saveLibrary({ schemaVersion: 3, activeId: doc.id, items });
    },

    loadStarterIntoActive: () => {
      const graph = cloneStarterGraph();
      set({
        nodes: graph.nodes,
        edges: graph.edges,
        selectedNodeId: null,
        dirty: true,
        layoutEpoch: get().layoutEpoch + 1,
        lastTalkMutation: {
          summary: "Reset active architecture to starter MoA shape.",
          applied: true,
        },
      });
    },

    applyTalkEdit: () => {
      const draft = get().talkDraft.trim();
      if (!draft) return;

      const lower = draft.toLowerCase();
      let summary = "Heard you — fuller NL mutations still coming.";
      let applied = false;
      const nodes = [...get().nodes];
      let edges = [...get().edges];

      if (lower.includes("cheaper") && lower.includes("research")) {
        const idx = nodes.findIndex((n) => n.id === "research");
        if (idx >= 0) {
          nodes[idx] = {
            ...nodes[idx],
            data: {
              ...nodes[idx].data,
              model: "openai:gpt-4o-mini",
            },
          };
          summary = "Set Researcher to openai:gpt-4o-mini.";
          applied = true;
        }
      } else if (
        lower.includes("summarizer") ||
        (lower.includes("add") && lower.includes("before") && lower.includes("judge"))
      ) {
        const exists = nodes.some((n) => n.id === "summarizer");
        if (!exists) {
          nodes.push({
            id: "summarizer",
            type: "agent",
            position: { x: 0, y: 0 },
            data: {
              kind: "agent",
              label: "Summarizer",
              role: "Compress branch outputs before judgment",
              steer: "Bullets only — preserve decisions, drop fluff.",
              prompt: "Summarize upstream specialist outputs into crisp bullets.",
              model: "openai:gpt-4o-mini",
              status: "idle",
            },
          });
          edges = edges
            .filter((e) => !(e.target === "judge" && e.source !== "summarizer"))
            .concat([
              {
                id: "e-research-summarizer",
                source: "research",
                target: "summarizer",
                type: "smoothstep",
              },
              {
                id: "e-draft-summarizer",
                source: "draft",
                target: "summarizer",
                type: "smoothstep",
              },
              {
                id: "e-critique-summarizer",
                source: "critique",
                target: "summarizer",
                type: "smoothstep",
              },
              {
                id: "e-summarizer-judge",
                source: "summarizer",
                target: "judge",
                type: "smoothstep",
              },
            ]);
          const laidOut = normalizeGraphLayout(nodes);
          nodes.splice(0, nodes.length, ...laidOut);
          summary = "Added Summarizer before Judge and rewired edges.";
          applied = true;
        } else {
          summary = "Summarizer already on the canvas.";
          applied = true;
        }
      } else if (lower.includes("critic") && lower.includes("after") && lower.includes("writer")) {
        summary = "Critic already sits after the Writer in the starter graph.";
        applied = true;
      } else if (lower.includes("template") && lower.includes("debate")) {
        get().createFromTemplate("debate");
        set({ talkDraft: "" });
        return;
      }

      set({
        nodes,
        edges,
        talkDraft: "",
        dirty: true,
        layoutEpoch:
          applied && lower.includes("summarizer")
            ? get().layoutEpoch + 1
            : get().layoutEpoch,
        lastTalkMutation: { summary, applied },
        selectedNodeId:
          applied && nodes.some((n) => n.id === "summarizer")
            ? "summarizer"
            : get().selectedNodeId,
      });
    },
  };
});

export { TEMPLATES };
