import type { ExperimentRecord } from "./types";

/** Leftover currently on the lab floor. */
export function activeItemId(record: ExperimentRecord): string | undefined {
  const running = record.cells.find((cell) => cell.status === "running");
  if (running) return running.itemId;
  const pending = record.cells.find(
    (cell) => cell.status === "idle" || cell.status === "ready",
  );
  if (pending) return pending.itemId;
  for (let i = record.cells.length - 1; i >= 0; i -= 1) {
    const cell = record.cells[i];
    if (cell) return cell.itemId;
  }
  return undefined;
}

/** Same experiment, cells for one leftover only. Disk record is unchanged. */
export function focusExperiment(
  record: ExperimentRecord,
  itemId: string,
): ExperimentRecord {
  return {
    ...record,
    cells: record.cells.filter((cell) => cell.itemId === itemId),
  };
}

export function experimentItemIds(record: ExperimentRecord): string[] {
  return [...new Set(record.cells.map((cell) => cell.itemId))];
}
