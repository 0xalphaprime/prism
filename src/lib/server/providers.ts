import { PROVIDERS, type ProviderId } from "@/lib/providers";

export type ProviderResolve = {
  id: ProviderId;
  label: string;
  baseUrl: string;
  apiKey: string;
  keyEnv: string;
  hasKey: boolean;
};

export type ProviderProbe = {
  id: ProviderId;
  label: string;
  hasKey: boolean;
  ok: boolean;
  status: "connected" | "configured" | "disconnected" | "error";
  latencyMs?: number;
  detail?: string;
  notes: string;
};

export function resolveProvider(provider: ProviderId): ProviderResolve | null {
  const meta = PROVIDERS.find((p) => p.id === provider);
  if (!meta) return null;

  const baseUrl =
    process.env[meta.baseUrlEnv]?.replace(/\/$/, "") ||
    meta.defaultBaseUrl?.replace(/\/$/, "") ||
    "";
  let apiKey = process.env[meta.apiKeyEnv] ?? "";
  let keyEnv = meta.apiKeyEnv;
  // ~/.env uses ANTHROPIC_CURSOR_API
  if (!apiKey && meta.id === "anthropic") {
    const alt = process.env.ANTHROPIC_CURSOR_API ?? "";
    if (alt) {
      apiKey = alt;
      keyEnv = "ANTHROPIC_CURSOR_API";
    }
  }

  return {
    id: meta.id,
    label: meta.label,
    baseUrl,
    apiKey,
    keyEnv,
    hasKey: Boolean(apiKey) || meta.id === "ollama",
  };
}

async function probeOpenAICompat(resolved: ProviderResolve): Promise<{
  ok: boolean;
  latencyMs: number;
  detail?: string;
}> {
  const started = Date.now();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (resolved.apiKey) {
    headers.Authorization = `Bearer ${resolved.apiKey}`;
  }
  if (resolved.id === "openrouter") {
    headers["HTTP-Referer"] =
      process.env.OPENROUTER_SITE_URL ?? "http://localhost:3001";
    headers["X-Title"] = process.env.OPENROUTER_APP_NAME ?? "Prism";
  }

  try {
    // models list is a cheap auth check for OpenAI-compatible APIs
    const res = await fetch(`${resolved.baseUrl}/models`, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(12_000),
    });
    const latencyMs = Date.now() - started;
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        latencyMs,
        detail: text.slice(0, 240) || `HTTP ${res.status}`,
      };
    }
    return { ok: true, latencyMs };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

