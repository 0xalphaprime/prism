import { NextResponse } from "next/server";
import { PROVIDERS, type ProviderId } from "@/lib/providers";
import {
  probeAllProviders,
  probeProvider,
  resolveProvider,
} from "@/lib/server/providers";

export const runtime = "nodejs";

/** GET /api/providers — key presence. ?probe=1 runs live verification. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const probe = searchParams.get("probe") === "1";
  const only = searchParams.get("id") as ProviderId | null;

  if (probe) {
    if (only && PROVIDERS.some((p) => p.id === only)) {
      const result = await probeProvider(only);
      return NextResponse.json({ providers: [result], probed: true });
    }
    const providers = await probeAllProviders();
    return NextResponse.json({ providers, probed: true });
  }

  const providers = PROVIDERS.map((p) => {
    const resolved = resolveProvider(p.id);
    const hasKey = Boolean(resolved?.hasKey);
    return {
      id: p.id,
      label: p.label,
      hasKey,
      ok: false,
      status: hasKey ? ("configured" as const) : ("disconnected" as const),
      detail: hasKey
        ? `Key present (${resolved?.keyEnv}) — run Verify to confirm`
        : `Add ${p.apiKeyEnv} to .env.local`,
      notes: p.notes,
    };
  });

  return NextResponse.json({ providers, probed: false });
}
