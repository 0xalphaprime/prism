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
import { newId } from "@/lib/id";
import { layoutPrismFlow } from "@/lib/layout-flow";
import {
  defaultProviderPrefs,
  loadProviderPrefs,
  saveProviderPrefs,
  type ProviderPrefs,
} from "@/lib/provider-prefs";
import {
  deleteUserPreset,
  extractPresetData,
  findPreset,
  loadNodePresets,
  presetDataToNodeData,
  saveNodePresets,
  upsertUserPreset,
  type NodePreset,
  type PresetKind,
} from "@/lib/node-presets";
import {
  defaultModelForProvider,
  normalizeModelRef,
  remapModelToProvider,
  type ProviderId,
} from "@/lib/providers";
import { backfillIngestOnNodes, executeNodeStep } from "@/lib/run-engine";
import {
  isExecutableKind,
  nextSteppable,
  type RoutePlan,
} from "@/lib/run-graph";
import { createRunStub, assignResultSteps, nodeResultFromGraphNode, type RunRecord } from "@/lib/runs";
import { STARTER_EDGES, STARTER_NODES } from "@/lib/starter-graph";
import {
  CRITIC_MODEL,
  INFORMED_NODE_ID,
  JUDGE_MODEL,
  STUDENT_MODEL,
  STUDENT_NODE_ID,
  TEACHER_MODEL,
  ensureInformedStudentHop,
  studentTeachersNeedsInformedHop,
} from "@/lib/student-graph";
import {
  STUDENT_LAB_HUB,
  STUDENT_LAB_PROMPT,
  STUDENT_LAB_STEP_ORDER,
  type StudentLabSeed,
} from "@/lib/student-lab";
import { getTemplate, TEMPLATES } from "@/lib/templates";
import { buildLiveTrace, buildTrace, traceToJsonl } from "@/lib/trace";
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
  contextPrefsOpen: boolean;
  contextCatalog: ContextCatalog;
  providerPrefs: ProviderPrefs;
  nodePresets: NodePreset[];
  contextIntakeActive: boolean;
  layoutEpoch: number;
  /** Live execution — Block 3 */
  activeRunId: string | null;
  runBusy: boolean;
  activeRoutePlan: RoutePlan | null;
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
  stepRun: () => Promise<void>;
  runAll: () => Promise<void>;
  applyTalkEdit: () => void;
  selectArchitecture: (id: string) => void;
  cycleArchitecture: (dir: -1 | 1) => void;
  renameArchitecture: (name: string) => void;
  setArchitecturePrompt: (prompt: string) => void;
  setArchitectureMeta: (patch: Partial<Pick<PrismDocument, "description" | "tags">>) => void;
  setPromptOpen: (open: boolean) => void;
  setConnectionsOpen: (open: boolean) => void;
  setContextPrefsOpen: (open: boolean) => void;
  toggleCatalogKind: (kind: ContextSourceKind) => void;
  setDefaultProvider: (provider: ProviderId) => void;
  /** Remap LLM node models onto the default channel */
  applyDefaultProviderToGraph: () => void;
  saveNodeAsPreset: (nodeId: string, name: string) => boolean;
  addNodeFromPreset: (presetId: string) => string | null;
  deleteNodePreset: (presetId: string) => boolean;
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
  exportActiveTrace: () => string;
  exportActiveTraceJsonl: () => string;
  importArchitectureJson: (json: string) => void;
  loadStarterIntoActive: () => void;
  openStudentTeachers: () => void;
  applyLabSeed: (seed: StudentLabSeed) => void;
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
          nodes: nodes.length ? normalizeNodes(nodes) : arch.nodes,
          edges: nodes.length
            ? edges.map((e) => ({ ...e }))
            : arch.edges,
          updatedAt: Date.now(),
        }
      : arch,
  );
}

function repairEmptyArch(arch: PrismDocument): PrismDocument {
  if (arch.nodes.length > 0) return arch;
  const built = getTemplate(arch.templateId ?? "starter-moa").build();
  return {
    ...arch,
    nodes: normalizeGraphLayout(normalizeNodes(built.nodes)),
    edges: built.edges.map((e) => ({ ...e })),
    prompt: arch.prompt || built.prompt,
    description: arch.description || built.description,
    tags: arch.tags.length ? arch.tags : built.tags,
  };
}

