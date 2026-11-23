import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { ReadFn, SearchFn } from "./research";
import {
  runChairStep,
  runGeneralistMemoStep,
  runGeneralistPlanStep,
  runGeneralistResearchStep,
  runNotesStep,
  runOpinionStep,
  runPlanStep,
  runResearchStep,
  setDropped,
  skipResearch,
  type BoardChatFn,
  type RunnerDeps,
} from "./session-runner";
import {
  createSession,
  listSessions,
  readSessionView,
  readStanding,
  sessionDir,
  writeStanding,
} from "./session-store";
import { createMember } from "./store";
import type { SessionDraft } from "./types";

let root = "";

type Call = { who: string; task: string; system: string; user: string; model: string };

function stubs(overrides: Partial<RunnerDeps> = {}) {
  const chats: Call[] = [];
  const searches: string[] = [];
  const chat: BoardChatFn = async (args) => {
    const who = args.system.match(/^You are (?:the )?([^,.\n]+)/)?.[1] ?? "?";
    const task = [...args.user.matchAll(/^# Your task: (.+)$/gm)].pop()?.[1] ?? "";
    chats.push({ who, task, system: args.system, user: args.user, model: args.model });
    const tag = who.toUpperCase().replace(/\s+/g, "-");
    if (task === "search plan") {
      return { content: JSON.stringify({ queries: [{ query: `${who} search one` }, { query: `${who} search two` }] }) };
    }
    if (task === "research notes") return { content: `NOTES-BY-${tag} [S1]` };
    if (task === "opinion") return { content: `OPINION-BY-${tag} citing [S1]` };
    if (task === "board memo") return { content: "CHAIR-MEMO" };
    if (task === "generalist memo") return { content: "GENERALIST-MEMO" };
    return { content: "?" };
  };
  const search: SearchFn = async (query) => {
    searches.push(query);
    return [{ url: `https://pages.example/${encodeURIComponent(query)}`, title: `About ${query}`, description: "" }];
  };
  const read: ReadFn = async (url) => ({ text: `PAGE-TEXT ${url}`, via: "stub" });
  let tick = 5_000;
  const deps: RunnerDeps = { chat, search, read, root, now: () => (tick += 1), ...overrides };
  return { deps, chats, searches };
}

async function seed(draft: Partial<SessionDraft> = {}) {
  for (const name of ["Skeptic", "Operator", "Customer voice"]) {
    await createMember(
      {
        name,
        title: `${name} title.`,
        profile: `${name.toUpperCase()}-PROFILE`,
        directives: `${name.toUpperCase()}-DIRECTIVES`,
      },
      root,
    );
  }
  return createSession(
    {
      kind: "board",
      question: "Should we raise prices?",
      material: "The shared material.",
      model: "stub:model",
      members: ["skeptic", "operator"],
      ...draft,
    },
    root,
  );
}

async function toOpinion(id: string, slug: string, deps: RunnerDeps) {
  await runPlanStep(id, slug, deps);
  await runResearchStep(id, slug, deps);
  await runNotesStep(id, slug, deps);
  return runOpinionStep(id, slug, deps);
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "prism-board-full-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("a standard board session", () => {
  it("runs research, blind opinions and the Chair memo, saving each to disk", async () => {
    const meta = await seed();
    const { deps, chats } = stubs();
    assert.deepEqual(await toOpinion(meta.id, "skeptic", deps), { ok: true });
    assert.deepEqual(await toOpinion(meta.id, "operator", deps), { ok: true });
    assert.deepEqual(await runChairStep(meta.id, deps), { ok: true });

    const view = await readSessionView(meta.id, root);
    assert.equal(view.sealed, false);
    assert.equal(view.chair?.memo?.trim(), "CHAIR-MEMO");
    assert.equal(view.members[0].opinion?.trim(), "OPINION-BY-SKEPTIC citing [S1]");
    const dir = sessionDir(meta.id, root);
    for (const file of ["chair.md", "chair.json", "members/skeptic/opinion.md", "members/operator/notes.md"]) {
      assert.ok(existsSync(path.join(dir, file)), file);
    }
    assert.equal(chats.length, 7);
    assert.equal((await listSessions(root))[0].finished, true);
  });

  it("keeps every opinion blind: a member never sees another member's work", async () => {
    const meta = await seed();
    const { deps, chats } = stubs();
    await toOpinion(meta.id, "skeptic", deps);
    await toOpinion(meta.id, "operator", deps);
    const operator = chats.filter((c) => c.who === "Operator");
    assert.equal(operator.length, 3);
    for (const call of operator) {
      const text = `${call.system}\n${call.user}`;
      for (const leak of ["SKEPTIC-PROFILE", "SKEPTIC-DIRECTIVES", "Skeptic search", "NOTES-BY-SKEPTIC", "OPINION-BY-SKEPTIC"]) {
        assert.ok(!text.includes(leak), `${call.task}: ${leak}`);
      }
    }
    const opinion = operator.find((c) => c.task === "opinion");
    assert.ok(opinion?.user.includes("NOTES-BY-OPERATOR"));
    assert.ok(opinion?.user.includes("The shared material."));
  });

  it("gives the Chair opinions and cited sources, not notes, pages or personalities", async () => {
    const meta = await seed();
    const { deps, chats } = stubs();
    await toOpinion(meta.id, "skeptic", deps);
    await toOpinion(meta.id, "operator", deps);
    await runChairStep(meta.id, deps);
    const chair = chats.find((c) => c.task === "board memo");
    assert.ok(chair);
    const text = `${chair.system}\n${chair.user}`;
    assert.ok(text.includes("OPINION-BY-SKEPTIC") && text.includes("OPINION-BY-OPERATOR"));
    assert.ok(text.includes("Sources Skeptic cited:\n- [S1] About Skeptic search one"));
    for (const leak of ["NOTES-BY-", "PAGE-TEXT", "SKEPTIC-PROFILE", "OPERATOR-DIRECTIVES"]) {
      assert.ok(!text.includes(leak), leak);
    }
    const saw = (await readSessionView(meta.id, root)).chair?.state.memo.saw ?? [];
    assert.ok(saw.includes("Opinion: Skeptic") && saw.includes("Sources cited by Operator (1)"));
  });

  it("seals notes and opinions until every member has answered", async () => {
    const meta = await seed();
    const { deps } = stubs();
    await toOpinion(meta.id, "skeptic", deps);
    let view = await readSessionView(meta.id, root);
    assert.equal(view.sealed, true);
    assert.equal(view.members[0].state.steps.opinion.status, "done");
    assert.equal(view.members[0].opinion, null);
    assert.equal(view.members[0].notes, null);
    assert.ok(view.members[0].research, "the research trail stays visible");

    await toOpinion(meta.id, "operator", deps);
    view = await readSessionView(meta.id, root);
    assert.equal(view.sealed, false);
    assert.ok(view.members[0].opinion && view.members[0].notes);
  });

  it("makes the Chair wait for every opinion, unless the owner goes on without a member", async () => {
    const meta = await seed();
    const { deps, chats } = stubs();
    await toOpinion(meta.id, "skeptic", deps);
    await assert.rejects(runChairStep(meta.id, deps), /Operator has not given an opinion yet/);

    await setDropped(meta.id, "operator", true, { root });
    assert.deepEqual(await runChairStep(meta.id, deps), { ok: true });
    const chair = chats.find((c) => c.task === "board memo");
    assert.ok(!chair?.user.includes("Operator"));
    assert.equal((await readSessionView(meta.id, root)).sealed, false);

    await assert.rejects(setDropped(meta.id, "skeptic", true, { root }), /At least one member/);
  });

  it("marks the Chair memo out of date when an opinion changes or a member returns", async () => {
    const meta = await seed();
    const { deps } = stubs();
    await toOpinion(meta.id, "skeptic", deps);
    await toOpinion(meta.id, "operator", deps);
    await runChairStep(meta.id, deps);

    await runOpinionStep(meta.id, "skeptic", deps);
    let view = await readSessionView(meta.id, root);
    assert.equal(view.chair?.state.memo.status, "idle");
    assert.equal(view.chair?.memo, null);

    await runChairStep(meta.id, deps);
    await setDropped(meta.id, "operator", true, { root });
    view = await readSessionView(meta.id, root);
    assert.equal(view.chair?.state.memo.status, "idle");
  });

  it("lets a member give an opinion from the shared material when research is skipped", async () => {
    const meta = await seed();
    const { deps, chats } = stubs();
    await runPlanStep(meta.id, "skeptic", deps);
    await assert.rejects(runOpinionStep(meta.id, "skeptic", deps), /have to finish/);
    await skipResearch(meta.id, "skeptic", { root });
    assert.deepEqual(await runOpinionStep(meta.id, "skeptic", deps), { ok: true });
    const opinion = chats.find((c) => c.task === "opinion");
    assert.ok(!opinion?.user.includes("# Your research notes"));
  });

  it("refuses opinions and a Chair in a research trial", async () => {
    const meta = await seed({ kind: "trial" });
    const { deps } = stubs();
    await runPlanStep(meta.id, "skeptic", deps);
    await runResearchStep(meta.id, "skeptic", deps);
    await runNotesStep(meta.id, "skeptic", deps);
    await assert.rejects(runOpinionStep(meta.id, "skeptic", deps), /research trial stops at the notes/);
    await assert.rejects(runChairStep(meta.id, deps), /research trial/);
    const view = await readSessionView(meta.id, root);
    assert.equal(view.sealed, false);
    assert.equal(view.chair, null);
    assert.ok(view.members[0].notes);
  });
});

describe("fast speed", () => {
  it("skips research and goes straight to opinions and the Chair", async () => {
    const meta = await seed({ speed: "fast" });
    const { deps, chats, searches } = stubs();
    await runOpinionStep(meta.id, "skeptic", deps);
    await runOpinionStep(meta.id, "operator", deps);
    await runChairStep(meta.id, deps);
    assert.deepEqual(chats.map((c) => c.task), ["opinion", "opinion", "board memo"]);
    assert.equal(searches.length, 0);
    const steps = (await readSessionView(meta.id, root)).members[0].state.steps;
    assert.equal(steps.plan.status, "skipped");
    assert.equal(steps.research.status, "skipped");
  });

  it("takes one or two members, not the full board", async () => {
    await assert.rejects(
      seed({ speed: "fast", members: ["skeptic", "operator", "customer-voice"] }),
      /Fast takes one or two members/,
    );
  });
});

describe("the generalist comparison", () => {
  it("gets the same material and the members' combined search allowance, and none of their work", async () => {
    const meta = await seed({ withGeneralist: true, limits: { searches: 3 } });
    const { deps, chats, searches } = stubs();
    await toOpinion(meta.id, "skeptic", deps);
    await toOpinion(meta.id, "operator", deps);

    await runGeneralistPlanStep(meta.id, deps);
    const plan = chats.find((c) => c.who === "Generalist" && c.task === "search plan");
    assert.ok(plan?.user.includes("up to 6 web searches"));
    await runGeneralistResearchStep(meta.id, deps);
    assert.deepEqual(searches.slice(-2), ["Generalist search one", "Generalist search two"]);
    assert.deepEqual(await runGeneralistMemoStep(meta.id, deps), { ok: true });

    for (const call of chats.filter((c) => c.who === "Generalist")) {
      const text = `${call.system}\n${call.user}`;
      assert.ok(text.includes("The shared material."));
      for (const leak of ["SKEPTIC", "OPERATOR", "Skeptic search", "OPINION-BY", "NOTES-BY"]) {
        assert.ok(!text.includes(leak), `${call.task}: ${leak}`);
      }
    }
    const view = await readSessionView(meta.id, root);
    assert.equal(view.generalist?.memo?.trim(), "GENERALIST-MEMO");
    assert.equal(view.generalist?.limits.searches, 6);
    assert.ok(existsSync(path.join(sessionDir(meta.id, root), "generalist", "research.json")));
  });

  it("is off unless asked for", async () => {
    const meta = await seed();
    await assert.rejects(runGeneralistPlanStep(meta.id, stubs().deps), /without the generalist/);
    assert.equal((await readSessionView(meta.id, root)).generalist, null);
  });

  it("writes from the material alone in a fast session", async () => {
    const meta = await seed({ speed: "fast", withGeneralist: true });
    const { deps, chats, searches } = stubs();
    await runGeneralistMemoStep(meta.id, deps);
    assert.equal(searches.length, 0);
    assert.ok(!chats[0].user.includes("# What you found"));
  });
});

describe("standing context", () => {
  it("is saved once and copied into each new session for everyone", async () => {
    assert.equal(await readStanding(root), "");
    await writeStanding("STANDING-ABOUT-OWNER", root);
    const meta = await seed({ speed: "fast", withGeneralist: true });
    await writeStanding("CHANGED-LATER", root);
    const { deps, chats } = stubs();
    await runOpinionStep(meta.id, "skeptic", deps);
    await runOpinionStep(meta.id, "operator", deps);
    await runChairStep(meta.id, deps);
    await runGeneralistMemoStep(meta.id, deps);
    assert.equal(chats.length, 4);
    for (const call of chats) {
      assert.ok(call.user.includes("STANDING-ABOUT-OWNER"), call.task);
      assert.ok(!call.user.includes("CHANGED-LATER"));
    }
  });
});
