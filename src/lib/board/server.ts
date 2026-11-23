import { parseModelRef } from "@/lib/providers";
import {
  fetchUrlContent,
  listAirtableRecordsAcrossTables,
  listKnowledgeCards,
  listRepos,
  type ListedContextItem,
} from "@/lib/server/feed-connections";
import { chatCompletion } from "@/lib/server/providers";
import { OWN_SOURCE_NAMES, rankOwnItems, type OwnHit, type OwnSearchFn, type ReadFn, type SearchFn } from "./research";
import type { BoardChatFn, RunnerDeps } from "./session-runner";
import { OWN_SOURCES, type OwnSource, type SearchHit } from "./types";

/** The real model, search service and page reader behind the Board's steps. */

const FIRECRAWL_DEFAULT = "https://api.firecrawl.dev";

export function searchConfig() {
  const key = process.env.FIRECRAWL_API_KEY?.trim() ?? "";
  const base = (process.env.FIRECRAWL_BASE_URL?.trim() || FIRECRAWL_DEFAULT).replace(/\/+$/, "");
  return { key, base, ready: Boolean(key), standIn: base !== FIRECRAWL_DEFAULT };
}

export const NO_SEARCH_KEY =
  "No search key found. Add FIRECRAWL_API_KEY to .env.local, or continue without research.";

/** Firecrawl search: POST /v1/search with { query, limit } returns { data: [{ url, title, description }] }. */
export const firecrawlSearch: SearchFn = async (query, { limit }) => {
  const { key, base } = searchConfig();
  if (!key) throw new Error(NO_SEARCH_KEY);
  const res = await fetch(`${base}/v1/search`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, limit }),
    signal: AbortSignal.timeout(30_000),
  });
  const payload = (await res.json().catch(() => null)) as {
    success?: boolean;
    error?: string;
    data?: unknown;
  } | null;
  if (!res.ok || payload?.success === false) {
    throw new Error(`Search failed (${res.status})${payload?.error ? `: ${payload.error}` : ""}`);
  }
  // v1 returns a list; newer versions group results under `data.web`.
  const rows = Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray((payload?.data as { web?: unknown } | null)?.web)
      ? (payload?.data as { web: unknown[] }).web
      : [];
  const hits: SearchHit[] = [];
  for (const row of rows as Array<Record<string, unknown>>) {
    if (typeof row?.url !== "string" || !row.url) continue;
    hits.push({
      url: row.url,
      title: typeof row.title === "string" ? row.title : "",
      description: typeof row.description === "string" ? row.description : "",
    });
  }
  return hits;
};

export const readPage: ReadFn = async (url) => {
  const page = await fetchUrlContent(url);
  return { text: page.text, title: page.title, via: page.source };
};

export const boardChat: BoardChatFn = async ({ model, system, user, maxTokens, temperature }) => {
  const parsed = parseModelRef(model);
  if (!parsed) throw new Error(`Unknown model: ${model}`);
  try {
    const result = await chatCompletion({
      provider: parsed.provider,
      model: parsed.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature,
      max_tokens: maxTokens,
    });
    return { content: result.content, model: `${parsed.provider}:${result.model}` };
  } catch (error) {
    const err = error as Error & { status?: number; detail?: unknown };
    const detail = err.detail as { error?: { message?: unknown } | string } | null | undefined;
    const upstream =
      typeof detail?.error === "string"
        ? detail.error
        : typeof detail?.error?.message === "string"
          ? detail.error.message
          : "";
    throw new Error(
      [err.message || "The model could not be reached", err.status ? `(${err.status})` : "", upstream]
        .filter(Boolean)
        .join(" "),
    );
  }
};

/* ---------- The owner's own records ---------- */

function airtableBases() {
  return [process.env.AIRTABLE_BASE_SALES, process.env.AIRTABLE_BASE_MGMT]
    .map((id) => id?.trim() ?? "")
    .filter(Boolean);
}

