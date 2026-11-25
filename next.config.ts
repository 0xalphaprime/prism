import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

/**
 * Local-only override for the Student vs teachers seed. `PRISM_STUDENT_SEED_ID`
 * names a card in a private eval set (git-ignored `data/eval/private/`, or
 * `PRISM_PRIVATE_EVAL_DIR`). Unset or not found → the fictional sample card.
 */
function privateStudentSeed(): string {
  const id = process.env.PRISM_STUDENT_SEED_ID?.trim();
  if (!id) return "";
  const dir =
    process.env.PRISM_PRIVATE_EVAL_DIR?.trim() ||
    path.join(process.cwd(), "data", "eval", "private");
  try {
    for (const name of readdirSync(dir).filter((n) => n.endsWith(".json"))) {
      const set = JSON.parse(readFileSync(path.join(dir, name), "utf8")) as {
        items?: Array<{ id?: string; prompt?: string; allowedContext?: string }>;
      };
      const item = set.items?.find((row) => row.id === id);
      if (item?.prompt?.trim() && item.allowedContext?.trim()) {
        return JSON.stringify({
          id: item.id,
          prompt: item.prompt,
          allowedContext: item.allowedContext,
        });
      }
    }
  } catch {
    /* no private folder — fall back to the sample seed */
  }
  return "";
}

const extraOrigins =
  process.env.PRISM_DEV_ORIGINS?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean) ?? [];

const nextConfig: NextConfig = {
  // Foundry-style keys (no NEXT_PUBLIC_ prefix) inlined so client graph
  // defaults and server runs agree. Empty → Muse / Lightning fallbacks in providers.ts.
  env: {
    PRIMARY_MODEL: process.env.PRIMARY_MODEL ?? "",
    PRIOR_STUDENT_MODEL: process.env.PRIOR_STUDENT_MODEL ?? "",
    // Who the student writes as ("Do the job as …"). Empty → "our team".
    PRISM_ORG_NAME: process.env.PRISM_ORG_NAME ?? "",
    PRISM_STUDENT_SEED: privateStudentSeed(),
  },
  // Tailscale / LAN hosts must be listed or Next 16 blocks /_next chunks
  // and the canvas never hydrates (empty grid, chrome still SSR'd).
  allowedDevOrigins: [
    "100.111.89.59",
    "172.29.1.215",
    "127.0.0.1",
    "*.ts.net",
    "*.trycloudflare.com",
    ...extraOrigins,
  ],
};

export default nextConfig;
