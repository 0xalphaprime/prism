import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { scoreHop } from "./score";
import { getEvalSet, runnableItems, SAMPLE_LEFTOVERS_SET_ID } from "./sets";

// Fictional sample cards only. Real-card fixtures live in *.private.test.ts (git-ignored).
function item(id: string) {
  const found = getEvalSet(SAMPLE_LEFTOVERS_SET_ID)?.items.find((row) => row.id === id);
  assert.ok(found, id);
  return found;
}

describe("sample set contracts", () => {
  it("every card's reference answer scores 1 on its own bits", () => {
    const set = getEvalSet(SAMPLE_LEFTOVERS_SET_ID);
    assert.ok(set);
    for (const card of runnableItems(set)) {
      assert.ok(card.referenceAnswer, `${card.id} has a reference answer`);
      const hop = scoreHop({ item: card, output: card.referenceAnswer });
      assert.deepEqual(
        hop.bits.filter((b) => !b.pass).map((b) => b.id),
        [],
        card.id,
      );
      assert.equal(hop.score, 1, card.id);
    }
  });
});

describe("sample-unsupported-certainty-1 scorer", () => {
  const card = () => item("sample-unsupported-certainty-1");

  it("passes a possessive paraphrase that admits the gap", () => {
    const hop = scoreHop({
      item: card(),
      output:
        "Outbound: St. Aurelia has Dana's Keel tray locked. We don't have a first case, start date, patient count, or dollar amounts.",
    });
    assert.equal(hop.score, 1);
  });

  it("still fails an announced start", () => {
    const hop = scoreHop({
      item: card(),
      output: "Dana has the Keel tray locked at St. Aurelia. They started the trial last week.",
    });
    assert.ok(hop.bits.some((b) => b.id === "no-started" && !b.pass));
  });
});

describe("sample-team-voice-1 scorer", () => {
  const card = () => item("sample-team-voice-1");

  it("passes we-drove with Ines as the follow-up", () => {
    const hop = scoreHop({
      item: card(),
      output:
        "We drove the standardization add at Northgate and will follow up with Ines for sign-off.",
    });
    assert.equal(hop.score, 1);
    assert.ok(hop.bits.every((b) => b.pass));
  });

  it("fails when Ines is the actor", () => {
    const hop = scoreHop({
      item: card(),
      output: "Ines drove the standardization add at Northgate and we will follow up for sign-off.",
    });
    assert.ok(hop.bits.some((b) => b.id === "no-credit-transfer" && !b.pass));
  });
});
