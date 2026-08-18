export type ContextSourceKind =
  | "browser"
  | "documents"
  | "directories"
  | "skills"
  | "repository"
  | "memory"
  | "urls"
  | "notes"
  | "images"
  | "apis"
  | "knowledge";

export type ContextPayload = {
  text?: string;
  url?: string;
  mime?: string;
  meta?: Record<string, string>;
};

export type ContextLibraryItem = {
  id: string;
  kind: ContextSourceKind;
  title: string;
  subtitle?: string;
  /** Where this item can be imported from once agents/APIs are connected */
  importFrom: "agent" | "api" | "local";
  /** Optional content for Block 3 injection (truncated) */
  payload?: ContextPayload;
};

export type AttachedContext = ContextLibraryItem & {
  attachedAt: number;
  /** Upstream context-source node that owns this attachment */
  sourceNodeId: string;
};

/** Keep localStorage / graph docs from ballooning */
export const CONTEXT_TEXT_CAP = 32_000;

export function truncateContextText(text: string, cap = CONTEXT_TEXT_CAP) {
  if (text.length <= cap) return text;
  return `${text.slice(0, cap)}\n\n…[truncated ${text.length - cap} chars]`;
}

export function textLooksTruncated(text: string | undefined): boolean {
  return Boolean(text && text.includes("…[truncated"));
}

/** How the upstream tile collects context for this channel */
export type ContextIntakeMode = "attach" | "urls" | "slash" | "notes" | "folder";

export type ContextSourceMeta = {
  kind: ContextSourceKind;
  label: string;
  hint: string;
  intake: ContextIntakeMode;
};

/** Core + suggested upstream context channels */
export const CONTEXT_SOURCE_OPTIONS: ContextSourceMeta[] = [
  {
    kind: "browser",
    label: "Browser",
    hint: "Paste page URLs — add as many as you need",
    intake: "urls",
  },
  {
    kind: "documents",
    label: "Documents",
    hint: "Attach PDFs, docs, decks from disk",
    intake: "attach",
  },
  {
    kind: "directories",
    label: "Directories",
    hint: "Attach a folder bundle of files",
    intake: "folder",
  },
  {
    kind: "skills",
    label: "Skills",
    hint: "Slash-pick reusable skills from your library",
    intake: "slash",
  },
  {
    kind: "repository",
    label: "Repository",
    hint: "Slash-pick a connected repo",
    intake: "slash",
  },
  {
    kind: "memory",
    label: "Prior runs",
    hint: "Slash-pick artifacts from earlier graphs",
    intake: "slash",
  },
  {
    kind: "urls",
    label: "URLs",
    hint: "Add one or more links to ground on",
    intake: "urls",
  },
  {
    kind: "notes",
    label: "Notes",
    hint: "Type or paste notes for this pass",
    intake: "notes",
  },
  {
    kind: "images",
    label: "Images",
    hint: "Attach screenshots, diagrams, photos",
    intake: "attach",
  },
  {
    kind: "apis",
    label: "APIs",
    hint: "Slash-pick connected API configs",
    intake: "slash",
  },
  {
    kind: "knowledge",
    label: "Knowledge base",
    hint: "Slash-pick wiki / knowledge cards",
    intake: "slash",
  },
];

export function normalizeUrl(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const withProtocol = /^https?:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
    const url = new URL(withProtocol);
    return url.toString();
  } catch {
    return null;
  }
}

/** Seed library — later filled by connected agents + API configs */
export const CONTEXT_LIBRARY: ContextLibraryItem[] = [
  {
    id: "lib-browser-active",
    kind: "browser",
    title: "Active tab snapshot",
    subtitle: "Current browser selection",
    importFrom: "agent",
  },
  {
    id: "lib-docs-brief",
    kind: "documents",
    title: "Product brief.pdf",
    subtitle: "Documents library",
    importFrom: "local",
  },
  {
    id: "lib-docs-spec",
    kind: "documents",
    title: "API spec.md",
    subtitle: "Documents library",
    importFrom: "local",
  },
  {
    id: "lib-dir-research",
    kind: "directories",
    title: "/research-pack",
    subtitle: "Directory bundle",
    importFrom: "local",
  },
  {
    id: "lib-skill-critique",
    kind: "skills",
    title: "Critique loop",
    subtitle: "Skill · agent import",
    importFrom: "agent",
  },
  {
    id: "lib-skill-summarize",
    kind: "skills",
    title: "Summarize branch",
    subtitle: "Skill · agent import",
    importFrom: "agent",
  },
  {
    id: "lib-repo-prism",
    kind: "repository",
    title: "0xalphaprime/prism",
    subtitle: "Repository",
    importFrom: "api",
  },
  {
    id: "lib-memory-last",
    kind: "memory",
    title: "Last MoA run",
    subtitle: "Prior run artifacts",
    importFrom: "local",
  },
  {
    id: "lib-url-langsmith",
    kind: "urls",
    title: "LangSmith Studio docs",
    subtitle: "https://…",
    importFrom: "api",
  },
  {
    id: "lib-notes-constraints",
    kind: "notes",
    title: "Weekend constraints",
    subtitle: "Notes",
    importFrom: "local",
  },
  {
    id: "lib-img-canvas",
    kind: "images",
    title: "Canvas sketch.png",
    subtitle: "Image",
    importFrom: "local",
  },
  {
    id: "lib-api-openai",
    kind: "apis",
    title: "OpenAI compatible",
    subtitle: "API config",
    importFrom: "api",
  },
  {
    id: "lib-kb-cards",
    kind: "knowledge",
    title: "Knowledge Cards",
    subtitle: "Knowledge base",
    importFrom: "api",
  },
];

export function libraryForKinds(kinds: ContextSourceKind[]) {
  if (!kinds.length) return [];
  const set = new Set(kinds);
  return CONTEXT_LIBRARY.filter((item) => set.has(item.kind));
}

export function filterLibraryBySlash(
  kinds: ContextSourceKind[],
  query: string,
) {
  const q = query.trim().toLowerCase();
  return libraryForKinds(kinds).filter((item) => {
    if (!q) return true;
    return (
      item.title.toLowerCase().includes(q) ||
      item.kind.includes(q) ||
      item.subtitle?.toLowerCase().includes(q)
    );
  });
}
