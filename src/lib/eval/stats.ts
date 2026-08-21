import { getEvalArchitecture } from "./graphs";
import { getEvalSet } from "./sets";
import type { EvalArchitectureId, ExperimentCell, ExperimentRecord } from "./types";

export type MatrixRow = {
  itemId: string;
  split: string;
  tags: string[];
  byArch: Record<
    string,
    {
      first: number | null;
      revised: number | null;
      lift: number | null;
      status: ExperimentCell["status"];
    }
  >;
};

export type ArchSummary = {
  architectureId: EvalArchitectureId;
  name: string;
  cells: number;
  meanFirst: number | null;
  meanRevised: number | null;
  meanLift: number | null;
  isolationFails: number;
};

function mean(values: Array<number | null | undefined>): number | null {
  const nums = values.filter((v): v is number => typeof v === "number");
  if (!nums.length) return null;
  return Number((nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(4));
}

export function summarizeArchitectures(record: ExperimentRecord): ArchSummary[] {
  return record.architectureIds.map((architectureId) => {
    const cells = record.cells.filter((c) => c.architectureId === architectureId);
    const finished = cells.filter((c) => c.status === "done" || c.status === "error");
    return {
      architectureId,
      name: getEvalArchitecture(architectureId)?.name ?? architectureId,
      cells: finished.length,
      meanFirst: mean(finished.map((c) => c.firstPass.score)),
      meanRevised: mean(finished.map((c) => c.revised?.score)),
      meanLift: mean(finished.map((c) => c.lift)),
      isolationFails: finished.filter(
        (c) => !c.firstPass.isolationOk || c.revised?.isolationOk === false,
      ).length,
    };
  });
}

export function winnerLine(summaries: ArchSummary[]): string {
  const scored = summaries.filter((s) => s.meanFirst != null || s.meanRevised != null);
  if (!scored.length) return "No scored cells yet.";
  const ranked = [...scored].sort((a, b) => {
    const aBest = a.meanRevised ?? a.meanFirst ?? 0;
    const bBest = b.meanRevised ?? b.meanFirst ?? 0;
    return bBest - aBest;
  });
  const top = ranked[0];
  const lift = top.meanLift != null ? ` (mean lift ${top.meanLift})` : "";
  return `${top.name} leads on mean score${lift}.`;
}

export function questionMatrix(record: ExperimentRecord): MatrixRow[] {
  const set = getEvalSet(record.evalSetId);
  const itemIds = [...new Set(record.cells.map((c) => c.itemId))];
  return itemIds.map((itemId) => {
    const item = set?.items.find((i) => i.id === itemId);
    const byArch: MatrixRow["byArch"] = {};
    for (const architectureId of record.architectureIds) {
      const cell = record.cells.find(
        (c) => c.itemId === itemId && c.architectureId === architectureId && c.rep === 1,
      );
      byArch[architectureId] = {
        first: cell?.firstPass.score ?? null,
        revised: cell?.revised?.score ?? null,
        lift: cell?.lift ?? null,
        status: cell?.status ?? "idle",
      };
    }
    return {
      itemId,
      split: item?.split ?? "",
      tags: item?.tags ?? [],
      byArch,
    };
  });
}

export function failureClusters(record: ExperimentRecord) {
  const counts = new Map<string, Record<string, number>>();
  for (const cell of record.cells) {
    if (cell.status !== "done" && cell.status !== "error") continue;
    const tags = new Set([...cell.firstPass.tags, ...(cell.revised?.tags ?? [])]);
    for (const tag of tags) {
      const row = counts.get(tag) ?? {};
      row[cell.architectureId] = (row[cell.architectureId] ?? 0) + 1;
      counts.set(tag, row);
    }
  }
  return [...counts.entries()]
    .map(([tag, byArch]) => ({ tag, byArch }))
    .sort((a, b) => {
      const as = Object.values(a.byArch).reduce((x, y) => x + y, 0);
      const bs = Object.values(b.byArch).reduce((x, y) => x + y, 0);
      return bs - as;
    });
}

export function beforeAfterPairs(record: ExperimentRecord) {
  return record.cells
    .filter(
      (c) =>
        c.architectureId !== "eval-baseline" &&
        (c.status === "done" || c.status === "error") &&
        (c.firstPass.output || c.revised?.output),
    )
    .map((c) => ({
      cellId: c.cellId,
      itemId: c.itemId,
      architectureId: c.architectureId,
      first: c.firstPass.output ?? "",
      revised: c.revised?.output ?? "",
      firstScore: c.firstPass.score,
      revisedScore: c.revised?.score ?? null,
      lift: c.lift,
    }));
}
