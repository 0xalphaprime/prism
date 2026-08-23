import { writeFileSync } from "node:fs";
import type { BinaryBit, EvalItem, EvalSet, EvalSplit } from "./types";
import { assertNoFirehose } from "./firehose";
import { PRIME_LEFTOVERS_SET_ID } from "./sets";
import { getEvalSetLive, PRIME_LEFTOVERS_PATH } from "./sets-disk";

const SPLITS = new Set<EvalSplit>(["train", "dev", "held-out"]);
const BIT_KINDS = new Set([
  "must-include",
  "must-exclude",
  "must-omit-unknown",
  "format",
  "isolation",
]);

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function coerceBit(raw: unknown): BinaryBit | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const id = typeof row.id === "string" ? row.id.trim() : "";
  const kind = typeof row.kind === "string" ? row.kind.trim() : "";
  const pattern = typeof row.pattern === "string" ? row.pattern : "";
  if (!id || !BIT_KINDS.has(kind) || !pattern) return null;
  const bit: BinaryBit = { id, kind: kind as BinaryBit["kind"], pattern };
  if (typeof row.weight === "number" && Number.isFinite(row.weight)) {
    bit.weight = row.weight;
  }
  return bit;
}

export function coerceEvalItem(raw: unknown): EvalItem {
  const source =
    raw && typeof raw === "object" && "item" in raw
      ? (raw as { item: unknown }).item
      : raw;
  if (!source || typeof source !== "object") {
    throw new Error("Expected an EvalItem JSON object");
  }
  const row = source as Record<string, unknown>;
  const id = typeof row.id === "string" ? row.id.trim() : "";
  if (!id) throw new Error("EvalItem needs an id");
  const splitRaw = typeof row.split === "string" ? row.split.trim() : "train";
  if (!SPLITS.has(splitRaw as EvalSplit)) {
    throw new Error(`Unknown split “${splitRaw}”`);
  }
  const prompt = typeof row.prompt === "string" ? row.prompt : "";
  const allowedContext =
    typeof row.allowedContext === "string" ? row.allowedContext : "";
  if (!prompt.trim() || !allowedContext.trim()) {
    throw new Error("EvalItem needs prompt and allowedContext");
  }
  assertNoFirehose(allowedContext);

  const bits = Array.isArray(row.bits)
    ? row.bits.map(coerceBit).filter((b): b is BinaryBit => Boolean(b))
    : [];

  const item: EvalItem = {
    id,
    split: splitRaw as EvalSplit,
    tags: stringList(row.tags),
    prompt,
    allowedContext,
    goldFacts: stringList(row.goldFacts),
    forbiddenClaims: stringList(row.forbiddenClaims),
    bits,
    failureTags: stringList(row.failureTags),
  };
  if (typeof row.referenceAnswer === "string" && row.referenceAnswer.trim()) {
    item.referenceAnswer = row.referenceAnswer;
  }
  return item;
}

export function upsertEvalItem(item: EvalItem): EvalSet {
  const set = getEvalSetLive(PRIME_LEFTOVERS_SET_ID);
  if (!set) throw new Error("prime-leftovers.v1 is missing");
  const idx = set.items.findIndex((row) => row.id === item.id);
  if (idx < 0) {
    throw new Error(
      `Unknown eval item id “${item.id}”. Import only replaces an existing shell.`,
    );
  }
  const next: EvalSet = {
    ...set,
    items: set.items.map((row, i) => (i === idx ? item : row)),
  };
  writeFileSync(PRIME_LEFTOVERS_PATH, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}
