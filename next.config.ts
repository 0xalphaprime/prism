import type { NextConfig } from "next";

const extraOrigins =
  process.env.PRISM_DEV_ORIGINS?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean) ?? [];

const nextConfig: NextConfig = {
  // Tailscale / LAN hosts must be listed or Next 16 blocks /_next chunks
  // and the canvas never hydrates (empty grid, chrome still SSR'd).
  allowedDevOrigins: [
    "100.111.89.59",
    "127.0.0.1",
    "*.ts.net",
    ...extraOrigins,
  ],
};

export default nextConfig;
