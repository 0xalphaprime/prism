/** Sync FNV-1a — Tailscale HTTP has no `crypto.subtle`. */
export function stableHash(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function hashJson(value: unknown): string {
  return stableHash(JSON.stringify(value));
}
