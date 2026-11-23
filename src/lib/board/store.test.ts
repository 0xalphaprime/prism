import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { STARTER_MEMBERS } from "./starters";
import {
  BoardStoreError,
  createMember,
  deleteMember,
  deleteMemberFile,
  duplicateMember,
  listMembers,
  readMember,
  restoreMissingStarters,
  safeFileName,
  safeSlug,
  saveMemberFile,
  seedStartersOnFirstRun,
  slugify,
  updateMember,
} from "./store";

let root = "";

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "prism-board-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const draft = {
  name: "Field Marshal",
  title: "Accountable for logistics.",
  profile: "## Background\nYou move things.",
  directives: "## Questions you always chase\n- How far?",
};

describe("names and ids", () => {
  it("turns a name into a folder-safe id", () => {
    assert.equal(slugify("  Capital Allocator!  "), "capital-allocator");
    assert.equal(slugify("Ünïcode & Co."), "u-ni-code-co");
    assert.equal(slugify("***"), "member");
  });

  it("rejects ids that could leave the members folder", () => {
    assert.equal(safeSlug("skeptic"), "skeptic");
    assert.equal(safeSlug("../skeptic"), null);
    assert.equal(safeSlug("a/b"), null);
    assert.equal(safeSlug(".trash"), null);
    assert.equal(safeSlug(""), null);
  });

  it("normalises living-file names and rejects paths", () => {
    assert.equal(safeFileName("Lessons"), "lessons.md");
    assert.equal(safeFileName("past bets.md"), "past-bets.md");
    assert.equal(safeFileName("../secrets.md"), null);
    assert.equal(safeFileName("a/b.md"), null);
    assert.equal(safeFileName(""), null);
  });
});

describe("members on disk", () => {
  it("writes a member as plain files and reads it back", async () => {
    const made = await createMember(draft, root, 1000);
    assert.equal(made.slug, "field-marshal");
    const dir = path.join(root, "members", "field-marshal");
    assert.equal(readFileSync(path.join(dir, "profile.md"), "utf8"), draft.profile);
    assert.equal(readFileSync(path.join(dir, "directives.md"), "utf8"), draft.directives);
    const meta = JSON.parse(readFileSync(path.join(dir, "member.json"), "utf8"));
    assert.deepEqual(meta, {
      slug: "field-marshal",
      name: "Field Marshal",
      title: "Accountable for logistics.",
      createdAt: 1000,
      updatedAt: 1000,
    });
    const read = await readMember("field-marshal", root);
    assert.equal(read?.profile, draft.profile);
    assert.equal(read?.directives, draft.directives);
    assert.deepEqual(read?.files, []);
  });

  it("picks up edits made directly to the files", async () => {
    await createMember(draft, root);
    const dir = path.join(root, "members", "field-marshal");
    writeFileSync(path.join(dir, "profile.md"), "edited by hand");
    writeFileSync(path.join(dir, "files", "lessons.md"), "- 2026: learned something");
    const read = await readMember("field-marshal", root);
    assert.equal(read?.profile, "edited by hand");
    assert.equal(read?.files.length, 1);
    assert.equal(read?.files[0].name, "lessons.md");
  });

  it("reads a folder made by hand that has no member.json", async () => {
    const dir = path.join(root, "members", "night-watch");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "profile.md"), "You keep watch.");
    const read = await readMember("night-watch", root);
    assert.equal(read?.name, "Night watch");
    assert.equal(read?.profile, "You keep watch.");
    assert.equal(read?.directives, "");
    assert.equal((await listMembers(root)).length, 1);
  });

  it("keeps the folder name when a member is renamed", async () => {
    await createMember(draft, root, 1000);
    const updated = await updateMember(
      "field-marshal",
      { name: "Quartermaster", profile: "new profile" },
      root,
      2000,
    );
    assert.equal(updated.slug, "field-marshal");
    assert.equal(updated.name, "Quartermaster");
    assert.equal(updated.profile, "new profile");
    assert.equal(updated.directives, draft.directives);
    assert.equal(updated.createdAt, 1000);
    assert.equal(updated.updatedAt, 2000);
  });

  it("stores and clears a model override", async () => {
    await createMember(draft, root);
    const withModel = await updateMember("field-marshal", { model: "openai:gpt-4o" }, root);
    assert.equal(withModel.model, "openai:gpt-4o");
    const cleared = await updateMember("field-marshal", { model: "" }, root);
    assert.equal(cleared.model, undefined);
  });

  it("gives a second member with the same name its own folder", async () => {
    const a = await createMember(draft, root);
    const b = await createMember(draft, root);
    assert.equal(a.slug, "field-marshal");
    assert.equal(b.slug, "field-marshal-2");
  });

  it("duplicates a member with its living files", async () => {
    await createMember(draft, root);
    await saveMemberFile("field-marshal", "Lessons", "- one", root);
    const copy = await duplicateMember("field-marshal", root);
    assert.equal(copy.name, "Field Marshal (copy)");
    assert.equal(copy.slug, "field-marshal-copy");
    assert.equal(copy.profile, draft.profile);
    assert.deepEqual(
      copy.files.map((f) => [f.name, f.content]),
      [["lessons.md", "- one"]],
    );
    await updateMember(copy.slug, { profile: "changed" }, root);
    assert.equal((await readMember("field-marshal", root))?.profile, draft.profile);
  });

  it("moves a deleted member to the trash instead of erasing it", async () => {
    await createMember(draft, root);
    const { trashedTo } = await deleteMember("field-marshal", root, 5000);
    assert.equal(await readMember("field-marshal", root), null);
    assert.deepEqual(await listMembers(root), []);
    assert.equal(readFileSync(path.join(trashedTo, "profile.md"), "utf8"), draft.profile);
  });

  it("saves and removes living files", async () => {
    await createMember(draft, root);
    const saved = await saveMemberFile("field-marshal", "past bets", "- a bet", root);
    assert.deepEqual(
      saved.files.map((f) => f.name),
      ["past-bets.md"],
    );
    const removed = await deleteMemberFile("field-marshal", "past-bets.md", root);
    assert.deepEqual(removed.files, []);
  });

  it("refuses bad input", async () => {
    await assert.rejects(createMember({ ...draft, name: "  " }, root), BoardStoreError);
    await assert.rejects(updateMember("nobody", { title: "x" }, root), /not found/);
    await assert.rejects(updateMember("../x", { title: "x" }, root), /Invalid member id/);
    await createMember(draft, root);
    await assert.rejects(
      saveMemberFile("field-marshal", "../../escape", "x", root),
      /File names/,
    );
    assert.equal(existsSync(path.join(root, "escape.md")), false);
  });
});

