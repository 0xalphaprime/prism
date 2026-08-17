/**
 * Prism Publish Package — portable unit for gallery / fork / public-good sharing.
 *
 * Separates:
 * - architecture (topology + variables)
 * - context *recipe* (slots) vs optional redacted samples
 * - sample runs (proof artifacts)
 * - listing metadata (attribution, license, methodology badges)
 *
 * Connections never carry secrets.
 */

import type { Edge, Node } from "@xyflow/react";
import type { ContextSourceKind } from "./context-sources";
import type { PrismDocument } from "./document";
import { newId } from "./id";
import type { ModelRef } from "./providers";
import type { RunRecord } from "./runs";
import type { NodeMetrics, PrismNodeData, RunStatus } from "./types";

export const PUBLISH_SCHEMA_VERSION = 1;
export const PUBLISH_FILE_KIND = "prism.publish" as const;

/** Methodology badges — align with RESEARCH.md / docs/GUIDE.md */
export type MethodologyBadge =
  | "moa"
  | "smoa"
  | "routemoa"
  | "fan-out-fan-in"
  | "debate"
  | "refine"
  | "custom";

export type PublishLicense =
  | "mit"
  | "apache-2.0"
  | "cc-by-4.0"
  | "cc0"
  | "proprietary"
  | "unset";

export type PublishVisibility = "public" | "unlisted" | "private";

/** Gallery card + attribution (not the graph itself) */
export type PublishListing = {
  slug: string;
  title: string;
  summary: string;
  tags: string[];
  methodology: MethodologyBadge[];
  license: PublishLicense;
  visibility: PublishVisibility;
  /** Stable author handle for attribution on forks */
  author: {
    id: string;
    name: string;
  };
  /** Parent package when this was forked */
  forkedFrom?: {
    packageId: string;
    architectureId: string;
    version: string;
    slug?: string;
  };
  createdAt: number;
  updatedAt: number;
};

/**
 * What a re-runner must fill — not the author’s private files.
 * Example: “needs 1 knowledge card + 1 PDF slot”.
 */
export type ContextSlot = {
  id: string;
  kind: ContextSourceKind;
  label: string;
  required: boolean;
  hint?: string;
  /** How many attachments this slot expects (default 1) */
  minCount?: number;
  maxCount?: number;
};

export type ContextRecipe = {
  enabledKinds: ContextSourceKind[];
  slots: ContextSlot[];
};

/** Optional sample attachment — payload may be redacted or truncated */
export type PublishContextSample = {
  slotId?: string;
  kind: ContextSourceKind;
  title: string;
  subtitle?: string;
  /** true when original text/bytes were stripped for publish */
  redacted: boolean;
  payload?: {
    text?: string;
    url?: string;
    mime?: string;
  };
};

/** Architecture body — graph + variables, no live connection secrets */
export type PublishArchitecture = {
  /** Origin document id (local) — remapped on import */
  id: string;
  name: string;
  description: string;
  /** Architecture-level run intent */
  prompt: string;
  tags: string[];
  templateId?: string;
  version: string;
  nodes: Node<PrismNodeData>[];
  edges: Edge[];
  /** Strip runtime status/output/metrics before publish when building */
  contextRecipe: ContextRecipe;
  /** Optional illustrative attachments (prefer recipe-only for privacy) */
  contextSamples?: PublishContextSample[];
  /** Provider ids required to re-run (e.g. openai, xai) — no keys */
  requiredProviders: string[];
};

export type PublishNodeResult = {
  nodeId: string;
  label: string;
  kind?: PrismNodeData["kind"];
  role?: string;
  steer?: string;
  model?: ModelRef | string;
  status: RunStatus;
  output?: string;
  metrics?: NodeMetrics;
};

/** One proof run bundled with the package (aim for 1–3) */
export type PublishSampleRun = {
  id: string;
  /** Run intent snapshot */
  prompt: string;
  status: RunStatus | "cancelled";
  startedAt: number;
  finishedAt?: number;
  pathwayLabel?: string;
  notes?: string;
  totals?: {
    latencyMs?: number;
    tokensIn?: number;
    tokensOut?: number;
    costUsd?: number;
  };
  nodeResults: PublishNodeResult[];
};

/** Top-level portable file / API payload */
export type PrismPublishPackage = {
  kind: typeof PUBLISH_FILE_KIND;
  schemaVersion: number;
  /** Stable id for this published revision */
  packageId: string;
  listing: PublishListing;
  architecture: PublishArchitecture;
  /** 1–3 curated sample runs */
  sampleRuns: PublishSampleRun[];
};

export type BuildPublishOptions = {
  slug: string;
  summary: string;
  version?: string;
  methodology?: MethodologyBadge[];
  license?: PublishLicense;
  visibility?: PublishVisibility;
  /** Run ids from the document to include (max 3). Empty → none. */
  sampleRunIds?: string[];
  /** Include truncated context payloads as samples (default false — recipe only) */
  includeContextSamples?: boolean;
  contextTextCap?: number;
  forkedFrom?: PublishListing["forkedFrom"];
};

const MAX_SAMPLE_RUNS = 3;

function providerIdsFromNodes(nodes: Node<PrismNodeData>[]): string[] {
  const set = new Set<string>();
  for (const n of nodes) {
    const model = n.data.model;
    if (!model) continue;
    const provider = String(model).split(":")[0];
    if (provider) set.add(provider);
  }
  return [...set].sort();
}

