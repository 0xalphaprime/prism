import type { IsolationReport } from "@/lib/types";
import type { BinaryBit, BitResult, EvalItem, HopScore } from "./types";

function matchPattern(text: string, pattern: string): boolean {
  const hay = text ?? "";
  if (pattern.startsWith("/") && pattern.lastIndexOf("/") > 0) {
    const last = pattern.lastIndexOf("/");
    const body = pattern.slice(1, last);
    const flags = pattern.slice(last + 1) || "i";
    try {
      return new RegExp(body, flags).test(hay);
    } catch {
      return hay.toLowerCase().includes(pattern.toLowerCase());
    }
  }
  return hay.toLowerCase().includes(pattern.toLowerCase());
}

function isLengthClip(finishReason?: string) {
  const reason = (finishReason ?? "").toLowerCase();
  return (
    reason === "length" ||
    reason === "max_tokens" ||
    reason === "max_output_tokens"
  );
}

function evalBit(bit: BinaryBit, text: string, isolationOk: boolean): boolean {
  if (bit.kind === "isolation") return isolationOk;
  const hit = matchPattern(text, bit.pattern);
  if (bit.kind === "must-exclude") return !hit;
  return hit;
}

export function scoreHop(args: {
  item: EvalItem;
  output?: string;
  isolation?: IsolationReport;
  truncated?: boolean;
  finishReason?: string;
}): HopScore {
  const output = args.output ?? "";
  const isolationOk = args.isolation?.ok !== false;
  const truncated = Boolean(args.truncated || isLengthClip(args.finishReason));
  const bits: BitResult[] = [];

  for (const bit of args.item.bits) {
    const pass = evalBit(bit, output, isolationOk);
    bits.push({
      id: bit.id,
      kind: bit.kind,
      pass,
      weight: bit.weight ?? 1,
      detail: bit.pattern,
    });
  }

  for (const fact of args.item.goldFacts) {
    bits.push({
      id: `gold:${fact.slice(0, 48)}`,
      kind: "gold",
      pass: matchPattern(output, fact),
      weight: 1,
      detail: fact,
    });
  }

  for (const claim of args.item.forbiddenClaims) {
    bits.push({
      id: `forbidden:${claim.slice(0, 48)}`,
      kind: "forbidden",
      pass: !matchPattern(output, claim),
      weight: 1,
      detail: claim,
    });
  }

  if (args.item.bits.length || args.item.goldFacts.length || args.item.forbiddenClaims.length) {
    bits.push({
      id: "isolation",
      kind: "isolation",
      pass: isolationOk,
      weight: 1,
    });
    bits.push({
      id: "not-truncated",
      kind: "truncated",
      pass: !truncated,
      weight: 1,
    });
  }

  const tags = new Set<string>();
  const failed = bits.filter((bit) => !bit.pass);
  if (failed.length) {
    for (const tag of args.item.failureTags) tags.add(tag);
    if (!isolationOk) tags.add("isolation-fail");
    if (truncated) tags.add("truncated");
  }

  const weight = bits.reduce((sum, bit) => sum + bit.weight, 0);
  const earned = bits.reduce((sum, bit) => sum + (bit.pass ? bit.weight : 0), 0);
  let score: number | null = weight > 0 ? earned / weight : null;
  if (score != null && !isolationOk) score = 0;

  return {
    output,
    score,
    bits,
    tags: [...tags],
    isolationOk,
    truncated,
  };
}

export function liftBetween(first: HopScore, revised?: HopScore): number | null {
  if (!revised || first.score == null || revised.score == null) return null;
  return Number((revised.score - first.score).toFixed(4));
}
