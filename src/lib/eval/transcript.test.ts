import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cardTranscript } from "./transcript";
import type { ExperimentCell, ExperimentRecord } from "./types";
import { EXPERIMENT_FILE_KIND } from "./types";

describe("cardTranscript", () => {
  it("includes prompt, hop output, and node exhaust", () => {
    const cell: ExperimentCell = {
      cellId: "c1",
      itemId: "card-1",
      architectureId: "eval-baseline",
      itemHash: "h",
      rep: 1,
      runId: "r",
      status: "done",
      firstPass: {
        output: "Nemo first hop",
        score: 0.8,
        bits: [],
        tags: [],
        isolationOk: true,
        truncated: false,
      },
      lift: null,
      traces: { firstNodeId: "student" },
      totals: {},
      nodeResults: [
        {
          nodeId: "student",
          label: "Nemo",
          status: "done",
          output: "Nemo first hop",
          ingest: {
            model: "nemo",
            messages: [{ role: "user", content: "allowed context" }],
          },
        },
      ],
    };
    const focused: ExperimentRecord = {
      kind: EXPERIMENT_FILE_KIND,
      schemaVersion: 1,
      id: "exp-1",
      name: "test",
      evalSetId: "prime-leftovers.v1",
      architectureIds: ["eval-baseline"],
      reps: 1,
      profile: {},
      fingerprint: { evalSetHash: "s", archFingerprints: {}, profileHash: "p" },
      status: "done",
      createdAt: 1,
      updatedAt: 2,
      cells: [cell],
    };
    const text = cardTranscript(focused, {
      id: "card-1",
      split: "train",
      tags: [],
      prompt: "Did we flip Oak Hill?",
      allowedContext: "Do not declare Oak Hill flipped.",
      goldFacts: [],
      forbiddenClaims: [],
      bits: [],
      failureTags: [],
    });
    assert.match(text, /Did we flip Oak Hill\?/);
    assert.match(text, /Nemo first hop/);
    assert.match(text, /exhaust/);
    assert.match(text, /allowed context/);
  });
});
