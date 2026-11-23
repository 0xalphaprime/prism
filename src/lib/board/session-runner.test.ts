import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { ReadFn, SearchFn } from "./research";
import {
  runNotesStep,
  runPlanStep,
  runResearchStep,
  skipResearch,
  type BoardChatFn,
  type RunnerDeps,
} from "./session-runner";
import { createSession, deleteSession, listSessions, readSessionView, sessionDir } from "./session-store";
import { BoardStoreError, createMember, updateMember } from "./store";

let root = "";

type Call = { model: string; system: string; user: string; maxTokens: number };

function stubs(overrides: Partial<RunnerDeps> = {}) {
  const chats: Call[] = [];
  const searches: string[] = [];
  const reads: string[] = [];
  const chat: BoardChatFn = async (args) => {
    chats.push(args);
    const name = args.system.match(/^You are ([^,]+),/)?.[1] ?? "?";
    if (args.user.includes("# Your task: search plan")) {
      return {
        content: JSON.stringify({
          queries: [
            { query: `${name} first search`, why: "because" },
            { query: `${name} second search`, why: "because" },
          ],
        }),
        model: "stub:model",
      };
    }
    return { content: `NOTES-BY-${name.toUpperCase()}`, model: "stub:model" };
  };
  const search: SearchFn = async (query) => {
    searches.push(query);
    return [
      { url: `https://pages.example/${encodeURIComponent(query)}`, title: `About ${query}`, description: "" },
      { url: "https://pages.example/shared-report", title: "Shared report", description: "" },
    ];
  };
  const read: ReadFn = async (url) => {
    reads.push(url);
    return { text: `PAGE-TEXT-FOR ${url}`, via: "stub" };
  };
  let tick = 1_000;
  const deps: RunnerDeps = { chat, search, read, root, now: () => (tick += 1), ...overrides };
  return { deps, chats, searches, reads };
}

async function seed(draft: Partial<Parameters<typeof createSession>[0]> = {}) {
  await createMember(
    { name: "Skeptic", title: "Finds the flaw.", profile: "SKEPTIC-PROFILE", directives: "SKEPTIC-DIRECTIVES" },
    root,
  );
  await createMember(
    { name: "Operator", title: "Gets it done.", profile: "OPERATOR-PROFILE", directives: "OPERATOR-DIRECTIVES" },
    root,
  );
  return createSession(
    {
      question: "Should we raise prices?",
      material: "The shared material.",
      model: "stub:model",
      members: ["skeptic", "operator"],
      ...draft,
    },
    root,
    Date.UTC(2026, 10, 23, 9, 5),
  );
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "prism-board-session-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("sessions on disk", () => {
  it("writes a readable folder with a copy of each member", async () => {
    const meta = await seed();
    assert.match(meta.id, /^20261123-0905-should-we-raise-prices-[a-z0-9]{4}$/);
    const dir = sessionDir(meta.id, root);
    assert.ok(existsSync(path.join(dir, "session.json")));
    const copy = JSON.parse(readFileSync(path.join(dir, "members", "skeptic", "member.json"), "utf8"));
    assert.equal(copy.profile, "SKEPTIC-PROFILE");
    assert.equal(meta.title, "Should we raise prices?");
    assert.deepEqual(meta.limits, { searches: 4, pagesPerSearch: 2, pageChars: 6000 });
  });

  it("keeps the member as they were when the session started", async () => {
    const meta = await seed();
    await updateMember("skeptic", { profile: "CHANGED-LATER" }, root);
    const { deps, chats } = stubs();
    await runPlanStep(meta.id, "skeptic", deps);
    assert.ok(chats[0].system.includes("SKEPTIC-PROFILE"));
    assert.ok(!chats[0].system.includes("CHANGED-LATER"));
  });

  it("refuses a session with no question, no model, or an unknown member", async () => {
    await seed();
    const base = { question: "q", model: "m", members: ["skeptic"] };
    await assert.rejects(createSession({ ...base, question: " " }, root), BoardStoreError);
    await assert.rejects(createSession({ ...base, model: "" }, root), BoardStoreError);
    await assert.rejects(createSession({ ...base, members: [] }, root), BoardStoreError);
    await assert.rejects(createSession({ ...base, members: ["nobody"] }, root), BoardStoreError);
    await assert.rejects(createSession({ ...base, members: ["../x"] }, root), BoardStoreError);
  });

  it("lists sessions newest first and moves removed ones to the trash", async () => {
    const meta = await seed();
    assert.deepEqual((await listSessions(root)).map((s) => s.id), [meta.id]);
    const { trashedTo } = await deleteSession(meta.id, root);
    assert.ok(existsSync(trashedTo));
    assert.deepEqual(await listSessions(root), []);
  });

  it("turns approval on for a sensitive decision", async () => {
    const meta = await seed({ sensitive: true });
    assert.equal(meta.approveSearches, true);
  });
});

