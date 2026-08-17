/**
 * Multi-provider model catalog.
 * Node.model stores a ModelRef string: `provider:modelId`
 */

export type ProviderId = "openai" | "anthropic" | "xai" | "openrouter" | "ollama";

export type ModelRef = `${ProviderId}:${string}`;

export type ModelOption = {
  ref: ModelRef;
  label: string;
  provider: ProviderId;
  /** Rough relative cost for UI sorting */
  tier: "cheap" | "standard" | "premium";
};

export type ProviderMeta = {
  id: ProviderId;
  label: string;
  /** OpenAI-compatible base URL used by /api/chat */
  baseUrlEnv: string;
  apiKeyEnv: string;
  defaultBaseUrl?: string;
  notes: string;
};

export const PROVIDERS: ProviderMeta[] = [
  {
    id: "openai",
    label: "OpenAI",
    baseUrlEnv: "OPENAI_BASE_URL",
    apiKeyEnv: "OPENAI_API_KEY",
    defaultBaseUrl: "https://api.openai.com/v1",
    notes: "Direct OpenAI API",
  },
  {
    id: "xai",
    label: "xAI (Grok)",
    baseUrlEnv: "XAI_BASE_URL",
    apiKeyEnv: "XAI_API_KEY",
    defaultBaseUrl: "https://api.x.ai/v1",
    notes: "OpenAI-compatible Grok endpoint",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    baseUrlEnv: "ANTHROPIC_BASE_URL",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    /** Also accepted: ANTHROPIC_CURSOR_API (your ~/.env name) */
    defaultBaseUrl: "https://api.anthropic.com",
    notes: "Direct Anthropic Messages API (ANTHROPIC_API_KEY or ANTHROPIC_CURSOR_API)",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    baseUrlEnv: "OPENROUTER_BASE_URL",
    apiKeyEnv: "OPEN_ROUTER_HERMES_API_KEY",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    notes: "OPEN_ROUTER_HERMES_API_KEY → many models (GPT, Claude, open-source)",
  },
  {
    id: "ollama",
    label: "Ollama",
    baseUrlEnv: "OLLAMA_BASE_URL",
    apiKeyEnv: "OLLAMA_API_KEY",
    defaultBaseUrl: "http://127.0.0.1:11434/v1",
    notes:
      "Foundry Tailscale (OLLAMA_BASE_URL=http://100.78.81.94:11434/v1) or local daemon. No API key.",
  },
];

/** Curated weekend catalog — extend freely */
export const MODEL_OPTIONS: ModelOption[] = [
  { ref: "openai:gpt-4o-mini", label: "GPT-4o mini", provider: "openai", tier: "cheap" },
  { ref: "openai:gpt-4o", label: "GPT-4o", provider: "openai", tier: "standard" },
  { ref: "openai:gpt-5.6-sol", label: "GPT-5.6 Sol", provider: "openai", tier: "premium" },
  { ref: "openai:o3-mini", label: "o3-mini", provider: "openai", tier: "premium" },
  { ref: "xai:grok-4.6", label: "Grok 4.6", provider: "xai", tier: "premium" },
  { ref: "xai:grok-2-latest", label: "Grok 2", provider: "xai", tier: "standard" },
  { ref: "xai:grok-3-mini", label: "Grok 3 mini", provider: "xai", tier: "cheap" },
  {
    ref: "anthropic:claude-opus-5",
    label: "Claude Opus 5",
    provider: "anthropic",
    tier: "premium",
  },
  {
    ref: "anthropic:claude-sonnet-4-5",
    label: "Claude Sonnet 4.5",
    provider: "anthropic",
    tier: "standard",
  },
  {
    ref: "anthropic:claude-haiku-4-5-20251001",
    label: "Claude Haiku 4.5",
    provider: "anthropic",
    tier: "cheap",
  },
  {
    ref: "openrouter:openai/gpt-5.6-sol",
    label: "GPT-5.6 Sol (via OR)",
    provider: "openrouter",
    tier: "premium",
  },
  {
    ref: "openrouter:openai/gpt-4o-mini",
    label: "GPT-4o mini (via OR)",
    provider: "openrouter",
    tier: "cheap",
  },
  {
    ref: "openrouter:openai/gpt-4o",
    label: "GPT-4o (via OR)",
    provider: "openrouter",
    tier: "standard",
  },
  {
    ref: "openrouter:anthropic/claude-opus-5",
    label: "Claude Opus 5 (via OR)",
    provider: "openrouter",
    tier: "premium",
  },
  {
    ref: "openrouter:anthropic/claude-sonnet-4",
    label: "Claude Sonnet (via OR)",
    provider: "openrouter",
    tier: "standard",
  },
  {
    ref: "openrouter:anthropic/claude-haiku-4.5",
    label: "Claude Haiku (via OR)",
    provider: "openrouter",
    tier: "cheap",
  },
  {
    ref: "openrouter:x-ai/grok-4.6",
    label: "Grok 4.6 (via OR)",
    provider: "openrouter",
    tier: "premium",
  },
  {
    ref: "openrouter:x-ai/grok-3-mini",
    label: "Grok 3 mini (via OR)",
    provider: "openrouter",
    tier: "cheap",
  },
  {
    ref: "openrouter:meta-llama/llama-3.3-70b-instruct",
    label: "Llama 3.3 70B (via OR)",
    provider: "openrouter",
    tier: "standard",
  },
  {
    ref: "openrouter:google/gemini-2.0-flash-001",
    label: "Gemini 2.0 Flash (via OR)",
    provider: "openrouter",
    tier: "cheap",
  },
  {
    ref: "ollama:nemotron-3.5-lightning:latest",
    label: "Nemo Lightning (Foundry)",
    provider: "ollama",
    tier: "standard",
  },
  { ref: "ollama:llama3.2", label: "Llama 3.2 (local)", provider: "ollama", tier: "cheap" },
  { ref: "ollama:qwen2.5", label: "Qwen 2.5 (local)", provider: "ollama", tier: "cheap" },
];