describe("starter members", () => {
  it("seeds the four starters once, in order", async () => {
    assert.equal(await seedStartersOnFirstRun(root, 1000), true);
    const members = await listMembers(root);
    assert.deepEqual(
      members.map((m) => m.name),
      ["Capital allocator", "Customer voice", "Operator", "Skeptic"],
    );
    for (const m of members) {
      assert.ok(m.profileChars > 1200, `${m.name} profile is substantial`);
      assert.ok(m.directivesChars > 500, `${m.name} directives are substantial`);
      assert.equal(m.fileCount, 1);
    }
    assert.equal(await seedStartersOnFirstRun(root), false);
  });

  it("does not bring a deleted starter back on its own", async () => {
    await seedStartersOnFirstRun(root);
    await deleteMember("skeptic", root);
    assert.equal(await seedStartersOnFirstRun(root), false);
    assert.equal((await listMembers(root)).length, 3);
  });

  it("restores only the starters that are missing and never overwrites", async () => {
    await seedStartersOnFirstRun(root);
    await updateMember("operator", { profile: "mine now" }, root);
    await deleteMember("skeptic", root);
    const added = await restoreMissingStarters(root);
    assert.deepEqual(added, ["skeptic"]);
    assert.equal((await readMember("operator", root))?.profile, "mine now");
    assert.equal((await listMembers(root)).length, 4);
  });

  it("gives every starter all the sections a member needs", () => {
    for (const s of STARTER_MEMBERS) {
      for (const heading of [
        "## Background",
        "## What you believe",
        "## How you weigh evidence",
        "## What you tend to miss",
      ]) {
        assert.ok(s.profile.includes(heading), `${s.name} profile has ${heading}`);
      }
      for (const heading of [
        "## Questions you always chase",
        "## Sources you trust",
        "## Sources you distrust",
        "## What would prove you wrong",
      ]) {
        assert.ok(s.directives.includes(heading), `${s.name} directives have ${heading}`);
      }
    }
  });

  it("leaves no temp files behind", async () => {
    await seedStartersOnFirstRun(root);
    const leftovers = readdirSync(path.join(root, "members", "skeptic")).filter((n) =>
      n.endsWith(".tmp"),
    );
    assert.deepEqual(leftovers, []);
  });
});
