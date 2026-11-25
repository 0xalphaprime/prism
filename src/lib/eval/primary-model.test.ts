import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SAMPLE_STUDENT_SEED_ID,
  STUDENT_LAB_HUB,
  STUDENT_LAB_PROMPT,
  STUDENT_LAB_SEED_ID,
} from "@/lib/student-lab";
import { STUDENT_MODEL } from "@/lib/student-graph";
import {
  DEFAULT_MODEL_BY_PROVIDER,
  MODEL_OPTIONS,
  PRIMARY_MODEL,
  PRIOR_STUDENT_MODEL,
} from "@/lib/providers";
import { BUILT_IN_PRESETS } from "@/lib/node-presets";
import { EVAL_ARCHITECTURES } from "./graphs";
import { getEvalSet, SAMPLE_LEFTOVERS_SET_ID } from "./sets";

const expectedPrimary = `ollama:${process.env.PRIMARY_MODEL?.trim() || "muse-glimmer:30b"}`;

describe("Foundry PRIMARY defaults", () => {
  it("student and Ollama default resolve to PRIMARY (Muse), not Lightning", () => {
    assert.equal(PRIMARY_MODEL, expectedPrimary);
    assert.equal(STUDENT_MODEL, PRIMARY_MODEL);
    assert.equal(DEFAULT_MODEL_BY_PROVIDER.ollama, PRIMARY_MODEL);
    assert.notEqual(STUDENT_MODEL, PRIOR_STUDENT_MODEL);
  });

  it("catalog lists PRIMARY first among Ollama and keeps Lightning opt-in", () => {
    const ollama = MODEL_OPTIONS.filter((m) => m.provider === "ollama");
    assert.equal(ollama[0]?.ref, PRIMARY_MODEL);
    assert.ok(MODEL_OPTIONS.some((m) => m.ref === "ollama:muse128"));
    assert.ok(MODEL_OPTIONS.some((m) => m.ref === PRIOR_STUDENT_MODEL));
  });

  it("no built-in student lane silently defaults to Lightning", () => {
    const students = [
      ...BUILT_IN_PRESETS.map((p) => p.data.model),
      ...EVAL_ARCHITECTURES.flatMap((a) => a.nodes.map((n) => n.data.model)),
    ].filter((m) => m?.startsWith("ollama:"));
    assert.ok(students.length > 0);
    for (const model of students) assert.equal(model, PRIMARY_MODEL);
  });
});

describe("student lab seed", () => {
  it("defaults to the fictional sample polarity card", () => {
    const set = getEvalSet(SAMPLE_LEFTOVERS_SET_ID);
    assert.ok(set);
    assert.equal(STUDENT_LAB_SEED_ID, SAMPLE_STUDENT_SEED_ID);
    const item = set.items.find((i) => i.id === STUDENT_LAB_SEED_ID);
    assert.ok(item);
    assert.equal(STUDENT_LAB_PROMPT, item.prompt);
    assert.equal(STUDENT_LAB_HUB, item.allowedContext);
  });
});