function pinStudentLabModels(
  nodes: Node<PrismNodeData>[],
): Node<PrismNodeData>[] {
  return nodes.map((node) => {
    if (node.id === STUDENT_NODE_ID || node.id === INFORMED_NODE_ID) {
      return { ...node, data: { ...node.data, model: STUDENT_MODEL } };
    }
    if (node.id === "teacher") {
      return { ...node, data: { ...node.data, model: TEACHER_MODEL } };
    }
    if (node.id === "critique") {
      return { ...node, data: { ...node.data, model: CRITIC_MODEL } };
    }
    if (node.id === "judge") {
      return { ...node, data: { ...node.data, model: JUDGE_MODEL } };
    }
    return node;
  });
}

function studentLabModelsNeedPin(nodes: Node<PrismNodeData>[]) {
  return nodes.some(
    (n) =>
      (n.id === STUDENT_NODE_ID && n.data.model !== STUDENT_MODEL) ||
      (n.id === INFORMED_NODE_ID && n.data.model !== STUDENT_MODEL) ||
      (n.id === "teacher" && n.data.model !== TEACHER_MODEL) ||
      (n.id === "critique" && n.data.model !== CRITIC_MODEL) ||
      (n.id === "judge" && n.data.model !== JUDGE_MODEL),
  );
}

function repairStudentTeachersGraph(
  nodes: Node<PrismNodeData>[],
  edges: Edge[],
) {
  const ensured = ensureInformedStudentHop(nodes, edges);
  return {
    nodes: pinStudentLabModels(ensured.nodes),
    edges: ensured.edges,
  };
}

