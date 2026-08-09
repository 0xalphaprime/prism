import { NextResponse } from "next/server";
import { parseModelRef } from "@/lib/providers";
import { chatCompletion, type ChatMessage } from "@/lib/server/providers";

export const runtime = "nodejs";

type ChatBody = {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
};

export async function POST(request: Request) {
  let body: ChatBody;
  try {
    body = (await request.json()) as ChatBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body?.model || !Array.isArray(body.messages)) {
    return NextResponse.json(
      { error: "Expected { model, messages[] }" },
      { status: 400 },
    );
  }

  const parsed = parseModelRef(body.model);
  if (!parsed) {
    return NextResponse.json(
      {
        error:
          "Invalid model ref. Use provider:model (e.g. openai:gpt-4o-mini, anthropic:claude-sonnet-4-5).",
      },
      { status: 400 },
    );
  }

  try {
    const result = await chatCompletion({
      provider: parsed.provider,
      model: parsed.model,
      messages: body.messages,
      temperature: body.temperature,
      max_tokens: body.max_tokens,
    });
    return NextResponse.json(result);
  } catch (error) {
    const err = error as Error & { status?: number; detail?: unknown };
    if (err.message?.startsWith("Missing")) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    return NextResponse.json(
      {
        error: err.message || "Failed to reach provider",
        provider: parsed.provider,
        detail: err.detail ?? err.message,
      },
      { status: err.status && err.status >= 400 ? err.status : 502 },
    );
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    hint: "POST { model, messages } — provider status at GET /api/providers?probe=1",
  });
}