/** Cheap default model on a given channel */
export const DEFAULT_MODEL_BY_PROVIDER: Record<ProviderId, ModelRef> = {
  openai: "openai:gpt-4o-mini",
  anthropic: "anthropic:claude-haiku-4-5-20251001",
  xai: "xai:grok-3-mini",
  openrouter: "openrouter:openai/gpt-4o-mini",
  ollama: "ollama:nemotron-3.5-lightning:latest",
};

/** Best-effort remap when switching default channel */
const REMAP_TO_OPENROUTER: Record<string, ModelRef> = {
  "openai:gpt-4o-mini": "openrouter:openai/gpt-4o-mini",
  "openai:gpt-4o": "openrouter:openai/gpt-4o",
  "openai:gpt-5.6-sol": "openrouter:openai/gpt-5.6-sol",
  "openai:o3-mini": "openrouter:openai/gpt-4o-mini",
  "anthropic:claude-opus-5": "openrouter:anthropic/claude-opus-5",
  "anthropic:claude-sonnet-4-5": "openrouter:anthropic/claude-sonnet-4",
  "anthropic:claude-haiku-4-5-20251001": "openrouter:anthropic/claude-haiku-4.5",
  "xai:grok-4.6": "openrouter:x-ai/grok-4.6",
  "xai:grok-3-mini": "openrouter:x-ai/grok-3-mini",
  "xai:grok-2-latest": "openrouter:x-ai/grok-3-mini",
};

export function defaultModelForProvider(provider: ProviderId): ModelRef {
  return DEFAULT_MODEL_BY_PROVIDER[provider] ?? "openai:gpt-4o-mini";
}

export function modelsForProvider(provider: ProviderId): ModelOption[] {
  return MODEL_OPTIONS.filter((m) => m.provider === provider);
}

/** Preferred channel first, then the rest (for Expand select). */
export function orderedModelOptions(preferred: ProviderId): ModelOption[] {
  const primary = modelsForProvider(preferred);
  const rest = MODEL_OPTIONS.filter((m) => m.provider !== preferred);
  return [...primary, ...rest];
}

/**
 * Remap a model ref onto `target` when we know an equivalent.
 * Falls back to that channel’s cheap default.
 */
export function remapModelToProvider(
  raw: string | undefined,
  target: ProviderId,
): ModelRef {
  const current = normalizeModelRef(raw);
  const parsed = parseModelRef(current);
  if (parsed?.provider === target) return current;
  // Student / Foundry lanes stay on Ollama when remapping the rest of the graph
  if (parsed?.provider === "ollama" && target !== "ollama") return current;

  if (target === "openrouter") {
    const hit = REMAP_TO_OPENROUTER[current];
    if (hit) return hit;
  }

  // Reverse: openrouter → direct when leaving OR
  if (parsed?.provider === "openrouter") {
    const reverse = Object.entries(REMAP_TO_OPENROUTER).find(
      ([, v]) => v === current,
    );
    if (reverse) {
      const direct = reverse[0] as ModelRef;
      if (parseModelRef(direct)?.provider === target) return direct;
    }
  }

  return defaultModelForProvider(target);
}

export function parseModelRef(ref: string): { provider: ProviderId; model: string } | null {
  const idx = ref.indexOf(":");
  if (idx <= 0) return null;
  const provider = ref.slice(0, idx) as ProviderId;
  const model = ref.slice(idx + 1);
  if (!PROVIDERS.some((p) => p.id === provider) || !model) return null;
  return { provider, model };
}

/** Migrate legacy bare ids like `gpt-4o-mini` → `openai:gpt-4o-mini` */
export function normalizeModelRef(
  raw?: string,
  preferredProvider?: ProviderId,
): ModelRef {
  const fallback = preferredProvider
    ? defaultModelForProvider(preferredProvider)
    : DEFAULT_MODEL_BY_PROVIDER.openai;
  if (!raw) return fallback;
  if (parseModelRef(raw)) return raw as ModelRef;
  const legacy: Record<string, ModelRef> = {
    "gpt-4o-mini": "openai:gpt-4o-mini",
    "gpt-4o": "openai:gpt-4o",
    "o3-mini": "openai:o3-mini",
  };
  return legacy[raw] ?? fallback;
}

export function modelLabel(ref: string) {
  return MODEL_OPTIONS.find((m) => m.ref === ref)?.label ?? ref;
}
