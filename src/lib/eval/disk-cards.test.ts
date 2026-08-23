import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { listSignedDiskCards, readSignedDiskCard, safeCardId } from "./disk-cards";

describe("safeCardId", () => {
  it("accepts signed card ids", () => {
    assert.equal(safeCardId("unsupported-certainty-1"), "unsupported-certainty-1");
  });

  it("rejects path traversal", () => {
    assert.equal(safeCardId("../secret"), null);
    assert.equal(safeCardId("foo/bar"), null);
    assert.equal(safeCardId("foo.json"), null);
  });
});

describe("readSignedDiskCard", () => {
  it("reads a JSON object from a directory and blocks traversal", () => {
    const dir = path.join(tmpdir(), `prism-eval-cards-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, "card-1.json"),
      `${JSON.stringify({ id: "card-1", prompt: "hi" })}\n`,
    );
    try {
      assert.deepEqual(readSignedDiskCard("card-1", dir), {
        id: "card-1",
        prompt: "hi",
      });
      assert.deepEqual(listSignedDiskCards(dir), ["card-1"]);
      assert.throws(() => readSignedDiskCard("../card-1", dir), /Invalid card id/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