describe("plan, research, notes", () => {
  it("runs the three steps for one member and saves each result", async () => {
    const meta = await seed();
    const { deps, chats, searches, reads } = stubs();

    assert.deepEqual(await runPlanStep(meta.id, "skeptic", deps), { ok: true });
    let view = await readSessionView(meta.id, root);
    let skeptic = view.members[0];
    assert.equal(skeptic.state.steps.plan.status, "done");
    assert.equal(skeptic.plan?.approved, true);
    assert.deepEqual(skeptic.plan?.queries.map((q) => q.query), ["Skeptic first search", "Skeptic second search"]);
    assert.equal(searches.length, 0, "planning never searches");

    assert.deepEqual(await runResearchStep(meta.id, "skeptic", deps), { ok: true });
    assert.deepEqual(searches, ["Skeptic first search", "Skeptic second search"]);
    assert.equal(reads.length, 3, "the shared page is read once");

    assert.deepEqual(await runNotesStep(meta.id, "skeptic", deps), { ok: true });
    view = await readSessionView(meta.id, root);
    skeptic = view.members[0];
    assert.equal(skeptic.notes?.trim(), "NOTES-BY-SKEPTIC");
    assert.equal(skeptic.state.steps.notes.model, "stub:model");
    assert.ok(skeptic.state.steps.notes.saw?.includes("Own research: 3 pages (S1 to S3)"));
    assert.equal(chats.length, 2);
    assert.ok(chats.every((c) => c.maxTokens > 0 && c.model === "stub:model"));

    const dir = path.join(sessionDir(meta.id, root), "members", "skeptic");
    for (const file of ["plan.json", "research.json", "notes.md", "state.json"]) {
      assert.ok(existsSync(path.join(dir, file)), file);
    }
  });

  it("keeps each member in their own compartment", async () => {
    const meta = await seed();
    const { deps, chats } = stubs();
    for (const slug of ["skeptic", "operator"]) {
      await runPlanStep(meta.id, slug, deps);
      await runResearchStep(meta.id, slug, deps);
      await runNotesStep(meta.id, slug, deps);
    }
    const operatorCalls = chats.filter((c) => c.system.startsWith("You are Operator,"));
    assert.equal(operatorCalls.length, 2);
    for (const call of operatorCalls) {
      const text = `${call.system}\n${call.user}`;
      for (const leak of ["SKEPTIC-PROFILE", "SKEPTIC-DIRECTIVES", "Skeptic first search", "NOTES-BY-SKEPTIC"]) {
        assert.ok(!text.includes(leak), leak);
      }
      assert.ok(call.user.includes("The shared material."));
    }
    const notesCall = operatorCalls[1];
    assert.ok(notesCall.user.includes("PAGE-TEXT-FOR https://pages.example/Operator%20first%20search"));
    assert.ok(!notesCall.user.includes("Skeptic%20first%20search"));

    const view = await readSessionView(meta.id, root);
    assert.equal(view.overlap.shared.length, 1);
    assert.equal(view.overlap.shared[0].url, "https://pages.example/shared-report");
    assert.equal(view.overlap.distinct, 5);
  });

  it("uses a member's own model when they have one", async () => {
    const meta = await seed();
    await createMember({ name: "Own model", title: "", profile: "p", directives: "d", model: "other:model" }, root);
    const session = await createSession(
      { question: "q", model: "stub:model", members: ["own-model"] },
      root,
    );
    const { deps, chats } = stubs();
    await runPlanStep(session.id, "own-model", deps);
    assert.equal(chats[0].model, "other:model");
    assert.ok(meta.id !== session.id);
  });

  it("holds searches until the owner approves when approval is on", async () => {
    const meta = await seed({ approveSearches: true });
    const { deps, searches } = stubs();
    await runPlanStep(meta.id, "skeptic", deps);
    assert.equal((await readSessionView(meta.id, root)).members[0].plan?.approved, false);

    await assert.rejects(runResearchStep(meta.id, "skeptic", deps), /waiting for your approval/);
    assert.equal(searches.length, 0);

    await runResearchStep(meta.id, "skeptic", deps, {
      approve: true,
      queries: [{ query: "owner rewrote this", why: "" }],
    });
    assert.deepEqual(searches, ["owner rewrote this"]);
    const plan = (await readSessionView(meta.id, root)).members[0].plan;
    assert.equal(plan?.editedByOwner, true);
    assert.equal(plan?.approved, true);
  });

  it("holds a search that repeats a name from the material even when approval is off", async () => {
    const meta = await seed({ material: "Our biggest customer is Northwind Traders." });
    const { deps, searches } = stubs({
      chat: async () => ({ content: '{"queries":[{"query":"Northwind Traders complaints"}]}' }),
    });
    await runPlanStep(meta.id, "skeptic", deps);
    const plan = (await readSessionView(meta.id, root)).members[0].plan;
    assert.equal(plan?.approved, false);
    assert.deepEqual(plan?.flagged[0].terms.sort(), ["northwind", "traders"]);
    await assert.rejects(runResearchStep(meta.id, "skeptic", deps), /waiting for your approval/);
    assert.equal(searches.length, 0);
  });

  it("never runs more searches than the limit, even if the owner sends more", async () => {
    const meta = await seed({ limits: { searches: 2 } });
    const { deps, searches } = stubs();
    await runPlanStep(meta.id, "skeptic", deps);
    await runResearchStep(meta.id, "skeptic", deps, { queries: ["a", "b", "c", "d"], approve: true });
    assert.deepEqual(searches, ["a", "b"]);
  });

  it("will not research before a plan, or take notes before research", async () => {
    const meta = await seed();
    const { deps } = stubs();
    await assert.rejects(runResearchStep(meta.id, "skeptic", deps), /search plan has to be written first/);
    await runPlanStep(meta.id, "skeptic", deps);
    await assert.rejects(runNotesStep(meta.id, "skeptic", deps), /Research has to finish first/);
    await assert.rejects(runPlanStep(meta.id, "nobody", deps), /not part of the session/);
    await assert.rejects(runPlanStep("missing", "skeptic", deps), /Session not found/);
  });

  it("saves a model failure on the step so it can be retried", async () => {
    const meta = await seed();
    const { deps } = stubs({
      chat: async () => {
        throw new Error("model down");
      },
    });
    assert.deepEqual(await runPlanStep(meta.id, "skeptic", deps), { ok: false, error: "model down" });
    const step = (await readSessionView(meta.id, root)).members[0].state.steps.plan;
    assert.equal(step.status, "error");
    assert.equal(step.error, "model down");

    assert.deepEqual(await runPlanStep(meta.id, "skeptic", stubs().deps), { ok: true });
  });

  it("fails the research step when every search fails, and lets the member go on without research", async () => {
    const meta = await seed();
    const { deps } = stubs({
      search: async () => {
        throw new Error("No search key found.");
      },
    });
    await runPlanStep(meta.id, "skeptic", deps);
    assert.deepEqual(await runResearchStep(meta.id, "skeptic", deps), {
      ok: false,
      error: "No search key found.",
    });
    await skipResearch(meta.id, "skeptic", { root });
    const steps = (await readSessionView(meta.id, root)).members[0].state.steps;
    assert.equal(steps.research.status, "skipped");
    assert.equal(steps.notes.status, "skipped");
  });

  it("clears later steps when an earlier one is run again", async () => {
    const meta = await seed();
    const { deps } = stubs();
    await runPlanStep(meta.id, "skeptic", deps);
    await runResearchStep(meta.id, "skeptic", deps);
    await runNotesStep(meta.id, "skeptic", deps);
    await runPlanStep(meta.id, "skeptic", deps);
    const member = (await readSessionView(meta.id, root)).members[0];
    assert.equal(member.state.steps.research.status, "idle");
    assert.equal(member.state.steps.notes.status, "idle");
    assert.equal(member.research, null);
    assert.equal(member.notes, null);
  });

  it("refuses to start a step that is already running, unless forced", async () => {
    const meta = await seed();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { deps } = stubs({
      chat: async () => {
        await gate;
        return { content: '{"queries":[]}' };
      },
    });
    const first = runPlanStep(meta.id, "skeptic", deps);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await assert.rejects(runPlanStep(meta.id, "skeptic", deps), /already running/);
    release();
    assert.deepEqual(await first, { ok: true });
  });

  it("writes no notes prompt when nothing was read", async () => {
    const meta = await seed();
    const { deps, chats } = stubs({ search: async () => [] });
    await runPlanStep(meta.id, "skeptic", deps);
    await runResearchStep(meta.id, "skeptic", deps);
    await runNotesStep(meta.id, "skeptic", deps);
    assert.equal(chats.length, 1);
    assert.match((await readSessionView(meta.id, root)).members[0].notes ?? "", /No pages were read/);
  });
});
