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
    notes: "Local open-source models; API key optional",
  },
];

/** Curated weekend catalog — extend freely */
export const MODEL_OPTIONS: ModelOption[] = [
  { ref: "openai:gpt-4o-mini", label: "GPT-4o mini", provider: "openai", tier: "cheap" },
  { ref: "openai:gpt-4o", label: "GPT-4o", provider: "openai", tier: "standard" },
  { ref: "openai:o3-mini", label: "o3-mini", provider: "openai", tier: "premium" },
  { ref: "xai:grok-2-latest", label: "Grok 2", provider: "xai", tier: "standard" },
  { ref: "xai:grok-3-mini", label: "Grok 3 mini", provider: "xai", tier: "cheap" },
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
    ref: "openrouter:anthropic/claude-sonnet-4",
    label: "Claude Sonnet (via OR)",
    provider: "openrouter",
    tier: "standard",
  },
  {
    ref: "openrouter:openai/gpt-4o-mini",
    label: "GPT-4o mini (via OR)",
    provider: "openrouter",
    tier: "cheap",
  },
  {
    ref: "openrouter:meta-llama/llama-3.3-70b-instruct",
    label: "Llama 3.3 70B (via OR)",
    provider: "openrouter",
    tier: "standard",
  },
  { ref: "ollama:llama3.2", label: "Llama 3.2 (local)", provider: "ollama", tier: "cheap" },
  { ref: "ollama:qwen2.5", label: "Qwen 2.5 (local)", provider: "ollama", tier: "cheap" },
];

export function parseModelRef(ref: string): { provider: ProviderId; model: string } | null {
  const idx = ref.indexOf(":");
  if (idx <= 0) return null;
  const provider = ref.slice(0, idx) as ProviderId;
  const model = ref.slice(idx + 1);
  if (!PROVIDERS.some((p) => p.id === provider) || !model) return null;
  return { provider, model };
}

/** Migrate legacy bare ids like `gpt-4o-mini` → `openai:gpt-4o-mini` */
export function normalizeModelRef(raw?: string): ModelRef {
  if (!raw) return "openai:gpt-4o-mini";
  if (parseModelRef(raw)) return raw as ModelRef;
  const legacy: Record<string, ModelRef> = {
    "gpt-4o-mini": "openai:gpt-4o-mini",
    "gpt-4o": "openai:gpt-4o",
    "o3-mini": "openai:o3-mini",
  };
  return legacy[raw] ?? ("openai:gpt-4o-mini" as ModelRef);
}

export function modelLabel(ref: string) {
  return MODEL_OPTIONS.find((m) => m.ref === ref)?.label ?? ref;
}
