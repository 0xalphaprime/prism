import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { scoreHop } from "./score";
import { getEvalSet } from "./sets";

function item(id: string) {
  const found = getEvalSet("prime-leftovers.v1")?.items.find((row) => row.id === id);
  assert.ok(found, id);
  return found;
}

describe("unsupported-certainty-1 scorer", () => {
  const card = () => item("unsupported-certainty-1");

  it("passes the live baseline possessive paraphrase", () => {
    const hop = scoreHop({
      item: card(),
      output:
        "Outbound: Advent Tampa has Joey's Belli tray locked. Cables are customer-direct (no lot). No truck or coordinator on file. We do not have a first case, start date, patient count, or dollar amounts. Unclear if the Belli sternal-cable trial has started.",
    });
    assert.equal(hop.score, 1);
    assert.deepEqual(
      hop.bits.filter((b) => !b.pass).map((b) => b.id),
      [],
    );
  });

  it("still fails an announced start", () => {
    const hop = scoreHop({
      item: card(),
      output: "Joey has the Belli tray locked at Advent. They started the trial last week.",
    });
    assert.ok(hop.bits.some((b) => b.id === "no-started" && !b.pass));
  });
});

describe("prime-voice-1 scorer", () => {
  const card = () => item("prime-voice-1");

  it("passes the live baseline (we drove, follow up with Ruiz)", () => {
    const hop = scoreHop({
      item: card(),
      output:
        "We drove the Advantage add at Jackson and will follow up with Ruiz for sign-off.",
    });
    assert.equal(hop.score, 1);
    assert.ok(hop.bits.every((b) => b.pass));
  });

  it("fails when Ruiz is the actor", () => {
    const hop = scoreHop({
      item: card(),
      output: "Ruiz drove the Advantage add at Jackson and we will follow up for sign-off.",
    });
    assert.ok(hop.bits.some((b) => b.id === "no-credit-transfer" && !b.pass));
  });
});
