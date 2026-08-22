import { NextResponse } from "next/server";
import {
  BUILDER_MODEL,
  builderMessages,
  builderRepairMessages,
  hydrateBuilderSpec,
  parseBuilderSpec,
} from "@/lib/builder-agent";
import { PROVIDERS, parseModelRef, type ProviderId } from "@/lib/providers";
import { chatCompletion } from "@/lib/server/providers";

export const runtime = "nodejs";

const SSR_OWNER = { id: "local", name: "Local builder" };

type BuildBody = {
  archetype?: string;
  model?: string;
  defaultProvider?: string;
};

function asProviderId(raw: string | undefined): ProviderId {
  if (raw && PROVIDERS.some((p) => p.id === raw)) return raw as ProviderId;
  return "openrouter";
}

async function complete(modelRef: string, messages: Parameters<typeof chatCompletion>[0]["messages"]) {
  const parsed = parseModelRef(modelRef);
  if (!parsed) {
    throw Object.assign(new Error("Invalid model ref."), { status: 400 });
  }
  return chatCompletion({
    provider: parsed.provider,
    model: parsed.model,
    messages,
    temperature: 0.3,
    max_tokens: 4096,
  });
}

export async function POST(request: Request) {
  let body: BuildBody;
  try {
    body = (await request.json()) as BuildBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const archetype = body.archetype?.trim() ?? "";
  if (!archetype) {
    return NextResponse.json(
      { error: "Type the architecture you want (the archetype)." },
      { status: 400 },
    );
  }

  const modelRef = body.model?.trim() || BUILDER_MODEL;
  if (!parseModelRef(modelRef)) {
    return NextResponse.json(
      {
        error:
          "Invalid model ref. Use provider:model (e.g. openrouter:x-ai/grok-4.6).",
      },
      { status: 400 },
    );
  }

  const defaultProvider = asProviderId(body.defaultProvider);

  try {
    const first = await complete(modelRef, builderMessages(archetype));
    let parsed = parseBuilderSpec(first.content ?? "");
    if ("error" in parsed) {
      const retry = await complete(
        modelRef,
        builderRepairMessages(archetype, first.content ?? "", parsed.error),
      );
      parsed = parseBuilderSpec(retry.content ?? "");
    }
    if ("error" in parsed) {
      return NextResponse.json(
        { error: parsed.error },
        { status: 422 },
      );
    }

    const document = hydrateBuilderSpec(
      parsed.spec,
      SSR_OWNER,
      defaultProvider,
    );
    return NextResponse.json({ document });
  } catch (error) {
    const err = error as Error & { status?: number; detail?: unknown };
    if (err.message?.startsWith("Missing")) {
      return NextResponse.json(
        {
          error: `${err.message} Open Connections and Verify providers.`,
        },
        { status: 503 },
      );
    }
    return NextResponse.json(
      {
        error: err.message || "Builder failed to reach a provider",
        detail: err.detail ?? err.message,
      },
      { status: err.status && err.status >= 400 ? err.status : 502 },
    );
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    hint: "POST { archetype } — Builder agent returns a Prism document",
    model: BUILDER_MODEL,
  });
}
