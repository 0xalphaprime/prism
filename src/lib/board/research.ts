import type {
  OverlapReport,
  PageRecord,
  PlannedQuery,
  QueryRecord,
  ResearchLimits,
  ResearchRecord,
  SearchHit,
} from "./types";

/**
 * The research desk is plumbing, not an agent. A member writes a list of
 * searches; this code runs them, reads pages, enforces the limits, and writes
 * down everything it did. One call serves one member, and nothing found for
 * one member is handed to another.
 */

export type SearchFn = (query: string, opts: { limit: number }) => Promise<SearchHit[]>;

export type ReadFn = (url: string) => Promise<{ text: string; title?: string; via: string }>;

export const DEFAULT_LIMITS: ResearchLimits = {
  searches: 4,
  pagesPerSearch: 2,
  pageChars: 6000,
};

export const MAX_LIMITS: ResearchLimits = {
  searches: 8,
  pagesPerSearch: 4,
  pageChars: 20_000,
};

function clampInt(raw: unknown, fallback: number, min: number, max: number) {
  const n = typeof raw === "number" && Number.isFinite(raw) ? Math.round(raw) : fallback;
  return Math.min(max, Math.max(min, n));
}

export function clampLimits(raw?: Partial<ResearchLimits> | null): ResearchLimits {
  return {
    searches: clampInt(raw?.searches, DEFAULT_LIMITS.searches, 0, MAX_LIMITS.searches),
    pagesPerSearch: clampInt(
      raw?.pagesPerSearch,
      DEFAULT_LIMITS.pagesPerSearch,
      1,
      MAX_LIMITS.pagesPerSearch,
    ),
    pageChars: clampInt(raw?.pageChars, DEFAULT_LIMITS.pageChars, 500, MAX_LIMITS.pageChars),
  };
}

/** True for http(s) addresses on the public web. Keeps page reads off this machine and its network. */
export function isPublicHttpUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || !host.includes(".")) return false;
  if (host === "localhost" || host.endsWith(".localhost")) return false;
  if (/\.(local|internal|lan|home|corp|test|invalid)$/.test(host)) return false;
  if (host.includes(":")) return false;
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
  }
  if (/^\d+$/.test(host) || /^0x[0-9a-f]+$/.test(host)) return false;
  return true;
}

const TRACKING_PARAM = /^(utm_[a-z]+|gclid|fbclid|mc_cid|mc_eid|ref|ref_src|igshid)$/i;

/** One spelling per page, so two members who pulled the same page are counted as overlapping. */
export function normalizeUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.hash = "";
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    if (url.protocol === "http:") url.protocol = "https:";
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAM.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.toString();
  } catch {
    return raw.trim();
  }
}

function cleanQuery(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .slice(0, 200)
    .trim();
}

/** Trims, drops blanks and repeats, and cuts the list to `max`. */
export function cleanQueries(raw: unknown, max: number): PlannedQuery[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: PlannedQuery[] = [];
  for (const item of raw) {
    const query = cleanQuery(
      typeof item === "string" ? item : (item as { query?: unknown } | null)?.query,
    );
    if (!query) continue;
    const key = query.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const why =
      item && typeof item === "object" && typeof (item as { why?: unknown }).why === "string"
        ? (item as { why: string }).why.replace(/\s+/g, " ").trim().slice(0, 300)
        : "";
    out.push({ query, why });
    if (out.length >= max) break;
  }
  return out;
}

function jsonCandidates(text: string): string[] {
  const out: string[] = [];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) out.push(fenced[1]);
  out.push(text);
  for (const [open, close] of [
    ["{", "}"],
    ["[", "]"],
  ] as const) {
    const start = text.indexOf(open);
    const end = text.lastIndexOf(close);
    if (start >= 0 && end > start) out.push(text.slice(start, end + 1));
  }
  return out;
}

/**
 * Reads a member's search plan out of a model reply. Accepts the asked-for
 * JSON, JSON inside a code fence or surrounded by prose, or a plain list.
 */
