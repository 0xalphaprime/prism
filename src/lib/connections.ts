import type { ContextSourceKind } from "./context-sources";
import type { ProviderId } from "./providers";

/**
 * How Prism pulls upstream context / tools / model providers.
 * Status is derived (never user-picked). Model providers verify via /api/providers.
 */
export type ConnectionKind = "mcp" | "api" | "local" | "oauth" | "provider";

export type ConnectionStatus = "disconnected" | "configured" | "connected" | "error";

export type PrismConnection = {
  id: string;
  kind: ConnectionKind;
  label: string;
  /** Which context channels this connection can feed */
  feeds: ContextSourceKind[];
  /** User wants this feed available on the architecture */
  enabled: boolean;
  /**
   * Opaque config.
   * - provider: `providerId`
   * - feeds: `connectionKey` (airtable, github, firecrawl, …)
   * Secrets stay in server .env.local — never in this object.
   */
  config: Record<string, string>;
  updatedAt: number;
  /** System-owned probe results */
  lastCheckedAt?: number;
  lastError?: string;
};

export const CONNECTION_PRESETS: Omit<PrismConnection, "id" | "updatedAt">[] = [
  {
    kind: "provider",
    label: "OpenAI",
    feeds: ["apis", "knowledge"],
    enabled: true,
    config: {
      providerId: "openai",
      note: "Direct OpenAI API",
      envKey: "OPENAI_API_KEY",
    },
  },
  {
    kind: "provider",
    label: "xAI (Grok)",
    feeds: ["apis", "knowledge"],
    enabled: true,
    config: {
      providerId: "xai",
      note: "Grok endpoint",
      envKey: "XAI_API_KEY",
    },
  },
  {
    kind: "provider",
    label: "Anthropic",
    feeds: ["apis", "knowledge"],
    enabled: true,
    config: {
      providerId: "anthropic",
      note: "Messages API",
      envKey: "ANTHROPIC_CURSOR_API",
    },
  },
  {
    kind: "provider",
    label: "OpenRouter",
    feeds: ["apis", "skills", "knowledge"],
    enabled: true,
    config: {
      providerId: "openrouter",
      note: "Multi-model gateway",
      envKey: "OPEN_ROUTER_HERMES_API_KEY",
    },
  },
  {
    kind: "local",
    label: "Local files",
    feeds: ["documents", "directories", "images", "notes"],
    enabled: true,
    config: {
      connectionKey: "local-files",
      mode: "file-picker",
      note: "Browser file picker",
    },
  },
  {
    kind: "api",
    label: "Airtable",
    feeds: ["knowledge"],
    enabled: true,
    config: {
      connectionKey: "airtable",
      note: "Bases + records",
      envKey: "AIRTABLE_PAT",
    },
  },
  {
    kind: "api",
    label: "Knowledge Cards",
    feeds: ["knowledge"],
    enabled: true,
    config: {
      connectionKey: "knowledge-cards",
      note: "Notion / Airtable board",
      envKey: "KNOWLEDGE_CARDS",
    },
  },
  {
    kind: "api",
    label: "GitHub",
    feeds: ["repository"],
    enabled: true,
    config: {
      connectionKey: "github",
      provider: "github",
      note: "Repos for slash-pick",
      envKey: "GITHUB_PAT",
    },
  },
  {
    kind: "local",
    label: "Local skills",
    feeds: ["skills"],
    enabled: true,
    config: {
      connectionKey: "local-skills",
      note: "~/.hermes/skills · ~/.cursor/skills-cursor",
    },
  },
  {
    kind: "api",
    label: "Firecrawl",
    feeds: ["urls", "browser"],
    enabled: true,
    config: {
      connectionKey: "firecrawl",
      note: "URL page fetch",
      envKey: "FIRECRAWL_API_KEY",
    },
  },
  {
    kind: "mcp",
    label: "Browser MCP",
    feeds: ["browser", "urls"],
    enabled: false,
    config: {
      connectionKey: "browser-mcp",
      server: "cursor-ide-browser",
      note: "Not wired yet — use Firecrawl",
    },
  },
  {
    kind: "mcp",
    label: "Skills / playbooks MCP",
    feeds: ["skills"],
    enabled: false,
    config: {
      connectionKey: "skills-mcp",
      server: "skills",
      note: "Not wired yet — use Local skills",
    },
  },
];

export function seedConnections(): PrismConnection[] {
  return CONNECTION_PRESETS.map((preset) => ({
    ...preset,
    id: crypto.randomUUID(),
    updatedAt: Date.now(),
  }));
}

function presetMatchKey(preset: Omit<PrismConnection, "id" | "updatedAt">) {
  return preset.config.providerId || preset.config.connectionKey || preset.label;
}

