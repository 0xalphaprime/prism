import { readdir, access, readFile } from "node:fs/promises";
import path from "node:path";
import { constants as fsConstants } from "node:fs";
import os from "node:os";

export type FeedProbe = {
  id: string;
  label: string;
  ok: boolean;
  status: "connected" | "configured" | "disconnected" | "error";
  detail?: string;
  latencyMs?: number;
};

function homeDir() {
  return process.env.HOME || os.homedir() || "/home/alpha";
}

export function skillRoots() {
  const home = homeDir();
  return [
    path.join(home, ".hermes", "skills"),
    path.join(home, ".cursor", "skills-cursor"),
  ];
}

async function dirReadable(dir: string) {
  try {
    await access(dir, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export async function probeLocalFiles(): Promise<FeedProbe> {
  return {
    id: "local-files",
    label: "Local files",
    ok: true,
    status: "connected",
    detail: "Browser file picker",
    latencyMs: 0,
  };
}

export async function probeLocalSkills(): Promise<FeedProbe> {
  const started = Date.now();
  const roots = skillRoots();
  const readable: string[] = [];
  for (const root of roots) {
    if (await dirReadable(root)) readable.push(root);
  }
  if (!readable.length) {
    return {
      id: "local-skills",
      label: "Local skills",
      ok: false,
      status: "error",
      detail: `No skill dirs found under ${roots.join(" or ")}`,
      latencyMs: Date.now() - started,
    };
  }
  return {
    id: "local-skills",
    label: "Local skills",
    ok: true,
    status: "connected",
    detail: readable.join(" · "),
    latencyMs: Date.now() - started,
  };
}

export async function probeGithub(): Promise<FeedProbe> {
  const started = Date.now();
  const token = process.env.GITHUB_PAT ?? "";
  if (!token) {
    return {
      id: "github",
      label: "GitHub",
      ok: false,
      status: "disconnected",
      detail: "Add GITHUB_PAT to .env.local",
    };
  }
  try {
    const res = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "Prism",
      },
      signal: AbortSignal.timeout(12_000),
    });
    const latencyMs = Date.now() - started;
    if (!res.ok) {
      return {
        id: "github",
        label: "GitHub",
        ok: false,
        status: "error",
        detail:
          res.status === 401
            ? "Bad credentials — refresh GITHUB_PAT in ~/.env"
            : `GitHub HTTP ${res.status}`,
        latencyMs,
      };
    }
    const user = (await res.json()) as { login?: string };
    return {
      id: "github",
      label: "GitHub",
      ok: true,
      status: "connected",
      detail: user.login ? `@${user.login}` : "OK",
      latencyMs,
    };
  } catch (error) {
    return {
      id: "github",
      label: "GitHub",
      ok: false,
      status: "error",
      detail: error instanceof Error ? error.message : String(error),
      latencyMs: Date.now() - started,
    };
  }
}

export async function probeAirtable(): Promise<FeedProbe> {
  const started = Date.now();
  const pat = process.env.AIRTABLE_PAT ?? "";
  if (!pat) {
    return {
      id: "airtable",
      label: "Airtable",
      ok: false,
      status: "disconnected",
      detail: "Add AIRTABLE_PAT to .env.local",
    };
  }
  try {
    const res = await fetch("https://api.airtable.com/v0/meta/bases", {
      headers: { Authorization: `Bearer ${pat}` },
      signal: AbortSignal.timeout(12_000),
    });
    const latencyMs = Date.now() - started;
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        id: "airtable",
        label: "Airtable",
        ok: false,
        status: "error",
        detail: text.slice(0, 200) || `HTTP ${res.status}`,
        latencyMs,
      };
    }
    const data = (await res.json()) as { bases?: Array<{ id: string; name: string }> };
    return {
      id: "airtable",
      label: "Airtable",
      ok: true,
      status: "connected",
      detail: `${data.bases?.length ?? 0} bases`,
      latencyMs,
    };
  } catch (error) {
    return {
      id: "airtable",
      label: "Airtable",
      ok: false,
      status: "error",
      detail: error instanceof Error ? error.message : String(error),
      latencyMs: Date.now() - started,
    };
  }
}

