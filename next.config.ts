import type { NextConfig } from "next";

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
