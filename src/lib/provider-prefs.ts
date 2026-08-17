import { PROVIDERS, type ProviderId } from "./providers";

export const PROVIDER_PREFS_KEY = "prism.providerPrefs.v1";

export type ProviderPrefs = {
  /** Preferred channel for new nodes + model picker ordering */
  defaultProvider: ProviderId;
};

export function defaultProviderPrefs(): ProviderPrefs {
  return { defaultProvider: "openai" };
}

export function loadProviderPrefs(): ProviderPrefs {
  if (typeof window === "undefined") return defaultProviderPrefs();
  try {
    const raw = localStorage.getItem(PROVIDER_PREFS_KEY);
    if (!raw) return defaultProviderPrefs();
    const parsed = JSON.parse(raw) as { defaultProvider?: string };
    const id = parsed.defaultProvider as ProviderId | undefined;
    if (id && PROVIDERS.some((p) => p.id === id)) {
      return { defaultProvider: id };
    }
    return defaultProviderPrefs();
  } catch {
    return defaultProviderPrefs();
  }
}

export function saveProviderPrefs(prefs: ProviderPrefs) {
  if (typeof window === "undefined") return;
  localStorage.setItem(PROVIDER_PREFS_KEY, JSON.stringify(prefs));
}
