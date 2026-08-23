import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/** Signed source of truth. Server-only — do not import from client. */
export const FOUNDRY_EVAL_CARDS_DIR =
  process.env.PRISM_EVAL_CARDS_DIR?.trim() ||
  path.join("/home/alpha/projects/foundry/lora/eval-cards");

const CARD_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function safeCardId(raw: string): string | null {
  const id = raw.trim();
  if (!CARD_ID.test(id)) return null;
  return id;
}

export function listSignedDiskCards(dir = FOUNDRY_EVAL_CARDS_DIR): string[] {
  try {
    return readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => name.slice(0, -".json".length))
      .filter((id): id is string => Boolean(safeCardId(id)))
      .sort();
  } catch {
    return [];
  }
}

export function readSignedDiskCard(
  rawId: string,
  dir = FOUNDRY_EVAL_CARDS_DIR,
): unknown {
  const id = safeCardId(rawId);
  if (!id) throw new Error("Invalid card id");
  const file = path.join(dir, `${id}.json`);
  const resolved = path.resolve(file);
  const root = path.resolve(dir);
  if (!resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("Invalid card id");
  }
  try {
    return JSON.parse(readFileSync(resolved, "utf8")) as unknown;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new Error(`No signed JSON on disk for “${id}”.`);
    }
    throw error;
  }
}