async function probeAnthropic(resolved: ProviderResolve): Promise<{
  ok: boolean;
  latencyMs: number;
  detail?: string;
}> {
  const started = Date.now();
  if (!resolved.apiKey) {
    return { ok: false, latencyMs: 0, detail: `Missing ${resolved.keyEnv}` };
  }
  try {
    // Minimal messages call — Anthropic has no simple /models auth ping without beta
    const res = await fetch(`${resolved.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": resolved.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1,
        messages: [{ role: "user", content: "ping" }],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const latencyMs = Date.now() - started;
    // 200 = connected; 401/403 = bad key; 400 with auth ok still proves key works sometimes
    if (res.ok) return { ok: true, latencyMs };
    const payload = (await res.json().catch(() => null)) as {
      error?: { message?: string; type?: string };
    } | null;
    const msg = payload?.error?.message ?? `HTTP ${res.status}`;
    // Invalid request but authenticated still counts as verified key
    if (res.status === 400 && !/api.?key|auth|permission/i.test(msg)) {
      return { ok: true, latencyMs, detail: "Key accepted" };
    }
    return { ok: false, latencyMs, detail: msg.slice(0, 240) };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function probeProvider(provider: ProviderId): Promise<ProviderProbe> {
  const meta = PROVIDERS.find((p) => p.id === provider)!;
  const resolved = resolveProvider(provider);
  if (!resolved?.baseUrl) {
    return {
      id: provider,
      label: meta.label,
      hasKey: false,
      ok: false,
      status: "disconnected",
      detail: "Missing base URL",
      notes: meta.notes,
    };
  }

  if (!resolved.hasKey) {
    return {
      id: provider,
      label: meta.label,
      hasKey: false,
      ok: false,
      status: "disconnected",
      detail: `Add ${resolved.keyEnv} to .env.local`,
      notes: meta.notes,
    };
  }

  const result =
    provider === "anthropic"
      ? await probeAnthropic(resolved)
      : await probeOpenAICompat(resolved);

  if (result.ok) {
    return {
      id: provider,
      label: meta.label,
      hasKey: true,
      ok: true,
      status: "connected",
      latencyMs: result.latencyMs,
      detail: result.detail,
      notes: meta.notes,
    };
  }

  return {
    id: provider,
    label: meta.label,
    hasKey: true,
    ok: false,
    status: "error",
    latencyMs: result.latencyMs,
    detail: result.detail,
    notes: meta.notes,
  };
}

export async function probeAllProviders(): Promise<ProviderProbe[]> {
  return Promise.all(PROVIDERS.map((p) => probeProvider(p.id)));
}

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export async function chatCompletion(args: {
  provider: ProviderId;
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
}) {
  const resolved = resolveProvider(args.provider);
  if (!resolved?.baseUrl) {
    throw new Error(`Missing base URL for ${args.provider}`);
  }
  if (args.provider !== "ollama" && !resolved.apiKey) {
    throw new Error(`Missing ${resolved.keyEnv} for ${args.provider}`);
  }

  const started = Date.now();

  if (args.provider === "anthropic") {
    const system = args.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const messages = args.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role, content: m.content }));

    const res = await fetch(`${resolved.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": resolved.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: args.model,
        max_tokens: args.max_tokens ?? 1024,
        temperature: args.temperature ?? 0.4,
        system: system || undefined,
        messages,
      }),
    });
    const payload = (await res.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!res.ok) {
      const err = new Error("Upstream provider error") as Error & {
        status: number;
        detail: unknown;
      };
      err.status = res.status;
      err.detail = payload;
      throw err;
    }
    const contentBlocks = (
      payload as { content?: Array<{ type?: string; text?: string }> }
    )?.content;
    const content =
      contentBlocks
        ?.filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join("") ?? "";
    return {
      provider: args.provider,
      model: args.model,
      content,
      usage: (payload as { usage?: unknown })?.usage ?? null,
      latencyMs: Date.now() - started,
      raw: payload,
    };
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (resolved.apiKey) {
    headers.Authorization = `Bearer ${resolved.apiKey}`;
  }
  if (args.provider === "openrouter") {
    headers["HTTP-Referer"] =
      process.env.OPENROUTER_SITE_URL ?? "http://localhost:3001";
    headers["X-Title"] = process.env.OPENROUTER_APP_NAME ?? "Prism";
  }

  const res = await fetch(`${resolved.baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: args.model,
      messages: args.messages,
      temperature: args.temperature ?? 0.4,
      max_tokens: args.max_tokens,
    }),
  });
  const payload = (await res.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!res.ok) {
    const err = new Error("Upstream provider error") as Error & {
      status: number;
      detail: unknown;
    };
    err.status = res.status;
    err.detail = payload;
    throw err;
  }
  const choice = (
    payload as {
      choices?: Array<{
        message?: {
          content?: string | Array<{ type?: string; text?: string }>;
          reasoning?: string;
        };
      }>;
    }
  )?.choices?.[0];
  const message = choice?.message;
  let content = "";
  if (typeof message?.content === "string") content = message.content;
  else if (Array.isArray(message?.content)) {
    content = message.content
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .join("");
  }
  const reasoning =
    typeof message?.reasoning === "string" && message.reasoning.trim()
      ? message.reasoning
      : undefined;
  return {
    provider: args.provider,
    model: args.model,
    content,
    reasoning,
    usage: (payload as { usage?: unknown })?.usage ?? null,
    latencyMs: Date.now() - started,
    raw: payload,
  };
}