function existingMatchKey(conn: PrismConnection) {
  return conn.config.providerId || conn.config.connectionKey || conn.label;
}

/** Ensure older architectures pick up new connection presets. */
export function mergeConnectionPresets(
  existing: PrismConnection[],
): PrismConnection[] {
  const byKey = new Map(existing.map((c) => [existingMatchKey(c), c] as const));
  const byLabel = new Map(existing.map((c) => [c.label, c]));

  // Legacy GitHub API label
  const legacyGithub = existing.find(
    (c) => c.label === "GitHub API" || c.config.provider === "github",
  );

  const merged: PrismConnection[] = [];
  for (const preset of CONNECTION_PRESETS) {
    const key = presetMatchKey(preset);
    let hit = byKey.get(key) || byLabel.get(preset.label);
    if (!hit && preset.config.connectionKey === "github" && legacyGithub) {
      hit = legacyGithub;
    }
    if (hit) {
      merged.push({
        ...hit,
        kind: preset.kind,
        feeds: preset.feeds,
        label: preset.label,
        config: {
          ...hit.config,
          ...preset.config,
          connectionKey: preset.config.connectionKey ?? hit.config.connectionKey,
          providerId: preset.config.providerId ?? hit.config.providerId,
          envKey: preset.config.envKey ?? hit.config.envKey,
          note: preset.config.note ?? hit.config.note,
        },
        enabled: hit.enabled || preset.enabled,
      });
    } else {
      merged.push({
        ...preset,
        id: crypto.randomUUID(),
        updatedAt: Date.now(),
      });
    }
  }

  for (const conn of existing) {
    if (
      !merged.some(
        (m) =>
          m.id === conn.id ||
          existingMatchKey(m) === existingMatchKey(conn) ||
          m.label === conn.label,
      )
    ) {
      merged.push(conn);
    }
  }
  return merged;
}

function hasUsableConfig(conn: PrismConnection) {
  const { config, kind } = conn;
  if (kind === "local") return true;
  if (kind === "provider" && config.providerId) return true;
  if (config.connectionKey) return true;
  const signal =
    config.note?.trim() ||
    config.server?.trim() ||
    config.provider?.trim() ||
    config.endpoint?.trim() ||
    config.baseUrl?.trim();
  return Boolean(signal);
}

/** Observed state — UI must never offer this as a dropdown. */
export function connectionStatus(conn: PrismConnection): ConnectionStatus {
  if (!conn.enabled) return "disconnected";
  if (conn.lastError) return "error";
  if (conn.config.connectionKey === "local-files" && conn.enabled) {
    return "connected";
  }
  if (conn.lastCheckedAt) return "connected";
  if (hasUsableConfig(conn)) return "configured";
  return "disconnected";
}

export function connectionStatusLabel(status: ConnectionStatus) {
  switch (status) {
    case "connected":
      return "Connected";
    case "configured":
      return "Ready (not verified)";
    case "error":
      return "Error";
    default:
      return "Off";
  }
}

export function isProviderConnection(
  conn: PrismConnection,
): conn is PrismConnection & { config: { providerId: ProviderId } } {
  return conn.kind === "provider" && Boolean(conn.config.providerId);
}

/** Normalize legacy docs that stored a user-picked `status`. */
export function normalizeConnection(raw: Record<string, unknown>): PrismConnection | null {
  if (!raw || typeof raw.id !== "string" || typeof raw.label !== "string") return null;
  const legacyStatus = raw.status as ConnectionStatus | undefined;
  const enabled =
    typeof raw.enabled === "boolean"
      ? raw.enabled
      : legacyStatus === "connected" ||
        legacyStatus === "configured" ||
        legacyStatus === "error";

  const config =
    raw.config && typeof raw.config === "object"
      ? (raw.config as Record<string, string>)
      : {};

  let kind = (raw.kind as ConnectionKind) ?? "api";
  if (
    kind === "api" &&
    (config.provider === "openrouter" ||
      String(raw.label).toLowerCase().includes("openrouter")) &&
    !config.connectionKey
  ) {
    kind = "provider";
    config.providerId = config.providerId || "openrouter";
  }

  return {
    id: raw.id,
    kind,
    label: raw.label,
    feeds: Array.isArray(raw.feeds) ? (raw.feeds as ContextSourceKind[]) : [],
    enabled,
    config,
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : Date.now(),
    lastCheckedAt:
      typeof raw.lastCheckedAt === "number" ? raw.lastCheckedAt : undefined,
    lastError: typeof raw.lastError === "string" ? raw.lastError : undefined,
  };
}
