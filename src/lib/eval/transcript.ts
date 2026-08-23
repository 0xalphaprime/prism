import type { EvalItem, ExperimentRecord } from "./types";
import type { NodeResult } from "@/lib/runs";

function fmt(score: number | null | undefined) {
  if (score == null) return "—";
  return score.toFixed(2);
}

function dumpNode(row: NodeResult): string {
  const lines = [`### ${row.label} (${row.nodeId}) · ${row.status}`];
  if (row.servedModel || row.model) {
    lines.push(`model: ${row.servedModel ?? String(row.model)}`);
  }
  if (row.ingest?.messages?.length) {
    lines.push("ingest");
    for (const msg of row.ingest.messages) {
      lines.push(`--- ${msg.role} ---`, msg.content);
    }
  }
  lines.push("output", row.output?.trim() || "(empty)");
  if (row.reasoning?.trim()) {
    lines.push("reasoning", row.reasoning.trim());
  }
  if (row.errorDetail) {
    lines.push("error", row.errorDetail);
  }
  return lines.join("\n");
}

/** Prompt, scored hops, and per-node exhaust for one card. */
export function cardTranscript(focused: ExperimentRecord, item?: EvalItem) {
  const itemId = focused.cells[0]?.itemId ?? "";
  const lines = [itemId, item?.prompt?.trim() || "", ""];
  for (const architectureId of focused.architectureIds) {
    const cell = focused.cells.find(
      (c) => c.architectureId === architectureId && c.rep === 1,
    );
    lines.push(`## ${architectureId} · ${cell?.status ?? "idle"}`);
    lines.push(`first ${fmt(cell?.firstPass.score)}`);
    if (cell?.firstPass.output) lines.push(cell.firstPass.output);
    if (cell?.revised) {
      lines.push(`revised ${fmt(cell.revised.score)} · lift ${fmt(cell.lift)}`);
      if (cell.revised.output) lines.push(cell.revised.output);
    }
    if (cell?.nodeResults.length) {
      lines.push("exhaust");
      for (const row of cell.nodeResults) {
        lines.push(dumpNode(row), "");
      }
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}