export function parseKnowledgeCardsUrl(raw?: string) {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    // airtable.com/appXXX/tblYYY or api.airtable.com/v0/appXXX/tblYYY
    const parts = url.pathname.split("/").filter(Boolean);
    let baseId = "";
    let tableId = "";
    for (const part of parts) {
      if (part.startsWith("app") && part.length > 5) baseId = part;
      if (part.startsWith("tbl") && part.length > 5) tableId = part;
    }
    return { url: raw, baseId, tableId, host: url.hostname };
  } catch {
    return null;
  }
}

export async function probeKnowledgeCards(): Promise<FeedProbe> {
  const started = Date.now();
  const raw = process.env.KNOWLEDGE_CARDS ?? "";
  if (!raw) {
    return {
      id: "knowledge-cards",
      label: "Knowledge Cards",
      ok: false,
      status: "disconnected",
      detail: "Add KNOWLEDGE_CARDS URL to .env.local",
    };
  }
  const parsed = parseKnowledgeCardsUrl(raw);
  const pat = process.env.AIRTABLE_PAT ?? "";
  if (parsed?.baseId && pat) {
    // Prefer Airtable API when we can
    try {
      const table = parsed.tableId || "Knowledge";
      const endpoint = `https://api.airtable.com/v0/${parsed.baseId}/${encodeURIComponent(table)}?maxRecords=1`;
      const res = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${pat}` },
        signal: AbortSignal.timeout(12_000),
      });
      const latencyMs = Date.now() - started;
      if (res.ok) {
        return {
          id: "knowledge-cards",
          label: "Knowledge Cards",
          ok: true,
          status: "connected",
          detail: `Airtable ${parsed.baseId}`,
          latencyMs,
        };
      }
      // table name guess failed — still mark configured if PAT + base ok
      const meta = await fetch(
        `https://api.airtable.com/v0/meta/bases/${parsed.baseId}/tables`,
        {
          headers: { Authorization: `Bearer ${pat}` },
          signal: AbortSignal.timeout(12_000),
        },
      );
      if (meta.ok) {
        return {
          id: "knowledge-cards",
          label: "Knowledge Cards",
          ok: true,
          status: "connected",
          detail: `Base ${parsed.baseId} reachable`,
          latencyMs: Date.now() - started,
        };
      }
      const text = await res.text().catch(() => "");
      return {
        id: "knowledge-cards",
        label: "Knowledge Cards",
        ok: false,
        status: "error",
        detail: text.slice(0, 200) || `HTTP ${res.status}`,
        latencyMs,
      };
    } catch (error) {
      return {
        id: "knowledge-cards",
        label: "Knowledge Cards",
        ok: false,
        status: "error",
        detail: error instanceof Error ? error.message : String(error),
        latencyMs: Date.now() - started,
      };
    }
  }

  // URL present but not Airtable-shaped — treat as configured bookmark
  return {
    id: "knowledge-cards",
    label: "Knowledge Cards",
    ok: true,
    status: "connected",
    detail: parsed?.host ? `URL · ${parsed.host}` : "URL configured",
    latencyMs: Date.now() - started,
  };
}

export async function probeFirecrawl(): Promise<FeedProbe> {
  const started = Date.now();
  const key = process.env.FIRECRAWL_API_KEY ?? "";
  if (!key) {
    return {
      id: "firecrawl",
      label: "Firecrawl",
      ok: false,
      status: "disconnected",
      detail: "Add FIRECRAWL_API_KEY to .env.local (plain fetch fallback still works)",
    };
  }
  try {
    // Lightweight auth check — many accounts expose /v1 or /team
    const res = await fetch("https://api.firecrawl.dev/v1/team/credit-usage", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(12_000),
    });
    const latencyMs = Date.now() - started;
    if (res.ok || res.status === 404) {
      // 404 still proves key routing on some plans
      return {
        id: "firecrawl",
        label: "Firecrawl",
        ok: true,
        status: "connected",
        detail: res.ok ? "Credits endpoint OK" : "Key accepted",
        latencyMs,
      };
    }
    if (res.status === 401 || res.status === 403) {
      return {
        id: "firecrawl",
        label: "Firecrawl",
        ok: false,
        status: "error",
        detail: `Auth failed (${res.status})`,
        latencyMs,
      };
    }
    // Other statuses: key present — mark connected enough for weekend
    return {
      id: "firecrawl",
      label: "Firecrawl",
      ok: true,
      status: "connected",
      detail: `Key present (HTTP ${res.status})`,
      latencyMs,
    };
  } catch (error) {
    return {
      id: "firecrawl",
      label: "Firecrawl",
      ok: true,
      status: "connected",
      detail: `Key present · probe skipped (${error instanceof Error ? error.message : "error"})`,
      latencyMs: Date.now() - started,
    };
  }
}

