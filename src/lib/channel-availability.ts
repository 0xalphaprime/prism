import {
  connectionStatus,
  type PrismConnection,
} from "./connections";
import type { ContextSourceKind } from "./context-sources";

/** Stable keys for non-provider connection presets (config.connectionKey). */
export type FeedConnectionKey =
  | "local-files"
  | "github"
  | "airtable"
  | "knowledge-cards"
  | "local-skills"
  | "firecrawl"
  | "browser-mcp"
  | "skills-mcp";

export type ChannelUsability = "available" | "needs_connection" | "stub";

export type ChannelAvailability = {
  kind: ContextSourceKind;
  usability: ChannelUsability;
  /** Matching connection keys that can unlock this channel */
  connectionKeys: FeedConnectionKey[];
  label: string;
};

/**
 * Which feed connections unlock each context channel.
 * Local-always channels use local-files.
 */
export const CHANNEL_CONNECTION_MAP: Record<
  ContextSourceKind,
  FeedConnectionKey[]
> = {
  documents: ["local-files"],
  directories: ["local-files"],
  images: ["local-files"],
  notes: ["local-files"],
  skills: ["local-skills", "skills-mcp"],
  repository: ["github"],
  knowledge: ["knowledge-cards", "airtable"],
  urls: ["firecrawl"],
  browser: ["firecrawl", "browser-mcp"],
  memory: [],
  apis: [],
};

export function connectionKeyOf(conn: PrismConnection): string | undefined {
  return conn.config.connectionKey || conn.config.providerId;
}

export function findConnectionsForKind(
  connections: PrismConnection[],
  kind: ContextSourceKind,
): PrismConnection[] {
  const keys = new Set(CHANNEL_CONNECTION_MAP[kind] ?? []);
  if (!keys.size) return [];
  return connections.filter((c) => {
    const key = connectionKeyOf(c);
    return key && keys.has(key as FeedConnectionKey);
  });
}

export function channelUsability(
  kind: ContextSourceKind,
  connections: PrismConnection[],
): ChannelUsability {
  const keys = CHANNEL_CONNECTION_MAP[kind] ?? [];
  if (!keys.length) return "stub";

  const matches = findConnectionsForKind(connections, kind);
  if (!matches.length) return "needs_connection";

  const anyConnected = matches.some(
    (c) => connectionStatus(c) === "connected",
  );
  if (anyConnected) return "available";

  // Local files / local skills usable when enabled (probe upgrades badge)
  if (keys.includes("local-files") || keys.includes("local-skills")) {
    const local = matches.find((c) => {
      const key = connectionKeyOf(c);
      return key === "local-files" || key === "local-skills";
    });
    if (local?.enabled) return "available";
  }

  // URL intake has plain-fetch fallback when Firecrawl is not verified yet
  if (kind === "urls" || kind === "browser") {
    const firecrawl = matches.find((c) => connectionKeyOf(c) === "firecrawl");
    if (firecrawl?.enabled) return "available";
  }

  return "needs_connection";
}

export function usabilityLabel(usability: ChannelUsability) {
  switch (usability) {
    case "available":
      return "Available";
    case "needs_connection":
      return "Needs connection";
    default:
      return "Coming soon";
  }
}