/** Derive context slots from enabled kinds + attached items (counts). */
export function buildContextRecipe(doc: PrismDocument): ContextRecipe {
  const kinds =
    doc.enabledContextKinds.length > 0
      ? doc.enabledContextKinds
      : [...new Set(doc.attachedContext.map((a) => a.kind))];

  const slots: ContextSlot[] = kinds.map((kind) => {
    const count = doc.attachedContext.filter((a) => a.kind === kind).length;
    return {
      id: `slot-${kind}`,
      kind,
      label: kind,
      required: count > 0,
      hint: count > 0 ? `Author used ${count} attachment(s)` : "Optional channel",
      minCount: count > 0 ? 1 : 0,
      maxCount: Math.max(count, 1),
    };
  });

  return { enabledKinds: kinds, slots };
}

function scrubNodeForPublish(node: Node<PrismNodeData>): Node<PrismNodeData> {
  const { output: _o, metrics: _m, ...rest } = node.data;
  return {
    ...node,
    data: {
      ...rest,
      status: "idle",
    },
  };
}

function toPublishSampleRun(
  run: RunRecord,
  nodes: Node<PrismNodeData>[],
): PublishSampleRun {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return {
    id: run.id,
    prompt: run.prompt,
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    pathwayLabel: run.pathwayLabel,
    notes: run.notes,
    totals: run.totals,
    nodeResults: run.nodeResults
      .filter((r) => {
        const node = byId.get(r.nodeId);
        return node?.data.publish?.includeInSamples !== false;
      })
      .map((r) => {
        const node = byId.get(r.nodeId);
        const redact = Boolean(node?.data.publish?.redactOutput);
        return {
          nodeId: r.nodeId,
          label: r.label,
          kind: node?.data.kind,
          role: node?.data.role,
          steer: node?.data.steer,
          model: r.model,
          status: r.status,
          output: redact ? undefined : r.output,
          metrics: r.metrics,
        };
      }),
  };
}

/**
 * Build a publish package from a local PrismDocument.
 * Does not mutate the document. Omits connections entirely (re-runner uses their own keys).
 */
export function buildPublishPackage(
  doc: PrismDocument,
  opts: BuildPublishOptions,
): PrismPublishPackage {
  const now = Date.now();
  const version = opts.version ?? "0.1.0";
  const runIds = opts.sampleRunIds ?? [];
  const selected = runIds
    .map((id) => doc.runs.find((r) => r.id === id))
    .filter((r): r is RunRecord => Boolean(r))
    .slice(0, MAX_SAMPLE_RUNS);

  const recipe = buildContextRecipe(doc);
  let contextSamples: PublishContextSample[] | undefined;
  if (opts.includeContextSamples && doc.attachedContext.length) {
    const cap = opts.contextTextCap ?? 2_000;
    contextSamples = doc.attachedContext.map((item) => {
      const text = item.payload?.text;
      const truncated =
        text && text.length > cap ? `${text.slice(0, cap)}\n\n…[redacted for publish]` : text;
      return {
        slotId: `slot-${item.kind}`,
        kind: item.kind,
        title: item.title,
        subtitle: item.subtitle,
        redacted: Boolean(text && text.length > cap),
        payload: item.payload
          ? {
              text: truncated,
              url: item.payload.url,
              mime: item.payload.mime,
            }
          : undefined,
      };
    });
  }

  return {
    kind: PUBLISH_FILE_KIND,
    schemaVersion: PUBLISH_SCHEMA_VERSION,
    packageId: newId(),
    listing: {
      slug: opts.slug,
      title: doc.name,
      summary: opts.summary,
      tags: doc.tags,
      methodology: opts.methodology ?? ["moa", "fan-out-fan-in"],
      license: opts.license ?? "mit",
      visibility: opts.visibility ?? "unlisted",
      author: {
        id: doc.owner.id,
        name: doc.owner.name,
      },
      forkedFrom: opts.forkedFrom,
      createdAt: now,
      updatedAt: now,
    },
    architecture: {
      id: doc.id,
      name: doc.name,
      description: doc.description,
      prompt: doc.prompt,
      tags: doc.tags,
      templateId: doc.templateId,
      version,
      nodes: doc.nodes.map(scrubNodeForPublish),
      edges: doc.edges.map((e) => ({ ...e })),
      contextRecipe: recipe,
      contextSamples,
      requiredProviders: providerIdsFromNodes(doc.nodes),
    },
    sampleRuns: selected.map((r) => toPublishSampleRun(r, doc.nodes)),
  };
}

export function serializePublishPackage(pkg: PrismPublishPackage): string {
  return `${JSON.stringify(pkg, null, 2)}\n`;
}

export function parsePublishPackage(raw: string): PrismPublishPackage | null {
  try {
    const parsed = JSON.parse(raw) as Partial<PrismPublishPackage>;
    if (parsed.kind !== PUBLISH_FILE_KIND) return null;
    if (parsed.schemaVersion !== PUBLISH_SCHEMA_VERSION) return null;
    if (!parsed.packageId || !parsed.listing || !parsed.architecture) return null;
    if (!Array.isArray(parsed.sampleRuns)) return null;
    if (parsed.sampleRuns.length > MAX_SAMPLE_RUNS) {
      parsed.sampleRuns = parsed.sampleRuns.slice(0, MAX_SAMPLE_RUNS);
    }
    return parsed as PrismPublishPackage;
  } catch {
    return null;
  }
}