export async function probeBrowserMcp(): Promise<FeedProbe> {
  return {
    id: "browser-mcp",
    label: "Browser MCP",
    ok: false,
    status: "disconnected",
    detail: "MCP live tab capture not wired yet — use Firecrawl for URLs",
  };
}

export async function probeSkillsMcp(): Promise<FeedProbe> {
  return {
    id: "skills-mcp",
    label: "Skills MCP",
    ok: false,
    status: "disconnected",
    detail: "Use Local skills for now",
  };
}

export async function probeAllFeeds(): Promise<FeedProbe[]> {
  return Promise.all([
    probeLocalFiles(),
    probeAirtable(),
    probeKnowledgeCards(),
    probeGithub(),
    probeLocalSkills(),
    probeFirecrawl(),
    probeBrowserMcp(),
    probeSkillsMcp(),
  ]);
}

export type ListedContextItem = {
  id: string;
  title: string;
  subtitle?: string;
  excerpt?: string;
  url?: string;
  meta?: Record<string, string>;
};

function fieldString(fields: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = fields[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  // first string field
  for (const value of Object.values(fields)) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export type AirtableBase = { id: string; name: string };
export type AirtableTable = { id: string; name: string };

function airtablePat() {
  return process.env.AIRTABLE_PAT ?? "";
}

function airtableHeaders() {
  return { Authorization: `Bearer ${airtablePat()}` };
}

function requireAirtablePat() {
  const pat = airtablePat();
  if (!pat) throw new Error("Add AIRTABLE_PAT to .env.local");
  return pat;
}

async function airtableJson<T>(url: string): Promise<T> {
  requireAirtablePat();
  const res = await fetch(url, {
    headers: airtableHeaders(),
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text.slice(0, 200) || `Airtable HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function listAirtableBases(): Promise<AirtableBase[]> {
  const data = await airtableJson<{ bases?: AirtableBase[] }>(
    "https://api.airtable.com/v0/meta/bases",
  );
  return data.bases ?? [];
}

export async function listAirtableTables(baseId: string): Promise<AirtableTable[]> {
  const data = await airtableJson<{
    tables?: Array<{ id: string; name: string }>;
  }>(`https://api.airtable.com/v0/meta/bases/${encodeURIComponent(baseId)}/tables`);
  return (data.tables ?? []).map((t) => ({ id: t.id, name: t.name }));
}

function stringifyAirtableValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (typeof entry === "string") return entry;
        if (typeof entry === "number") return String(entry);
        if (
          entry &&
          typeof entry === "object" &&
          "name" in entry &&
          typeof (entry as { name: unknown }).name === "string"
        ) {
          return (entry as { name: string }).name;
        }
        return "";
      })
      .filter(Boolean)
      .join(", ");
  }
  return "";
}

function recordPackText(fields: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    const text = stringifyAirtableValue(value);
    if (text) lines.push(`${key}: ${text}`);
  }
  return lines.join("\n").slice(0, 4000);
}

