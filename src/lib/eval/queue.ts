import { executeEvalCell } from "./run-cell";
import { getEvalSet } from "./sets";
import {
  createExperimentRecord,
  experimentProgress,
  nextPendingCell,
  readExperiment,
  writeExperiment,
} from "./store";
import type { EvalArchitectureId, ExperimentProfile, ExperimentRecord } from "./types";

export async function createAndSaveExperiment(args: {
  evalSetId: string;
  architectureIds: EvalArchitectureId[];
  reps?: number;
  profile?: ExperimentProfile;
  name?: string;
}): Promise<ExperimentRecord> {
  const record = createExperimentRecord(args);
  await writeExperiment(record);
  return record;
}

export async function stepExperiment(id: string): Promise<{
  record: ExperimentRecord;
  stepped: boolean;
  progress: ReturnType<typeof experimentProgress>;
}> {
  const record = await readExperiment(id);
  if (!record) throw new Error("Experiment not found");
  const pending = nextPendingCell(record);
  if (!pending) {
    const doneStatus =
      record.cells.some((c) => c.status === "error") &&
      record.cells.every((c) => c.status === "done" || c.status === "error")
        ? "error"
        : "done";
    if (record.status !== doneStatus) {
      record.status = doneStatus;
      record.updatedAt = Date.now();
      await writeExperiment(record);
    }
    return { record, stepped: false, progress: experimentProgress(record) };
  }

  const set = getEvalSet(record.evalSetId);
  const item = set?.items.find((i) => i.id === pending.itemId);
  if (!item) throw new Error(`Missing eval item ${pending.itemId}`);

  pending.status = "running";
  record.status = "running";
  record.updatedAt = Date.now();
  await writeExperiment(record);

  const finished = await executeEvalCell({
    item,
    architectureId: pending.architectureId,
    profile: record.profile,
    experimentId: record.id,
    cellId: pending.cellId,
    runId: pending.runId,
  });

  const idx = record.cells.findIndex((c) => c.cellId === pending.cellId);
  record.cells[idx] = {
    ...finished,
    itemHash: pending.itemHash,
    rep: pending.rep,
  };
  record.updatedAt = Date.now();
  const progress = experimentProgress(record);
  record.status = progress.pending === 0 ? (progress.errors ? "error" : "done") : "running";
  await writeExperiment(record);
  return { record, stepped: true, progress };
}