export function parsePlan(text: string, max: number): PlannedQuery[] {
  for (const candidate of jsonCandidates(text)) {
    try {
      const parsed = JSON.parse(candidate.trim()) as unknown;
      const list = Array.isArray(parsed)
        ? parsed
        : (parsed as { queries?: unknown } | null)?.queries;
      if (Array.isArray(list)) return cleanQueries(list, max);
    } catch {
      // try the next shape
    }
  }
  const lines = text
    .split("\n")
    .map((line) => line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/)?.[1] ?? "")
    .filter(Boolean);
  return cleanQueries(lines, max);
}

const COMMON_CAPITALISED = new Set(
  [
    "i",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
    "q1",
    "q2",
    "q3",
    "q4",
  ].map((w) => w.toLowerCase()),
);

/**
 * Names and figures in the material that would give the decision away if they
 * appeared in a search. A rough guess: capitalised words that are never written
 * in lower case, web and mail addresses, and figures of three digits or more.
 */
export function identifyingTerms(material: string): string[] {
  const terms = new Set<string>();
  const lowerWords = new Set(material.match(/\b[a-z][a-z0-9'-]+\b/g) ?? []);

  for (const m of material.matchAll(/\b[\w.+-]+@([\w-]+(?:\.[\w-]+)+)\b/g)) terms.add(m[1].toLowerCase());
  for (const m of material.matchAll(/\bhttps?:\/\/([\w-]+(?:\.[\w-]+)+)/gi)) {
    terms.add(m[1].toLowerCase().replace(/^www\./, ""));
  }

  for (const line of material.split("\n")) {
    // Headings are often written in title case; skip them rather than flag every word.
    if (/^\s*#/.test(line)) continue;
    const words = [...line.matchAll(/[A-Za-z][A-Za-z0-9&'-]*/g)];
    for (const [i, match] of words.entries()) {
      const word = match[0].replace(/'s$/, "");
      if (word.length < 3) continue;
      const lower = word.toLowerCase();
      if (COMMON_CAPITALISED.has(lower) || lowerWords.has(lower)) continue;
      const camel = /^[A-Z][a-z0-9]+[A-Z]/.test(word);
      const capitalised = /^[A-Z][a-z]/.test(word);
      if (!camel && !capitalised) continue;
      const before = line.slice(0, match.index ?? 0).trimEnd();
      const startsSentence = i === 0 || /[.!?:;]$/.test(before) || /^[#>*\-\d.)\s]*$/.test(before);
      if (camel || !startsSentence) terms.add(lower);
    }
  }

  for (const m of material.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const digits = m[0].replace(/[^\d]/g, "");
    if (digits.length < 3) continue;
    if (digits.length === 4 && /^(19|20)\d\d$/.test(digits) && !m[0].includes(",")) continue;
    terms.add(m[0].replace(/,/g, "").replace(/\.$/, ""));
  }
  return [...terms];
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Queries that repeat a name or figure from the material. */
export function flagQueries(
  queries: PlannedQuery[],
  material: string,
): Array<{ query: string; terms: string[] }> {
  const terms = identifyingTerms(material);
  const flagged: Array<{ query: string; terms: string[] }> = [];
  for (const { query } of queries) {
    const plain = query.toLowerCase().replace(/,/g, "");
    const found = terms.filter((term) =>
      new RegExp(`(^|[^a-z0-9])${escapeRegExp(term)}($|[^a-z0-9])`, "i").test(plain),
    );
    if (found.length) flagged.push({ query, terms: found });
  }
  return flagged;
}

function tidyText(text: string) {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Runs one member's searches and reads pages, inside the limits. Every search,
 * every result, and every page read (or skipped, and why) goes in the record.
 */
export async function runResearch(args: {
  queries: PlannedQuery[];
  limits: ResearchLimits;
  search: SearchFn;
  read: ReadFn;
  now?: () => number;
}): Promise<ResearchRecord> {
  const now = args.now ?? Date.now;
  const limits = args.limits;
  const startedAt = now();
  const seen = new Set<string>();
  const queries: QueryRecord[] = [];
  const pages: PageRecord[] = [];

  for (const planned of args.queries.slice(0, limits.searches)) {
    const record: QueryRecord = {
      query: planned.query,
      why: planned.why,
      startedAt: now(),
      finishedAt: 0,
      hits: [],
    };
    let hits: SearchHit[] = [];
    try {
      hits = await args.search(planned.query, { limit: limits.pagesPerSearch + 3 });
    } catch (error) {
      record.error = errorMessage(error);
    }

    const picks: Array<{ id: string; hit: SearchHit }> = [];
    for (const hit of hits) {
      const url = typeof hit.url === "string" ? hit.url.trim() : "";
      const entry: QueryRecord["hits"][number] = {
        url,
        title: (hit.title ?? "").trim(),
        description: (hit.description ?? "").trim().slice(0, 400),
        read: false,
      };
      const key = normalizeUrl(url);
      if (!isPublicHttpUrl(url)) entry.skipped = "Not a public web address";
      else if (seen.has(key)) entry.skipped = "Already read for an earlier search";
      else if (picks.length >= limits.pagesPerSearch) entry.skipped = "Over the page limit";
      else {
        seen.add(key);
        entry.read = true;
        picks.push({ id: `S${pages.length + picks.length + 1}`, hit: { ...entry } });
      }
      record.hits.push(entry);
    }

    const read = await Promise.all(
      picks.map(async ({ id, hit }): Promise<PageRecord> => {
        const base = {
          id,
          url: hit.url,
          title: hit.title,
          query: planned.query,
        };
        try {
          const page = await args.read(hit.url);
          const full = tidyText(page.text ?? "");
          if (!full) throw new Error("The page came back empty");
          const text = full.slice(0, limits.pageChars);
          return {
            ...base,
            title: hit.title || page.title || hit.url,
            via: page.via,
            fetchedAt: now(),
            chars: text.length,
            truncated: full.length > text.length,
            text,
          };
        } catch (error) {
          return {
            ...base,
            title: hit.title || hit.url,
            via: "",
            fetchedAt: now(),
            chars: 0,
            truncated: false,
            text: "",
            error: errorMessage(error),
          };
        }
      }),
    );
    pages.push(...read);
    record.finishedAt = now();
    queries.push(record);
  }

  return { limits, startedAt, finishedAt: now(), queries, pages };
}

/** Pages a member actually read (failed reads do not count). */
export function readPages(record: ResearchRecord | null | undefined): PageRecord[] {
  return (record?.pages ?? []).filter((p) => !p.error && p.text);
}

/** How much two or more members ended up reading the same sources. */
export function overlapReport(
  members: Array<{ slug: string; pages: Array<{ url: string; title: string }> }>,
): OverlapReport {
  const byUrl = new Map<string, { url: string; title: string; members: Set<string> }>();
  for (const member of members) {
    for (const page of member.pages) {
      const key = normalizeUrl(page.url);
      const entry = byUrl.get(key) ?? { url: page.url, title: page.title, members: new Set() };
      entry.members.add(member.slug);
      byUrl.set(key, entry);
    }
  }
  const shared = [...byUrl.values()]
    .filter((e) => e.members.size > 1)
    .map((e) => ({ url: e.url, title: e.title, members: [...e.members] }));
  const pairs: OverlapReport["pairs"] = [];
  for (let i = 0; i < members.length; i += 1) {
    for (let j = i + 1; j < members.length; j += 1) {
      const a = members[i].slug;
      const b = members[j].slug;
      pairs.push({
        a,
        b,
        shared: shared.filter((s) => s.members.includes(a) && s.members.includes(b)).length,
      });
    }
  }
  const distinct = byUrl.size;
  return {
    shared,
    distinct,
    figure: distinct ? shared.length / distinct : 0,
    pairs,
  };
}