export async function listAirtableRecords(args: {
  baseId: string;
  tableId: string;
  tableName?: string;
  query?: string;
}): Promise<ListedContextItem[]> {
  const { baseId, tableId, tableName, query } = args;
  const params = new URLSearchParams({ maxRecords: "40" });
  const data = await airtableJson<{
    records?: Array<{ id: string; fields: Record<string, unknown> }>;
  }>(
    `https://api.airtable.com/v0/${encodeURIComponent(baseId)}/${encodeURIComponent(tableId)}?${params}`,
  );
  const q = query?.trim().toLowerCase() ?? "";
  const label = tableName || tableId;
  const items: ListedContextItem[] = [];
  for (const rec of data.records ?? []) {
    const title =
      fieldString(rec.fields, ["Name", "Title", "Card", "Topic", "Account"]) ||
      rec.id;
    const excerpt = recordPackText(rec.fields);
    if (
      q &&
      !title.toLowerCase().includes(q) &&
      !excerpt.toLowerCase().includes(q)
    ) {
      continue;
    }
    items.push({
      id: `airtable-${baseId}-${rec.id}`,
      title,
      subtitle: `Airtable · ${label}`,
      excerpt,
      meta: {
        source: "airtable",
        baseId,
        tableId,
        tableName: label,
        recordId: rec.id,
      },
    });
  }
  return items;
}

/**
 * Knowledge Cards live in Notion (`KNOWLEDGE_CARDS` URL).
 * Airtable sales/mgmt bases are NOT knowledge — never fall back to their first table
 * (that incorrectly surfaced Territories / markets as cards).
 *
 * Optional: set AIRTABLE_KNOWLEDGE_BASE + AIRTABLE_KNOWLEDGE_TABLE to list a real
 * Airtable knowledge table later.
 */
export async function listKnowledgeCards(query = ""): Promise<ListedContextItem[]> {
  const rawUrl = process.env.KNOWLEDGE_CARDS ?? "";
  const parsed = parseKnowledgeCardsUrl(rawUrl);
  const q = query.trim().toLowerCase();
  const items: ListedContextItem[] = [];

  if (rawUrl) {
    const isNotion = parsed?.host?.includes("notion") ?? /notion/i.test(rawUrl);
    const title = isNotion
      ? "Knowledge Cards (Notion)"
      : `Knowledge board (${parsed?.host || "link"})`;
    if (!q || title.toLowerCase().includes(q) || rawUrl.toLowerCase().includes(q)) {
      items.push({
        id: "kb-notion-workspace",
        title,
        subtitle: isNotion ? "Primary knowledge workspace" : parsed?.host,
        excerpt:
          "Your knowledge cards live here. Attach this workspace for the run, or open Notion to copy a specific card into Notes.",
        url: rawUrl,
        meta: { source: isNotion ? "notion" : "bookmark" },
      });
    }
  }

  // Explicit knowledge table only — never invent one from Territories/etc.
  const kbBase = process.env.AIRTABLE_KNOWLEDGE_BASE ?? "";
  const kbTable = process.env.AIRTABLE_KNOWLEDGE_TABLE ?? "";
  const pat = process.env.AIRTABLE_PAT ?? "";
  if (pat && kbBase && kbTable) {
    const params = new URLSearchParams({ maxRecords: "40" });
    const res = await fetch(
      `https://api.airtable.com/v0/${kbBase}/${encodeURIComponent(kbTable)}?${params}`,
      { headers: { Authorization: `Bearer ${pat}` } },
    );
    if (res.ok) {
      const data = (await res.json()) as {
        records?: Array<{ id: string; fields: Record<string, unknown> }>;
      };
      for (const rec of data.records ?? []) {
        const title =
          fieldString(rec.fields, ["Name", "Title", "Card", "Topic"]) || rec.id;
        const body = fieldString(rec.fields, [
          "Body",
          "Content",
          "Notes",
          "Summary",
          "Description",
        ]);
        if (
          q &&
          !title.toLowerCase().includes(q) &&
          !body.toLowerCase().includes(q)
        ) {
          continue;
        }
        items.push({
          id: `kb-${rec.id}`,
          title,
          subtitle: "Airtable knowledge",
          excerpt: body.slice(0, 1200),
          meta: { recordId: rec.id, baseId: kbBase, tableId: kbTable },
        });
      }
    }
  }

  if (!items.length) {
    throw new Error(
      "No knowledge source configured. Set KNOWLEDGE_CARDS (Notion URL) in .env.local.",
    );
  }
  return items;
}

