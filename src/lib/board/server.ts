import { parseModelRef } from "@/lib/providers";
import { fetchUrlContent } from "@/lib/server/feed-connections";
import { chatCompletion } from "@/lib/server/providers";
import type { ReadFn, SearchFn } from "./research";
import type { BoardChatFn, RunnerDeps } from "./session-runner";
import type { SearchHit } from "./types";

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

export function liveDeps(): RunnerDeps {
  return { chat: boardChat, search: firecrawlSearch, read: readPage };
}