/** Whether each own-record source can be searched, read off `.env.local`, with the reason when it cannot. */
export function ownSourceStatus(): Record<OwnSource, { ready: boolean; note: string }> {
  const pat = Boolean(process.env.AIRTABLE_PAT?.trim());
  const cards = pat && Boolean(process.env.AIRTABLE_KNOWLEDGE_BASE?.trim() && process.env.AIRTABLE_KNOWLEDGE_TABLE?.trim());
  return {
    knowledge: cards
      ? { ready: true, note: "Searches the knowledge table in Airtable." }
      : {
          ready: false,
          note: "Not connected. Only a link to the cards is set up, not their contents. Set AIRTABLE_PAT, AIRTABLE_KNOWLEDGE_BASE and AIRTABLE_KNOWLEDGE_TABLE in .env.local.",
        },
    airtable:
      pat && airtableBases().length
        ? { ready: true, note: "Searches the sales and management bases named in .env.local." }
        : { ready: false, note: "Not connected. Set AIRTABLE_PAT and AIRTABLE_BASE_SALES or AIRTABLE_BASE_MGMT in .env.local." },
    github: process.env.GITHUB_PAT?.trim()
      ? { ready: true, note: "Searches repository names and descriptions, not code." }
      : { ready: false, note: "Not connected. Set GITHUB_PAT in .env.local." },
  };
}

function itemText(item: ListedContextItem) {
  return [item.subtitle, item.excerpt, ...Object.entries(item.meta ?? {}).map(([k, v]) => `${k}: ${v}`)]
    .filter(Boolean)
    .join("\n");
}

function toHits(source: OwnSource, items: ListedContextItem[]): OwnHit[] {
  return items.map((item) => ({ source, title: item.title, url: item.url, text: itemText(item) }));
}

async function loadOwn(source: OwnSource): Promise<OwnHit[]> {
  if (source === "knowledge") {
    // The first entry is only a link to the workspace, not a card.
    return toHits(source, (await listKnowledgeCards("")).filter((item) => item.id !== "kb-notion-workspace"));
  }
  if (source === "airtable") {
    const hits: OwnHit[] = [];
    for (const baseId of airtableBases()) {
      hits.push(...toHits(source, (await listAirtableRecordsAcrossTables({ baseId })).items));
    }
    return hits;
  }
  return toHits(source, await listRepos(""));
}

const OWN_CACHE_MS = 5 * 60 * 1000;
const ownCache = new Map<OwnSource, { at: number; hits: OwnHit[] }>();

/**
 * Searches the owner's own records with the helpers the rest of Prism already
 * uses. Each source is listed once (kept for five minutes) and matched here
 * by keyword, so the query itself is not sent anywhere.
 */
export const ownSearch: OwnSearchFn = async (query, { sources, limit }) => {
  const status = ownSourceStatus();
  const problems: string[] = [];
  const ranked: OwnHit[][] = [];
  for (const source of OWN_SOURCES.filter((s) => sources.includes(s))) {
    if (!status[source].ready) {
      problems.push(`${OWN_SOURCE_NAMES[source]}: ${status[source].note}`);
      continue;
    }
    try {
      let cached = ownCache.get(source);
      if (!cached || Date.now() - cached.at > OWN_CACHE_MS) {
        cached = { at: Date.now(), hits: await loadOwn(source) };
        ownCache.set(source, cached);
      }
      ranked.push(rankOwnItems(cached.hits, query, limit));
    } catch (error) {
      problems.push(`${OWN_SOURCE_NAMES[source]}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  // Take turns between sources so one large source does not crowd out the others.
  const hits: OwnHit[] = [];
  for (let i = 0; hits.length < limit && ranked.some((list) => i < list.length); i += 1) {
    for (const list of ranked) {
      if (i < list.length && hits.length < limit) hits.push(list[i]);
    }
  }
  return { hits, problems };
};

export function liveDeps(): RunnerDeps {
  return { chat: boardChat, search: firecrawlSearch, read: readPage, own: ownSearch };
}