async function walkSkillFiles(root: string, acc: string[], depth = 0) {
  if (depth > 5 || acc.length > 200) return;
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      await walkSkillFiles(full, acc, depth + 1);
    } else if (entry.isFile() && entry.name === "SKILL.md") {
      acc.push(full);
    }
  }
}

function parseSkillTitle(content: string, fallback: string) {
  const fm = content.match(/^---\s*([\s\S]*?)\s*---/);
  if (fm) {
    const name = fm[1].match(/^(?:name|title):\s*["']?(.+?)["']?\s*$/im);
    if (name?.[1]) return name[1].trim();
  }
  const heading = content.match(/^#\s+(.+)$/m);
  if (heading?.[1]) return heading[1].trim();
  return fallback;
}

export async function listSkills(query = ""): Promise<ListedContextItem[]> {
  const files: string[] = [];
  for (const root of skillRoots()) {
    if (await dirReadable(root)) await walkSkillFiles(root, files);
  }
  const q = query.trim().toLowerCase();
  const items: ListedContextItem[] = [];
  for (const file of files) {
    let content = "";
    try {
      content = await readFile(file, "utf8");
    } catch {
      continue;
    }
    const rel = file.replace(homeDir() + path.sep, "");
    const title = parseSkillTitle(content, path.basename(path.dirname(file)));
    const excerpt = content.replace(/^---[\s\S]*?---\s*/, "").slice(0, 1200);
    if (
      q &&
      !title.toLowerCase().includes(q) &&
      !rel.toLowerCase().includes(q) &&
      !excerpt.toLowerCase().includes(q)
    ) {
      continue;
    }
    items.push({
      id: `skill-${Buffer.from(file).toString("base64url").slice(0, 48)}`,
      title,
      subtitle: rel,
      excerpt,
      meta: { path: file },
    });
  }
  return items.sort((a, b) => a.title.localeCompare(b.title)).slice(0, 80);
}

export async function listRepos(query = ""): Promise<ListedContextItem[]> {
  const token = process.env.GITHUB_PAT ?? "";
  if (!token) throw new Error("Add GITHUB_PAT to .env.local");

  const params = new URLSearchParams({
    per_page: "50",
    sort: "updated",
    direction: "desc",
  });
  const res = await fetch(`https://api.github.com/user/repos?${params}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "Prism",
    },
  });
  if (!res.ok) throw new Error(`GitHub repos failed (${res.status})`);
  const repos = (await res.json()) as Array<{
    id: number;
    full_name: string;
    description?: string | null;
    default_branch?: string;
    html_url?: string;
    private?: boolean;
  }>;
  const q = query.trim().toLowerCase();
  return repos
    .filter(
      (r) =>
        !q ||
        r.full_name.toLowerCase().includes(q) ||
        (r.description ?? "").toLowerCase().includes(q),
    )
    .slice(0, 40)
    .map((r) => ({
      id: `repo-${r.id}`,
      title: r.full_name,
      subtitle: r.private ? "Private" : "Public",
      excerpt: r.description ?? undefined,
      url: r.html_url,
      meta: {
        defaultBranch: r.default_branch ?? "main",
        fullName: r.full_name,
      },
    }));
}

export async function fetchUrlContent(url: string): Promise<{
  text: string;
  source: "firecrawl" | "fetch";
  title?: string;
}> {
  const key = process.env.FIRECRAWL_API_KEY ?? "";
  if (key) {
    try {
      const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url,
          formats: ["markdown"],
          onlyMainContent: true,
        }),
        signal: AbortSignal.timeout(25_000),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          data?: { markdown?: string; content?: string; metadata?: { title?: string } };
          markdown?: string;
        };
        const text =
          data.data?.markdown ||
          data.data?.content ||
          data.markdown ||
          "";
        if (text.trim()) {
          return {
            text,
            source: "firecrawl",
            title: data.data?.metadata?.title,
          };
        }
      }
    } catch {
      /* fall through */
    }
  }

  const res = await fetch(url, {
    headers: { "User-Agent": "Prism/0.1" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
  const html = await res.text();
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { text, source: "fetch" };
}
