import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { activeItemId, experimentItemIds, focusExperiment } from "./focus";
import type { ExperimentCell, ExperimentRecord } from "./types";
import { EXPERIMENT_FILE_KIND } from "./types";

function hop() {
  return {
    score: null as number | null,
    bits: [],
    tags: [],
    isolationOk: true,
    truncated: false,
  };
}

function cell(
  itemId: string,
  architectureId: ExperimentCell["architectureId"],
  status: ExperimentCell["status"],
): ExperimentCell {
  return {
    cellId: `${itemId}-${architectureId}`,
    itemId,
    architectureId,
    itemHash: "h",
    rep: 1,
    runId: "r",
    status,
    firstPass: hop(),
    lift: null,
    traces: { firstNodeId: "student" },
    totals: {},
    nodeResults: [],
  };
}

function record(cells: ExperimentCell[]): ExperimentRecord {
  return {
    kind: EXPERIMENT_FILE_KIND,
    schemaVersion: 1,
    id: "exp-1",
    name: "test",
    evalSetId: "prime-leftovers.v1",
    architectureIds: [
      "eval-baseline",
      "eval-teacher-refine",
      "eval-teacher-critic",
    ],
    reps: 1,
    profile: {},
    fingerprint: { evalSetHash: "s", archFingerprints: {}, profileHash: "p" },
    status: "running",
    createdAt: 1,
    updatedAt: 2,
    cells,
  };
}

describe("activeItemId", () => {
  it("prefers the running cell", () => {
    const exp = record([
      cell("card-1", "eval-baseline", "done"),
      cell("card-1", "eval-teacher-refine", "done"),
      cell("card-2", "eval-baseline", "running"),
      cell("card-2", "eval-teacher-refine", "idle"),
    ]);
    assert.equal(activeItemId(exp), "card-2");
  });

  it("uses the next idle card after card 1 is done", () => {
    const exp = record([
      cell("card-1", "eval-baseline", "done"),
      cell("card-1", "eval-teacher-refine", "done"),
      cell("card-1", "eval-teacher-critic", "done"),
      cell("card-2", "eval-baseline", "idle"),
      cell("card-2", "eval-teacher-refine", "idle"),
    ]);
    assert.equal(activeItemId(exp), "card-2");
  });

  it("falls back to the last cell when the queue is finished", () => {
    const exp = record([
      cell("card-1", "eval-baseline", "done"),
      cell("card-2", "eval-baseline", "done"),
    ]);
    assert.equal(activeItemId(exp), "card-2");
  });
});

describe("focusExperiment", () => {
  it("drops cells for other leftover ids", () => {
    const exp = record([
      cell("card-1", "eval-baseline", "done"),
      cell("card-2", "eval-baseline", "idle"),
      cell("card-2", "eval-teacher-refine", "idle"),
    ]);
    const focused = focusExperiment(exp, "card-2");
    assert.deepEqual(
      focused.cells.map((c) => c.itemId),
      ["card-2", "card-2"],
    );
    assert.deepEqual(experimentItemIds(focused), ["card-2"]);
    assert.equal(exp.cells.length, 3);
  });
});
