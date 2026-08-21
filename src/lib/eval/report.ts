import { STUDENT_NODE_ID } from "@/lib/student-graph";
import { CAUSAL_FILE_KIND, TRACE_SCHEMA_VERSION } from "@/lib/trace";
import { getEvalSet } from "./sets";
import { buildDecisionNotes } from "./decision";
import {
  beforeAfterPairs,
  failureClusters,
  questionMatrix,
  summarizeArchitectures,
  winnerLine,
} from "./stats";
import type { ExperimentRecord, HopScore } from "./types";
import { TRAIN_FILE_KIND } from "./types";

export {
  beforeAfterPairs,
  failureClusters,
  questionMatrix,
  summarizeArchitectures,
  winnerLine,
};

function fmt(score: number | null | undefined) {
  if (score == null) return "—";
  return score.toFixed(2);
}

export function experimentToMarkdown(record: ExperimentRecord): string {
  const set = getEvalSet(record.evalSetId);
  const summaries = summarizeArchitectures(record);
  const matrix = questionMatrix(record);
  const clusters = failureClusters(record);
  const decisions = buildDecisionNotes(record);
  const lines = [
    `# ${record.name}`,
    "",
    `Eval set: ${set?.name ?? record.evalSetId}`,
    `Architectures: ${record.architectureIds.join(", ")}`,
    `Reps: ${record.reps}`,
    `Profile: temperature=${record.profile.temperature ?? "default"} seed=${record.profile.seed ?? "—"}`,
    `Fingerprint: set ${record.fingerprint.evalSetHash} · profile ${record.fingerprint.profileHash}`,
    "",
    "## Executive",
    winnerLine(summaries),
    ...decisions.map((d) => `- ${d}`),
    "",
    "## Architecture means",
    "| Architecture | First | Revised | Lift | Isolation fails |",
    "|---|---:|---:|---:|---:|",
    ...summaries.map(
      (s) =>
        `| ${s.name} | ${fmt(s.meanFirst)} | ${fmt(s.meanRevised)} | ${fmt(s.meanLift)} | ${s.isolationFails} |`,
    ),
    "",
    "## Question matrix",
    `| Item | Split | ${record.architectureIds.map((id) => `${id} first / revised / lift`).join(" | ")} |`,
    `|---|---|${record.architectureIds.map(() => "---:").join("|")}|`,
    ...matrix.map((row) => {
      const cells = record.architectureIds.map((id) => {
        const cell = row.byArch[id];
        return `${fmt(cell.first)} / ${fmt(cell.revised)} / ${fmt(cell.lift)}`;
      });
      return `| ${row.itemId} | ${row.split} | ${cells.join(" | ")} |`;
    }),
    "",
    "## Failure clusters",
    clusters.length
      ? clusters
          .map(
            (c) =>
              `- ${c.tag}: ${Object.entries(c.byArch)
                .map(([arch, n]) => `${arch} ${n}`)
                .join(", ")}`,
          )
          .join("\n")
      : "(none yet)",
    "",
    "## Before / after",
    ...beforeAfterPairs(record).flatMap((pair) => [
      `### ${pair.itemId} · ${pair.architectureId} (lift ${fmt(pair.lift)})`,
      "",
      "**First**",
      pair.first || "(empty)",
      "",
      "**Revised**",
      pair.revised || "(empty)",
      "",
    ]),
  ];
  return `${lines.join("\n")}\n`;
}

export function experimentToCsv(record: ExperimentRecord): string {
  const header = [
    "itemId",
    "split",
    "architectureId",
    "rep",
    "status",
    "firstScore",
    "revisedScore",
    "lift",
    "isolationOk",
    "tags",
    "runId",
    "cellId",
  ];
  const set = getEvalSet(record.evalSetId);
  const rows = record.cells.map((cell) => {
    const item = set?.items.find((i) => i.id === cell.itemId);
    return [
      cell.itemId,
      item?.split ?? "",
      cell.architectureId,
      String(cell.rep),
      cell.status,
      cell.firstPass.score == null ? "" : String(cell.firstPass.score),
      cell.revised?.score == null ? "" : String(cell.revised.score),
      cell.lift == null ? "" : String(cell.lift),
      String(cell.firstPass.isolationOk),
      [...cell.firstPass.tags, ...(cell.revised?.tags ?? [])].join("|"),
      cell.runId,
      cell.cellId,
    ]
      .map((v) => `"${String(v).replaceAll('"', '""')}"`)
      .join(",");
  });
  return `${[header.join(","), ...rows].join("\n")}\n`;
}

export function hopApprovedForTrain(args: {
  split?: string;
  hop: HopScore;
  includeInSamples?: boolean;
}) {
  if (args.split === "held-out") return false;
  if (args.includeInSamples === false) return false;
  if (!args.hop.isolationOk) return false;
  if (args.hop.truncated) return false;
  return true;
}

export function experimentToCausalJsonl(record: ExperimentRecord): string {
  const lines: string[] = [];
  for (const cell of record.cells) {
    if (cell.status !== "done") continue;
    for (const row of cell.nodeResults) {
      if (row.kind === "merge") continue;
      if (row.kind !== "agent" && row.kind !== "router") continue;
      if (row.publish?.includeInSamples === false) continue;
      if (row.isolation?.ok === false) continue;
      if (!cell.firstPass.isolationOk && row.nodeId === STUDENT_NODE_ID) continue;
      if (row.status !== "done") continue;
      const messages = row.ingest?.messages;
      if (!messages?.length) continue;
      lines.push(
        JSON.stringify({
          kind: CAUSAL_FILE_KIND,
          schemaVersion: TRACE_SCHEMA_VERSION,
          runId: cell.runId,
          experimentId: record.id,
          itemId: cell.itemId,
          architectureId: cell.architectureId,
          nodeId: row.nodeId,
          label: row.label,
          ingestHash: row.ingestHash,
          model: row.ingest?.model ?? row.model,
          servedModel: row.servedModel,
          messages,
          output: row.output?.trim() || "",
        }),
      );
    }
  }
  return lines.length ? `${lines.join("\n")}\n` : "";
}

export function experimentToTrainJsonl(record: ExperimentRecord): string {
  const set = getEvalSet(record.evalSetId);
  const lines: string[] = [];
  for (const cell of record.cells) {
    if (cell.status !== "done") continue;
    const item = set?.items.find((i) => i.id === cell.itemId);
    if (item?.split === "held-out") continue;
    const student = cell.nodeResults.find((r) => r.nodeId === STUDENT_NODE_ID);
    if (!student) continue;
    if (
      !hopApprovedForTrain({
        split: item?.split,
        hop: cell.firstPass,
        includeInSamples: student.publish?.includeInSamples,
      })
    ) {
      continue;
    }
    const messages = student.ingest?.messages;
    if (!messages?.length || !student.output?.trim()) continue;
    lines.push(
      JSON.stringify({
        kind: TRAIN_FILE_KIND,
        schemaVersion: 1,
        experimentId: record.id,
        runId: cell.runId,
        itemId: cell.itemId,
        architectureId: cell.architectureId,
        split: item?.split,
        ingestHash: student.ingestHash,
        model: student.ingest?.model ?? student.model,
        servedModel: student.servedModel,
        messages,
        output: student.output.trim(),
      }),
    );
  }
  return lines.length ? `${lines.join("\n")}\n` : "";
}