function applyStudentLabPrompts(arch: PrismDocument): PrismDocument {
  if (arch.templateId !== "student-teachers") return arch;
  const repaired = repairStudentTeachersGraph(arch.nodes, arch.edges);
  return {
    ...arch,
    prompt: STUDENT_LAB_PROMPT,
    nodes: repaired.nodes.map((node) =>
      node.id === "context"
        ? { ...node, data: { ...node.data, content: STUDENT_LAB_HUB } }
        : node,
    ),
    edges: repaired.edges,
  };
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

type StoreGet = () => GraphState;
type StoreSet = (
  partial:
    | Partial<GraphState>
    | ((state: GraphState) => Partial<GraphState>),
) => void;

function ensureActiveRun(get: StoreGet, set: StoreSet): string | null {
  const state = get();
  const arch = activeArch(state);
  if (!arch) return null;
  if (state.activeRunId) {
    const existing = arch.runs.find((r) => r.id === state.activeRunId);
    if (existing && existing.status === "running") return state.activeRunId;
  }

  const stub = createRunStub({
    architectureId: arch.id,
    prompt: arch.prompt,
    pathwayLabel: arch.name,
  });
  const run: RunRecord = {
    ...stub,
    status: "running",
    nodeResults: [],
  };
  const architectures = state.architectures.map((a) =>
    a.id === state.activeId
      ? { ...a, runs: [run, ...a.runs], updatedAt: Date.now() }
      : a,
  );
  set({
    architectures,
    activeRunId: run.id,
    selectedRunId: run.id,
    dirty: true,
  });
  return run.id;
}

function applyPatchesToNodes(
  nodes: Node<PrismNodeData>[],
  patches: Array<{ nodeId: string; patch: Partial<PrismNodeData> }>,
) {
  const byId = new Map(patches.map((p) => [p.nodeId, p.patch]));
  return nodes.map((n) => {
    const patch = byId.get(n.id);
    return patch ? { ...n, data: { ...n.data, ...patch } } : n;
  });
}

function syncRunFromNodes(
  get: StoreGet,
  set: StoreSet,
  runId: string,
  nodes: Node<PrismNodeData>[],
  status?: RunRecord["status"],
) {
  const state = get();
  const prior =
    state.architectures
      .find((a) => a.id === state.activeId)
      ?.runs.find((r) => r.id === runId)?.nodeResults ?? [];
  const results = assignResultSteps(
    prior,
    nodes
      .filter((n) => isExecutableKind(n.data.kind))
      .map((n) => nodeResultFromGraphNode(n)),
  );

  let totals: RunRecord["totals"];
  const withMetrics = results.filter((r) => r.metrics);
  if (withMetrics.length) {
    totals = {
      latencyMs: withMetrics.reduce(
        (s, r) => s + (r.metrics?.latencyMs ?? 0),
        0,
      ),
      tokensIn: withMetrics.reduce((s, r) => s + (r.metrics?.tokensIn ?? 0), 0),
      tokensOut: withMetrics.reduce(
        (s, r) => s + (r.metrics?.tokensOut ?? 0),
        0,
      ),
      costUsd: withMetrics.reduce((s, r) => s + (r.metrics?.costUsd ?? 0), 0),
    };
  }

  const architectures = state.architectures.map((a) =>
    a.id === state.activeId
      ? {
          ...a,
          runs: a.runs.map((r) =>
            r.id === runId
              ? {
                  ...r,
                  status: status ?? r.status,
                  nodeResults: results,
                  totals: totals ?? r.totals,
                  finishedAt:
                    status === "done" ||
                    status === "error" ||
                    status === "cancelled"
                      ? Date.now()
                      : r.finishedAt,
                }
              : r,
          ),
          updatedAt: Date.now(),
        }
      : a,
  );
  set({ architectures, dirty: true });
}

function finalizeActiveRun(get: StoreGet, set: StoreSet) {
  const state = get();
  if (!state.activeRunId) return;
  const hasError = state.nodes.some((n) => n.data.status === "error");
  const pending = nextSteppable(state.nodes, state.edges, null);
  const status: RunRecord["status"] = hasError
    ? "error"
    : pending
      ? "running"
      : "done";
  syncRunFromNodes(get, set, state.activeRunId, state.nodes, status);
  if (status === "done" || status === "error") {
    set({
      activeRunId: status === "done" ? null : state.activeRunId,
      lastTalkMutation: {
        summary: hasError
          ? "Run stopped on a node error."
          : "Run finished — read the Trace.",
        applied: true,
      },
    });
  }
}

/** @returns "ok" | "error" | null (nothing to step) */
async function runOneStep(
  get: StoreGet,
  set: StoreSet,
  opts?: { fromRunAll?: boolean },
): Promise<"ok" | "error" | null> {
  const state = get();
  if (!opts?.fromRunAll && state.runBusy) return null;

  const nodeId = nextSteppable(
    state.nodes,
    state.edges,
    state.selectedNodeId,
  );
  if (!nodeId) {
    if (!opts?.fromRunAll) {
      set({
        lastTalkMutation: {
          summary: "Nothing ready to step — reset run or finish upstream nodes.",
          applied: false,
        },
      });
    }
    return null;
  }

  const runId = ensureActiveRun(get, set);
  if (!runId) return null;

  if (!opts?.fromRunAll) set({ runBusy: true });

  try {
    set({
      dirty: true,
      nodes: get().nodes.map((n) =>
        n.id === nodeId
          ? { ...n, data: { ...n.data, status: "running" } }
          : n,
      ),
    });

    const live = get();
    const arch = activeArch(live);
    const result = await executeNodeStep({
      nodeId,
      nodes: live.nodes,
      edges: live.edges,
      attachedContext: arch?.attachedContext ?? [],
      architecturePrompt: arch?.prompt ?? "",
      activeRoutePlan: live.activeRoutePlan,
    });

    const patches = [
      { nodeId: result.nodeId, patch: result.patch },
      ...result.sidePatches,
    ];
    const nodes = applyPatchesToNodes(get().nodes, patches);
    set({
      nodes,
      dirty: true,
      activeRoutePlan:
        result.routePlan !== undefined
          ? result.routePlan
          : get().activeRoutePlan,
      lastTalkMutation: {
        summary: result.error
          ? `Step failed on ${nodeId}: ${result.error}`
          : `Stepped ${nodes.find((n) => n.id === nodeId)?.data.label ?? nodeId}.`,
        applied: !result.error,
      },
    });

    syncRunFromNodes(
      get,
      set,
      runId,
      get().nodes,
      result.error ? "error" : "running",
    );

    if (
      !opts?.fromRunAll &&
      !result.error &&
      !nextSteppable(get().nodes, get().edges, null)
    ) {
      finalizeActiveRun(get, set);
    }

    return result.error ? "error" : "ok";
  } finally {
    if (!opts?.fromRunAll) set({ runBusy: false });
  }
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
    contextPrefsOpen: false,
    contextCatalog: {
      enabledKinds: CONTEXT_SOURCE_OPTIONS.map((o) => o.kind),
    },
    providerPrefs: defaultProviderPrefs(),
    nodePresets: loadNodePresets(),
    contextIntakeActive: false,
    layoutEpoch: 0,
    activeRunId: null,
    runBusy: false,
    activeRoutePlan: null,

    hydrate: () => {
      if (get().hydrated) {
        const needsPatch = studentLabModelsNeedPin;
        const active = activeArch(get());
        const needsInformed =
          active?.templateId === "student-teachers" &&
          studentTeachersNeedsInformedHop(get().nodes, get().edges);
        if (
          !needsPatch(get().nodes) &&
          !needsInformed &&
          !get().architectures.some(
            (a) =>
              needsPatch(a.nodes) ||
              (a.templateId === "student-teachers" &&
                studentTeachersNeedsInformedHop(a.nodes, a.edges)),
          )
        ) {
          return;
        }
        const architectures = get().architectures.map((arch) => {
          if (arch.templateId !== "student-teachers") {
            return { ...arch, nodes: pinStudentLabModels(arch.nodes) };
          }
          const repaired = repairStudentTeachersGraph(arch.nodes, arch.edges);
          return { ...arch, nodes: repaired.nodes, edges: repaired.edges };
        });
        const repaired =
          active?.templateId === "student-teachers"
            ? repairStudentTeachersGraph(get().nodes, get().edges)
            : {
                nodes: pinStudentLabModels(get().nodes),
                edges: get().edges,
              };
        const nodes = needsInformed
          ? normalizeGraphLayout(repaired.nodes)
          : repaired.nodes;
        set({
          nodes,
          edges: repaired.edges,
          architectures,
          dirty: true,
          layoutEpoch: needsInformed ? get().layoutEpoch + 1 : get().layoutEpoch,
          lastTalkMutation: {
            summary: needsInformed
              ? "Added Nemo after Judge — full upstream ingest, not the distill row."
              : "Critic is GPT-5.6 Sol; Judge is Grok 4.6 (OpenRouter).",
            applied: true,
          },
        });
        saveLibrary({
          schemaVersion: 3,
          activeId: get().activeId,
          items: architectures.map((arch) =>
            arch.id === get().activeId
              ? { ...arch, nodes, edges: repaired.edges }
              : arch,
          ),
        });
        return;
      }
      const user = touchUser(loadUser());
      const contextCatalog = loadContextCatalog();
      const providerPrefs = loadProviderPrefs();
      const nodePresets = loadNodePresets();
      const library = loadLibrary(user);
      let items = library.items.map((arch) => ({
        ...arch,
        nodes: normalizeGraphLayout(normalizeNodes(arch.nodes)),
        owner: arch.owner ?? { id: user.id, name: user.name },
      }));

      items = items.map(repairEmptyArch).map(applyStudentLabPrompts);

      let current =
        items.find((a) => a.id === library.activeId) ?? items[0] ?? null;
      if (!items.some((a) => a.templateId === "student-teachers")) {
        const built = getTemplate("student-teachers").build();
        const created = createDocumentFromGraph({
          name: built.name,
          owner: user,
          prompt: built.prompt,
          description: built.description,
          tags: built.tags,
          templateId: built.templateId,
          nodes: built.nodes,
          edges: built.edges,
        });
        created.nodes = normalizeGraphLayout(normalizeNodes(created.nodes));
        items = [...items, created];
        current = created;
      }

      if (!current) return;
      current = repairEmptyArch(current);
      items = items.map((arch) => (arch.id === current.id ? current : arch));

      const canvas = loadArchOntoCanvas(current);
      items = items.map((arch) =>
        arch.id === current.id
          ? { ...arch, nodes: canvas.nodes, owner: { id: user.id, name: user.name } }
          : arch,
      );
      set({
        hydrated: true,
        user,
        contextCatalog,
        providerPrefs,
        nodePresets,
        architectures: items,
        activeId: current.id,
        ...canvas,
        dirty: false,
        layoutEpoch: get().layoutEpoch + 1,
        lastTalkMutation:
          current.templateId === "student-teachers"
            ? {
                summary:
                  "Opened Student vs teachers — Teacher is Opus 5. Step Hub, then Nemo, then teachers, then Judge, then Nemo after Judge.",
                applied: true,
              }
            : null,
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

      const id = `${kind}-${newId().slice(0, 8)}`;
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
          prompt:
            "Decide which specialist lanes should run. Activate only lanes that add real variety; skip redundant ones. Give each activated lane a short brief.",
          model: defaultModelForProvider(get().providerPrefs.defaultProvider),
          status: "idle",
          budget: {},
          sampling: { temperature: 0.2 },
          forward: { keepK: 3, stopOnConsensus: false, maxRounds: 1 },
          publish: { includeInSamples: true, redactOutput: false },
        },
        agent: {
          kind: "agent",
          label: "Agent",
          role: "",
          steer: "",
          prompt: "",
          model: defaultModelForProvider(get().providerPrefs.defaultProvider),
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
          model: remapModelToProvider(
            "openai:gpt-4o",
            get().providerPrefs.defaultProvider,
          ),
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

    resetRunState: () => {
      const state = get();
      let architectures = state.architectures;
      if (state.activeRunId) {
        architectures = architectures.map((a) =>
          a.id === state.activeId
            ? {
                ...a,
                runs: a.runs.map((r) =>
                  r.id === state.activeRunId && r.status === "running"
                    ? { ...r, status: "cancelled" as const, finishedAt: Date.now() }
                    : r,
                ),
                updatedAt: Date.now(),
              }
            : a,
        );
      }
      set({
        dirty: true,
        nodes: clearRunFields(state.nodes),
        architectures,
        activeRunId: null,
        runBusy: false,
        activeRoutePlan: null,
        lastTalkMutation: {
          summary: "Cleared node outputs and cancelled the active run.",
          applied: true,
        },
      });
    },

    stepRun: async () => {
      await runOneStep(get, set);
    },

    runAll: async () => {
      if (get().runBusy) return;
      set({ runBusy: true });
      try {
        // Cap iterations to avoid infinite loops on bad graphs
        for (let i = 0; i < 64; i++) {
          const stepped = await runOneStep(get, set, { fromRunAll: true });
          if (!stepped) break;
          if (stepped === "error") break;
        }
        finalizeActiveRun(get, set);
      } finally {
        set({ runBusy: false });
      }
    },

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
    setContextPrefsOpen: (open) => set({ contextPrefsOpen: open }),
    toggleCatalogKind: (kind) => {
      const next = toggleKindInCatalog(get().contextCatalog, kind);
      saveContextCatalog(next);
      set({ contextCatalog: next });
    },

    setDefaultProvider: (provider) => {
      const providerPrefs = { defaultProvider: provider };
      saveProviderPrefs(providerPrefs);
      set({
        providerPrefs,
        lastTalkMutation: {
          summary: `Default model channel → ${provider}. New tiles use this channel; Apply to remap the graph.`,
          applied: true,
        },
      });
    },

    applyDefaultProviderToGraph: () => {
      const provider = get().providerPrefs.defaultProvider;
      const nodes = get().nodes.map((n) => {
        if (
          n.data.kind !== "agent" &&
          n.data.kind !== "merge" &&
          n.data.kind !== "router"
        ) {
          return n;
        }
        return {
          ...n,
          data: {
            ...n.data,
            model: remapModelToProvider(n.data.model, provider),
          },
        };
      });
      set({
        nodes,
        dirty: true,
        lastTalkMutation: {
          summary: `Remapped Split / agent / Judge models onto ${provider}.`,
          applied: true,
        },
      });
    },

    saveNodeAsPreset: (nodeId, name) => {
      const node = get().nodes.find((n) => n.id === nodeId);
      if (!node) return false;
      const kind = node.data.kind;
      if (kind !== "agent" && kind !== "merge" && kind !== "router") {
        set({
          lastTalkMutation: {
            summary: "Only Split, agent, and Judge tiles can become presets.",
            applied: false,
          },
        });
        return false;
      }
      const trimmed = name.trim();
      if (!trimmed) {
        set({
          lastTalkMutation: {
            summary: "Name the preset before saving.",
            applied: false,
          },
        });
        return false;
      }
      const nodePresets = upsertUserPreset(get().nodePresets, {
        name: trimmed,
        kind: kind as PresetKind,
        data: extractPresetData(node.data),
      });
      saveNodePresets(nodePresets);
      set({
        nodePresets,
        lastTalkMutation: {
          summary: `Saved preset “${trimmed}” — place it from Add tile → Presets.`,
          applied: true,
        },
      });
      return true;
    },

    addNodeFromPreset: (presetId) => {
      const state = get();
      const preset = findPreset(state.nodePresets, presetId);
      if (!preset) {
        set({
          lastTalkMutation: {
            summary: "Preset not found.",
            applied: false,
          },
        });
        return null;
      }

      const selected = state.nodes.find((n) => n.id === state.selectedNodeId);
      const anchor = selected?.position ?? {
        x: 400,
        y: Math.max(0, ...state.nodes.map((n) => n.position.y)) + 160,
      };
      const position = {
        x: Math.round(anchor.x + (selected ? 40 : 0)),
        y: Math.round(anchor.y + (selected ? 140 : 0)),
      };

      const provider = state.providerPrefs.defaultProvider;
      const data = presetDataToNodeData(preset.kind, preset.data);
      if (data.model) {
        data.model = remapModelToProvider(data.model, provider);
      } else {
        data.model = defaultModelForProvider(provider);
      }

      const id = `${preset.kind}-${newId().slice(0, 8)}`;
      const node: Node<PrismNodeData> = {
        id,
        type: preset.kind,
        position,
        data,
      };

      set({
        nodes: [...state.nodes, node],
        selectedNodeId: id,
        dirty: true,
        lastTalkMutation: {
          summary: `Placed preset “${preset.name}”. Drag handles to wire it in.`,
          applied: true,
        },
      });
      return id;
    },

    deleteNodePreset: (presetId) => {
      const next = deleteUserPreset(get().nodePresets, presetId);
      if (!next) {
        set({
          lastTalkMutation: {
            summary: "Built-in presets can’t be deleted.",
            applied: false,
          },
        });
        return false;
      }
      saveNodePresets(next);
      set({
        nodePresets: next,
        lastTalkMutation: {
          summary: "Removed user preset.",
          applied: true,
        },
      });
      return true;
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
          .filter((n) => isExecutableKind(n.data.kind))
          .map((n, index) => nodeResultFromGraphNode(n, index)),
      };
      const architectures = state.architectures.map((a) =>
        a.id === state.activeId
          ? { ...a, runs: [run, ...a.runs], updatedAt: Date.now() }
          : a,
      );
      set({
        architectures,
        selectedRunId: run.id,
        dirty: true,
        lastTalkMutation: {
          summary: "Logged a run checkpoint.",
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
        id: newId(),
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

    exportActiveTrace: () => {
      const state = get();
      const arch = activeArch(state);
      if (!arch) return "";
      const run =
        arch.runs.find((r) => r.id === state.selectedRunId) ?? arch.runs[0];
      const live = !run || run.id === state.activeRunId;
      const trace = live
        ? buildLiveTrace(arch, run ?? null, state.nodes, state.edges)
        : buildTrace(arch, run);
      return JSON.stringify(trace, null, 2);
    },

    exportActiveTraceJsonl: () => {
      const raw = get().exportActiveTrace();
      if (!raw) return "";
      try {
        return traceToJsonl(JSON.parse(raw));
      } catch {
        return "";
      }
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

    openStudentTeachers: () => {
      const user = get().user;
      let items = (get().hydrated ? flushActive(get) : get().architectures).map(
        repairEmptyArch,
      );
      let existing = items.find((a) => a.templateId === "student-teachers");
      if (!existing) {
        const built = getTemplate("student-teachers").build();
        existing = createDocumentFromGraph({
          name: built.name,
          owner: user,
          prompt: built.prompt,
          description: built.description,
          tags: built.tags,
          templateId: built.templateId,
          nodes: built.nodes,
          edges: built.edges,
        });
        {
          const repaired = repairStudentTeachersGraph(
            existing.nodes,
            existing.edges,
          );
          existing.nodes = normalizeGraphLayout(normalizeNodes(repaired.nodes));
          existing.edges = repaired.edges;
        }
        items = [...items, existing];
      } else {
        const base = repairEmptyArch(existing);
        const repaired = repairStudentTeachersGraph(base.nodes, base.edges);
        existing = { ...base, nodes: repaired.nodes, edges: repaired.edges };
        items = items.map((a) => (a.id === existing.id ? existing : a));
      }

      if (!existing) return;

      if (get().activeId === existing.id && get().nodes.length > 0) {
        const added = studentTeachersNeedsInformedHop(get().nodes, get().edges);
        const repaired = repairStudentTeachersGraph(get().nodes, get().edges);
        const nodes = added
          ? normalizeGraphLayout(repaired.nodes)
          : repaired.nodes;
        const nextItems = items.map((a) =>
          a.id === existing.id
            ? { ...a, nodes, edges: repaired.edges }
            : a,
        );
        set({
          nodes,
          edges: repaired.edges,
          architectures: nextItems,
          dirty: true,
          layoutEpoch: added ? get().layoutEpoch + 1 : get().layoutEpoch,
          lastTalkMutation: {
            summary: added
              ? "Added Nemo after Judge — full upstream ingest, not the distill row."
              : "Teacher is Claude Opus 5 (OpenRouter).",
            applied: true,
          },
        });
        saveLibrary({ schemaVersion: 3, activeId: existing.id, items: nextItems });
        return;
      }

      const canvas = loadArchOntoCanvas(existing);
      set({
        architectures: items,
        activeId: existing.id,
        ...canvas,
        dirty: false,
        layoutEpoch: get().layoutEpoch + 1,
        lastTalkMutation: {
          summary:
            "Opened Student vs teachers — Step Hub, then Nemo, then teachers, then Judge, then Nemo after Judge.",
          applied: true,
        },
      });
      saveLibrary({ schemaVersion: 3, activeId: existing.id, items });
    },

    applyLabSeed: (seed) => {
      if (!seed?.id || !Array.isArray(seed.nodes) || !seed.nodes.length) return;
      const items = flushActive(get);
      const existing = items.find((a) => a.templateId === "student-teachers");
      if (!existing) return;

      const runId = `lab-${seed.id}`;
      const prior = existing.runs.find((r) => r.id === runId);
      if (prior?.finishedAt === seed.finishedAt) return;

      const byId = new Map(seed.nodes.map((n) => [n.id, n]));
      const baseNodes =
        get().activeId === existing.id ? get().nodes : existing.nodes;
      const patched = pinStudentLabModels(baseNodes).map((node) => {
        const hit = byId.get(node.id);
        if (!hit) {
          return node.id === "context"
            ? { ...node, data: { ...node.data, content: seed.hubContent } }
            : node;
        }
        return {
          ...node,
          data: {
            ...node.data,
            content:
              node.id === "context" ? seed.hubContent : node.data.content,
            output: hit.output,
            status: hit.status,
            metrics: hit.metrics,
          },
        };
      });
      const nodes = backfillIngestOnNodes(
        patched,
        existing.edges,
        seed.prompt,
        existing.attachedContext ?? [],
      );

      const run: RunRecord = {
        id: runId,
        architectureId: existing.id,
        prompt: seed.prompt,
        status: seed.error ? "error" : "done",
        startedAt: seed.finishedAt,
        finishedAt: seed.finishedAt,
        pathwayLabel: "Student vs teachers",
        notes: seed.error
          ? `seed ${seed.id}: ${seed.error}`
          : `seed ${seed.id}`,
        nodeResults: seed.nodes.map((n, index) => {
          const graphNode = nodes.find((node) => node.id === n.id);
          const step = STUDENT_LAB_STEP_ORDER.indexOf(
            n.id as (typeof STUDENT_LAB_STEP_ORDER)[number],
          );
          const resolvedStep = step >= 0 ? step : index;
          if (graphNode) {
            return {
              ...nodeResultFromGraphNode(graphNode, resolvedStep),
              label: n.label,
              model: n.model ?? graphNode.data.model,
              status: n.status,
              output: n.output,
              metrics: n.metrics,
            };
          }
          return {
            nodeId: n.id,
            label: n.label,
            model: n.model,
            status: n.status,
            output: n.output,
            metrics: n.metrics,
            step: resolvedStep,
          };
        }),
      };

      const nextArch: PrismDocument = {
        ...existing,
        prompt: seed.prompt,
        nodes,
        runs: [run, ...existing.runs.filter((r) => r.id !== runId)],
        updatedAt: Date.now(),
      };
      const nextItems = items.map((a) =>
        a.id === nextArch.id ? nextArch : a,
      );

      set({
        architectures: nextItems,
        activeId: existing.id,
        nodes,
        edges: existing.edges.map((e) => ({ ...e })),
        selectedRunId: runId,
        dirty: true,
        layoutEpoch: get().layoutEpoch + 1,
        lastTalkMutation: {
          summary: seed.error
            ? `Lab run stopped: ${seed.error}`
            : "Loaded missing-fact #8 — open Nemo, Teacher, and Judge outputs.",
          applied: !seed.error,
        },
      });
      saveLibrary({
        schemaVersion: 3,
        activeId: existing.id,
        items: nextItems,
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
