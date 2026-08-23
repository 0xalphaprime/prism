import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { STUDENT_LAB_HUB } from "@/lib/student-lab";
import { STUDENT_NODE_ID } from "@/lib/student-graph";
import { firehoseHits } from "./firehose";
import { cloneEvalGraph, EVAL_INFORMED_ID } from "./graphs";
import { EVAL_ATTACHED_CONTEXT, seedEvalCellGraph } from "./run-cell";
import { runnableItems, pickRunnableItems } from "./sets";
import type { EvalItem, EvalSet } from "./types";
import { EVAL_SET_FILE_KIND } from "./types";

const item: EvalItem = {
  id: "fixture-1",
  split: "train",
  tags: ["test"],
  prompt: "Internal Slack: did we flip Oak Hill?",
  allowedContext: "KEEP Colten + Mario Saturday. Do not declare Oak Hill flipped.",
  goldFacts: [],
  forbiddenClaims: [],
  bits: [],
  failureTags: [],
};

describe("eval graphs", () => {
  it("baseline is Hub + Nemo with no Knowledge/Skills channels", () => {
    const { nodes, edges } = cloneEvalGraph("eval-baseline");
    assert.equal(nodes.length, 2);
    assert.ok(nodes.some((n) => n.id === "context" && n.data.kind === "context"));
    assert.ok(nodes.some((n) => n.id === STUDENT_NODE_ID && n.data.kind === "agent"));
    assert.equal(
      nodes.filter((n) => n.data.kind === "context-source").length,
      0,
    );
    assert.deepEqual(
      edges.map((e) => `${e.source}>${e.target}`),
      [`context>${STUDENT_NODE_ID}`],
    );
  });

  it("teacher-refine Teacher has an edge from first Nemo", () => {
    const { edges } = cloneEvalGraph("eval-teacher-refine");
    assert.ok(
      edges.some((e) => e.source === STUDENT_NODE_ID && e.target === "teacher"),
    );
  });

  it("teacher-critic Teacher does not have an edge from first Nemo", () => {
    const { edges } = cloneEvalGraph("eval-teacher-critic");
    assert.ok(
      !edges.some((e) => e.source === STUDENT_NODE_ID && e.target === "teacher"),
    );
    assert.ok(
      !edges.some((e) => e.source === STUDENT_NODE_ID && e.target === "critique"),
    );
  });

  it("informed hops are excluded from samples", () => {
    for (const id of ["eval-teacher-refine", "eval-teacher-critic"] as const) {
      const { nodes } = cloneEvalGraph(id);
      const informed = nodes.find((n) => n.id === EVAL_INFORMED_ID);
      assert.equal(informed?.data.publish?.includeInSamples, false);
    }
  });
});

describe("seedEvalCellGraph", () => {
  it("sets Hub content to allowedContext only", () => {
    const seeded = seedEvalCellGraph(item, "eval-baseline");
    const hub = seeded.nodes.find((n) => n.id === "context");
    assert.equal(hub?.data.content, item.allowedContext);
    assert.ok(!hub?.data.content?.includes("brief a product team"));
    assert.ok(!item.allowedContext.includes(STUDENT_LAB_HUB.slice(0, 24)));
  });

  it("never concatenates the student-lab Hub seed", () => {
    const seeded = seedEvalCellGraph(item, "eval-teacher-critic");
    const hub = seeded.nodes.find((n) => n.id === "context");
    assert.equal(hub?.data.content, item.allowedContext);
    assert.notEqual(hub?.data.content, STUDENT_LAB_HUB);
    assert.ok(!(hub?.data.content ?? "").includes(STUDENT_LAB_HUB));
  });

  it("passes an empty attachedContext pack", () => {
    const seeded = seedEvalCellGraph(item, "eval-baseline");
    assert.deepEqual(seeded.attachedContext, []);
    assert.equal(EVAL_ATTACHED_CONTEXT.length, 0);
  });
});

describe("runnableItems", () => {
  it("ignores empty prompt shells", () => {
    const set: EvalSet = {
      kind: EVAL_SET_FILE_KIND,
      schemaVersion: 1,
      id: "prime-leftovers.v1",
      name: "test",
      description: "",
      items: [
        item,
        {
          ...item,
          id: "empty-shell",
          prompt: "",
          allowedContext: "",
        },
        {
          ...item,
          id: "prompt-only",
          allowedContext: "   ",
        },
      ],
    };
    assert.deepEqual(
      runnableItems(set).map((row) => row.id),
      ["fixture-1"],
    );
  });

  it("pickRunnableItems only queues requested ids, in that order", () => {
    const set: EvalSet = {
      kind: EVAL_SET_FILE_KIND,
      schemaVersion: 1,
      id: "prime-leftovers.v1",
      name: "test",
      description: "",
      items: [item, { ...item, id: "card-2" }, { ...item, id: "card-3" }],
    };
    assert.deepEqual(
      pickRunnableItems(set, ["card-3", "card-2"]).map((row) => row.id),
      ["card-3", "card-2"],
    );
  });

  it("pickRunnableItems refuses an empty queue", () => {
    const set: EvalSet = {
      kind: EVAL_SET_FILE_KIND,
      schemaVersion: 1,
      id: "prime-leftovers.v1",
      name: "test",
      description: "",
      items: [item],
    };
    assert.throws(
      () => pickRunnableItems(set, []),
      /Import at least one signed item/,
    );
  });

  it("pickRunnableItems refuses ids that are not runnable", () => {
    const set: EvalSet = {
      kind: EVAL_SET_FILE_KIND,
      schemaVersion: 1,
      id: "prime-leftovers.v1",
      name: "test",
      description: "",
      items: [item],
    };
    assert.throws(
      () => pickRunnableItems(set, ["missing-card"]),
      /not runnable yet/,
    );
  });
});

describe("firehose", () => {
  it("rejects CRM URLs, PAT, .env, Slack links, and Starter Hub seed", () => {
    assert.ok(firehoseHits("see https://airtable.com/appXX").includes("url"));
    assert.ok(firehoseHits("put AIRTABLE_PAT in .env.local").includes("env-file"));
    assert.ok(
      firehoseHits("thread https://acme.slack.com/archives/C123/p1").includes(
        "slack-archive",
      ),
    );
    assert.ok(
      firehoseHits("Goal: Brief a product team on visual multi-agent orchestration.").includes(
        "starter-hub-seed",
      ),
    );
    assert.deepEqual(
      firehoseHits("KEEP Colten. Do not declare Oak Hill flipped."),
      [],
    );
  });
});
