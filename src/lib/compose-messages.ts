import type { Node } from "@xyflow/react";
import type { UpstreamChunk, RoutePlan, RouteLane } from "@/lib/run-graph";
import type { JudgeCharacteristics, PrismNodeData } from "@/lib/types";
import { normalizeModelRef } from "@/lib/providers";

/** Mirrors server ChatMessage — kept client-safe (no server import). */
export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ComposeArgs = {
  architecturePrompt: string;
  node: Node<PrismNodeData>;
  upstream: UpstreamChunk[];
  /** For router: child agents to choose among */
  childAgents?: Array<{ id: string; label: string; role?: string }>;
};

export type ChatRequestBody = {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
};

const ROUTE_PLAN_SCHEMA = `{
  "lanes": [
    { "nodeId": "<child agent id>", "activate": true, "brief": "optional lane steer" }
  ],
  "rationale": "short why"
}`;

function formatUpstream(chunks: UpstreamChunk[]): string {
  if (!chunks.length) return "(no upstream text)";
  return chunks
    .map(
      (c) =>
        `### ${c.label} (${c.kind}${c.sourceNodeId.startsWith("__") ? "" : ` · ${c.sourceNodeId}`})\n${c.text}`,
    )
    .join("\n\n");
}

function systemFor(node: PrismNodeData): string {
  const parts = [
    "You are a node in Prism, a mixture-of-agents lab.",
    node.role?.trim() ? `Role: ${node.role.trim()}` : null,
    node.steer?.trim() ? `Steer: ${node.steer.trim()}` : null,
  ].filter(Boolean);
  return parts.join("\n");
}

function userForAgentOrMerge(args: ComposeArgs): string {
  const { architecturePrompt, node, upstream } = args;
  const sections = [
    "## Architecture run intent",
    architecturePrompt.trim() || "(none)",
    "",
    "## Upstream",
    formatUpstream(upstream),
    "",
    "## Task",
    node.data.prompt?.trim() || "(no node prompt — produce your best output for this role)",
  ];

  if (node.data.outputSchema?.trim()) {
    sections.push(
      "",
      "## Output schema (aim for this shape)",
      node.data.outputSchema.trim(),
    );
  }

  return sections.join("\n");
}

const CHARACTERISTICS_TRAILER = `## Characteristics JSON (in addition to your prose)

End with a fenced json block. Do not replace the written card. Empty arrays are fine.

\`\`\`json
{"keep":["..."],"omit":["..."],"neverSay":["..."]}
\`\`\`

keep = what to preserve. omit = what not to distill. neverSay = forbidden phrases / leaks.`;

function userForRouter(args: ComposeArgs): string {
  const { architecturePrompt, node, upstream, childAgents = [] } = args;
  const roster =
    childAgents.length === 0
      ? "(no child agents — return empty lanes)"
      : childAgents
          .map(
            (c) =>
              `- id: ${c.id}\n  label: ${c.label}\n  role: ${c.role?.trim() || "(none)"}`,
          )
          .join("\n");

  const defaultPrompt =
    node.data.prompt?.trim() ||
    "Decide which specialist lanes should run for this problem. Activate only lanes that add real variety; skip redundant ones. Give each activated lane a short brief.";

  return [
    "## Architecture run intent",
    architecturePrompt.trim() || "(none)",
    "",
    "## Upstream",
    formatUpstream(upstream),
    "",
    "## Child agents (choose among these ids)",
    roster,
    "",
    "## Router task",
    defaultPrompt,
    "",
    "## Required response",
    "Reply with JSON only (optional markdown fence), matching:",
    ROUTE_PLAN_SCHEMA,
    "Use exact child nodeId values. activate:true means that agent should run.",
  ].join("\n");
}

