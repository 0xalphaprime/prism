import {
  CONTEXT_SOURCE_OPTIONS,
  type ContextSourceKind,
} from "./context-sources";

export const CONTEXT_CATALOG_KEY = "prism.contextCatalog.v1";

export type ContextCatalog = {
  enabledKinds: ContextSourceKind[];
};

export function defaultContextCatalog(): ContextCatalog {
  return {
    enabledKinds: CONTEXT_SOURCE_OPTIONS.map((o) => o.kind),
  };
}

export function loadContextCatalog(): ContextCatalog {
  if (typeof window === "undefined") return defaultContextCatalog();
  try {
    const raw = localStorage.getItem(CONTEXT_CATALOG_KEY);
    if (!raw) return defaultContextCatalog();
    const parsed = JSON.parse(raw) as { enabledKinds?: string[] };
    const known = new Set(CONTEXT_SOURCE_OPTIONS.map((o) => o.kind));
    const enabledKinds = (parsed.enabledKinds ?? []).filter((k): k is ContextSourceKind =>
      known.has(k as ContextSourceKind),
    );
    if (!enabledKinds.length) return defaultContextCatalog();
    return { enabledKinds };
  } catch {
    return defaultContextCatalog();
  }
}

export function saveContextCatalog(catalog: ContextCatalog) {
  if (typeof window === "undefined") return;
  localStorage.setItem(CONTEXT_CATALOG_KEY, JSON.stringify(catalog));
}

export function isKindInCatalog(
  catalog: ContextCatalog,
  kind: ContextSourceKind,
) {
  return catalog.enabledKinds.includes(kind);
}

export function toggleKindInCatalog(
  catalog: ContextCatalog,
  kind: ContextSourceKind,
): ContextCatalog {
  const has = catalog.enabledKinds.includes(kind);
  const enabledKinds = has
    ? catalog.enabledKinds.filter((k) => k !== kind)
    : [...catalog.enabledKinds, kind];
  // Keep at least one channel visible
  if (!enabledKinds.length) return catalog;
  return { enabledKinds };
}