/** Build chat messages for an LLM node. */
export function composeMessages(args: ComposeArgs): ChatMessage[] {
  const kind = args.node.data.kind;
  const system = systemFor(args.node.data);
  let user =
    kind === "router" ? userForRouter(args) : userForAgentOrMerge(args);
  if (kind === "merge") {
    user = `${user}\n\n${CHARACTERISTICS_TRAILER}`;
  }
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/** Map node Controls into /api/chat body fields. */
export function chatBodyForNode(
  node: Node<PrismNodeData>,
  messages: ChatMessage[],
): ChatRequestBody {
  const model =
    normalizeModelRef(node.data.model) ||
    (node.data.kind === "router"
      ? "openai:gpt-4o-mini"
      : "openai:gpt-4o-mini");

  const temperature =
    node.data.sampling?.temperature ??
    (node.data.kind === "router"
      ? 0.2
      : node.data.kind === "merge"
        ? 0.3
        : 0.7);

  const max_tokens = node.data.budget?.maxTokensOut;

  return {
    model,
    messages,
    temperature,
    ...(max_tokens != null ? { max_tokens } : {}),
  };
}

/** Lenient parse of Split route-plan JSON from model text. */
export function parseRoutePlan(
  raw: string,
  validIds: string[],
): RoutePlan | null {
  const allowed = new Set(validIds);
  const jsonText = extractJsonObject(raw);
  if (!jsonText) return null;

  try {
    const parsed = JSON.parse(jsonText) as {
      lanes?: unknown;
      rationale?: unknown;
    };
    if (!Array.isArray(parsed.lanes)) return null;

    const lanes: RouteLane[] = [];
    for (const item of parsed.lanes) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const nodeId = String(row.nodeId ?? row.id ?? "").trim();
      if (!nodeId || !allowed.has(nodeId)) continue;
      lanes.push({
        nodeId,
        activate: Boolean(row.activate ?? row.active ?? true),
        brief:
          typeof row.brief === "string"
            ? row.brief
            : typeof row.steer === "string"
              ? row.steer
              : undefined,
      });
    }

    if (!lanes.length) return null;
    return {
      lanes,
      rationale:
        typeof parsed.rationale === "string" ? parsed.rationale : undefined,
    };
  } catch {
    return null;
  }
}

export function extractJsonObject(raw: string): string | null {
  const trimmed = raw.trim();
  const fences = [...trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
  const fromFence = fences.length
    ? fences[fences.length - 1][1]?.trim()
    : undefined;
  const candidate = (fromFence ?? trimmed).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  return candidate.slice(start, end + 1);
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? item.trim() : String(item).trim()))
      .filter((item) => item && item !== "...");
  }
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

/** Lenient parse of Judge keep / omit / never-say JSON. */
export function parseCharacteristics(raw: string): JudgeCharacteristics | null {
  const jsonText = extractJsonObject(raw);
  if (!jsonText) return null;
  try {
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;
    const keep = stringList(parsed.keep);
    const omit = stringList(parsed.omit);
    const neverSay = stringList(
      parsed.neverSay ?? parsed.never_say ?? parsed["never-say"],
    );
    if (!keep.length && !omit.length && !neverSay.length) return null;
    return { keep, omit, neverSay };
  } catch {
    return null;
  }
}

/** Rough $/1k token heuristic for metrics display — not billing-grade. */
export function estimateCostUsd(
  model: string,
  tokensIn: number,
  tokensOut: number,
): number {
  const m = model.toLowerCase();
  // very rough blended rates
  let inPerM = 0.15;
  let outPerM = 0.6;
  if (m.includes("gpt-4o") && !m.includes("mini")) {
    inPerM = 2.5;
    outPerM = 10;
  } else if (m.includes("claude") && m.includes("sonnet")) {
    inPerM = 3;
    outPerM = 15;
  } else if (m.includes("claude") && m.includes("haiku")) {
    inPerM = 0.8;
    outPerM = 4;
  }
  return (tokensIn * inPerM + tokensOut * outPerM) / 1_000_000;
}

export function usageFromChatPayload(usage: unknown): {
  tokensIn?: number;
  tokensOut?: number;
} {
  if (!usage || typeof usage !== "object") return {};
  const u = usage as Record<string, unknown>;
  // OpenAI-style
  if (typeof u.prompt_tokens === "number" || typeof u.completion_tokens === "number") {
    return {
      tokensIn: typeof u.prompt_tokens === "number" ? u.prompt_tokens : undefined,
      tokensOut:
        typeof u.completion_tokens === "number" ? u.completion_tokens : undefined,
    };
  }
  // Anthropic-style
  if (
    typeof u.input_tokens === "number" ||
    typeof u.output_tokens === "number"
  ) {
    return {
      tokensIn: typeof u.input_tokens === "number" ? u.input_tokens : undefined,
      tokensOut:
        typeof u.output_tokens === "number" ? u.output_tokens : undefined,
    };
  }
  return {};
}
