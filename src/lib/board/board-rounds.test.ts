import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { interviewPrompt, MAX_INTERVIEW_QUESTIONS, parseInterview, parseLessons, parseMap } from "./compose";
import { saveDecision, writeHandoff } from "./decisions";
import { interviewTurn } from "./interview";
import { decideLesson, proposeLessons } from "./lessons";
import { rankOwnItems, type OwnSearchFn, type ReadFn, type SearchFn } from "./research";
import {
  runChairStep,
  runCrossStep,
  runGeneralistMemoStep,
  runGeneralistPlanStep,
  runGeneralistResearchStep,
  runMapStep,
  runNotesStep,
  runOpinionStep,
  runPlan2Step,
  runPlanStep,
  runPremortemStep,
  runResearch2Step,
  runResearchStep,
  runRevisedStep,
  setDropped,
  type BoardChatFn,
  type RunnerDeps,
} from "./session-runner";
import { createSession, readSessionView, sessionDir } from "./session-store";
import { createMember, readMember, updateMember } from "./store";
import type { SessionDraft } from "./types";

let root = "";

type Call = { who: string; task: string; system: string; user: string };

const POINTS = { points: [{ point: "Will customers leave?", settle: "Churn figures." }] };

function stubs(overrides: Partial<RunnerDeps> & { map?: unknown; plan2?: unknown } = {}) {
  const chats: Call[] = [];
  const searches: string[] = [];
  const reads: string[] = [];
  const chat: BoardChatFn = async (args) => {
    const who = args.system.match(/^You are (?:the )?([^,.\n]+)/)?.[1] ?? "?";
    const task = [...args.user.matchAll(/^# Your task: (.+)$/gm)].pop()?.[1] ?? "";
    chats.push({ who, task, system: args.system, user: args.user });
    const tag = who.toUpperCase().replace(/\s+/g, "-");
    switch (task) {
      case "search plan":
        return { content: JSON.stringify({ queries: [{ query: `${who} first search` }] }) };
      case "research notes":
        return { content: `NOTES-BY-${tag} [S1]` };
      case "opinion":
        return { content: `**Position:** For. FIRST-OPINION-BY-${tag} [S1]` };
      case "disagreement map":
        return { content: JSON.stringify(overrides.map ?? POINTS) };
      case "second search plan":
        return {
          content: JSON.stringify(overrides.plan2 ?? { queries: [{ query: `${who} second search` }, { query: `${who} first search` }] }),
        };
      case "revised opinion":
        return { content: `**Position:** Against. REVISED-BY-${tag} [S2]` };
      case "premortem":
        return { content: `PREMORTEM-BY-${tag}` };
      case "cross-examination":
        return { content: `CROSS-BY-${tag}` };
      case "board memo":
        return { content: "## Recommendation\nCHAIR-MEMO" };
      case "generalist memo":
        return { content: "GENERALIST-MEMO" };
      case "lessons":
        return { content: JSON.stringify({ lessons: [`Lesson one from ${who}`, `Lesson two from ${who}`] }) };
      default:
        return { content: "?" };
    }
  };
  const search: SearchFn = async (query) => {
    searches.push(query);
    return [{ url: `https://pages.example/${encodeURIComponent(query)}`, title: `About ${query}`, description: "" }];
  };
  const read: ReadFn = async (url) => {
    reads.push(url);
    return { text: `PAGE-TEXT ${url}`, via: "stub" };
  };
  let tick = 5_000;
  const { map: _map, plan2: _plan2, ...rest } = overrides;
  void _map;
  void _plan2;
  const deps: RunnerDeps = { chat, search, read, root, now: () => (tick += 1), ...rest };
  return { deps, chats, searches, reads };
}

async function start(draft: Partial<SessionDraft> = {}) {
  return createSession(
    {
      kind: "board",
      question: "Should we raise prices?",
      material: "Margins are thin.",
      model: "openai:gpt-test",
      members: ["operator", "skeptic"],
      ...draft,
    },
    root,
    1_000,
  );
}

const ok = { ok: true };

function must<T>(value: T | undefined): T {
  assert.ok(value !== undefined, "expected a model call that was not made");
  return value;
}

async function firstRound(id: string, deps: RunnerDeps, slugs = ["operator", "skeptic"]) {
  for (const slug of slugs) {
    assert.deepEqual(await runPlanStep(id, slug, deps), ok);
    assert.deepEqual(await runResearchStep(id, slug, deps), ok);
    assert.deepEqual(await runNotesStep(id, slug, deps), ok);
    assert.deepEqual(await runOpinionStep(id, slug, deps), ok);
  }
}

async function secondRound(id: string, deps: RunnerDeps, slugs = ["operator", "skeptic"]) {
  assert.deepEqual(await runMapStep(id, deps), ok);
  for (const slug of slugs) {
    assert.deepEqual(await runPlan2Step(id, slug, deps), ok);
    assert.deepEqual(await runResearch2Step(id, slug, deps), ok);
    assert.deepEqual(await runRevisedStep(id, slug, deps), ok);
  }
}

beforeEach(async () => {
  root = mkdtempSync(path.join(tmpdir(), "prism-rounds-"));
  for (const name of ["Operator", "Skeptic"]) {
    await createMember({ name, title: `${name} seat`, profile: `${name} profile`, directives: "" }, root);
  }
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("Deep speed", () => {
  it("leaves the later steps switched off in a standard session", async () => {
    const meta = await start();
    const { deps } = stubs();
    const view = await readSessionView(meta.id, root);
    for (const step of ["plan2", "research2", "revised", "premortem", "cross"] as const) {
      assert.equal(view.members[0].state.steps[step].status, "skipped");
    }
    assert.equal(view.chair?.state.map.status, "skipped");
    await assert.rejects(runMapStep(meta.id, deps), /without a second research round/);
    await assert.rejects(runPlan2Step(meta.id, "operator", deps), /without a second research round/);
    await firstRound(meta.id, deps);
    assert.deepEqual(await runChairStep(meta.id, deps), ok);
  });

  it("will not list open points until every first opinion is in", async () => {
    const meta = await start({ speed: "deep" });
    const { deps } = stubs();
    await firstRound(meta.id, deps, ["operator"]);
    await assert.rejects(runMapStep(meta.id, deps), /Skeptic has not given an opinion yet/);
    await assert.rejects(runPlan2Step(meta.id, "operator", deps), /has not listed the open points/);
  });

  it("aims the second round at the open points without showing anyone another member's opinion", async () => {
    const meta = await start({ speed: "deep" });
    const { deps, chats, searches } = stubs();
    await firstRound(meta.id, deps);
    await secondRound(meta.id, deps);

    const map = must(chats.find((c) => c.task === "disagreement map"));
    assert.ok(map?.user.includes("FIRST-OPINION-BY-OPERATOR") && map.user.includes("FIRST-OPINION-BY-SKEPTIC"));
    assert.ok(!map.user.includes("NOTES-BY-"), "the Chair does not read notes");

    for (const task of ["second search plan", "revised opinion"]) {
      const call = must(chats.find((c) => c.who === "Operator" && c.task === task));
      assert.ok(call, task);
      assert.ok(call.user.includes("D1: Will customers leave?"), `${task} has the open points`);
      assert.ok(call.user.includes("FIRST-OPINION-BY-OPERATOR"), `${task} has the member's own opinion`);
      assert.ok(!call.user.includes("SKEPTIC"), `${task} must not contain anything of Skeptic's`);
      assert.ok(!call.user.includes("Skeptic"), `${task} must not name Skeptic`);
    }
    // A search already run in round one is not run again.
    assert.deepEqual(
      searches.filter((q) => q.startsWith("Operator")),
      ["Operator first search", "Operator second search"],
    );
  });

  it("numbers second-round sources on from the first and gives the Chair the revised opinions", async () => {
    const meta = await start({ speed: "deep" });
    const { deps, chats } = stubs();
    await firstRound(meta.id, deps);
    await secondRound(meta.id, deps);
    assert.deepEqual(await runChairStep(meta.id, deps), ok);

    const view = await readSessionView(meta.id, root);
    const operator = view.members[0];
    assert.deepEqual(operator.research?.pages.map((p) => p.id), ["S1"]);
    assert.deepEqual(operator.research2?.pages.map((p) => p.id), ["S2"]);
    assert.match(operator.revised ?? "", /REVISED-BY-OPERATOR/);
    assert.match(operator.opinion ?? "", /FIRST-OPINION-BY-OPERATOR/);
    assert.equal(view.chair?.map?.points[0].id, "D1");

    const memo = must(chats.find((c) => c.task === "board memo"));
    assert.ok(memo?.user.includes("## Opinion from Operator (Operator seat), revised after a second round of research"));
    assert.ok(memo.user.includes("REVISED-BY-OPERATOR"));
    assert.ok(!memo.user.includes("FIRST-OPINION-BY-OPERATOR"), "the Chair reads the latest opinion only");
    assert.ok(memo.user.includes("[S2] About Operator second search"), "sources cited from the second round are listed");
    assert.ok(view.chair?.state.memo.saw?.includes("Revised opinion: Operator"));

    const handoff = readFileSync(await writeHandoff(meta.id, root), "utf8");
    assert.ok(handoff.includes("Against. REVISED-BY-OPERATOR"), "the hand-off quotes the revised position");
    assert.ok(!handoff.includes("FIRST-OPINION-BY-OPERATOR"));
  });

  it("lets the first opinion stand, without calling a model, when the second round found nothing", async () => {
    const meta = await start({ speed: "deep" });
    const { deps, chats } = stubs({ map: { points: [] } });
    await firstRound(meta.id, deps);
    await secondRound(meta.id, deps);
    assert.equal(chats.filter((c) => c.task === "second search plan" || c.task === "revised opinion").length, 0);
    assert.deepEqual(await runChairStep(meta.id, deps), ok);
    const view = await readSessionView(meta.id, root);
    assert.equal(view.members[0].revised, null);
    assert.equal(view.members[0].state.steps.revised.status, "done");
    const memo = must(chats.find((c) => c.task === "board memo"));
    assert.ok(memo?.user.includes("FIRST-OPINION-BY-OPERATOR"));
    assert.ok(!memo.user.includes("revised after a second round"));
  });

  it("refuses a list of open points that names a member", async () => {
    const meta = await start({ speed: "deep" });
    const { deps } = stubs({ map: { points: [{ point: "Is Skeptic right about churn?", settle: "" }] } });
    await firstRound(meta.id, deps);
    const outcome = await runMapStep(meta.id, deps);
    assert.equal(outcome.ok, false);
    assert.match(outcome.ok ? "" : outcome.error, /names a member \(Skeptic\)/);
    assert.equal((await readSessionView(meta.id, root)).chair?.map, null);
    // A lower-case common word that happens to be a member's name is not a name.
    assert.equal(parseMap('{"points":[{"point":"Would a skeptic accept this?"}]}', ["Skeptic"]).length, 1);
  });

  it("starts the second round over when a first opinion changes", async () => {
    const meta = await start({ speed: "deep" });
    const { deps } = stubs();
    await firstRound(meta.id, deps);
    await secondRound(meta.id, deps);
    assert.deepEqual(await runChairStep(meta.id, deps), ok);

    assert.deepEqual(await runOpinionStep(meta.id, "operator", deps), ok);
    const view = await readSessionView(meta.id, root);
    assert.equal(view.chair?.state.map.status, "idle");
    assert.equal(view.chair?.map, null);
    assert.equal(view.chair?.state.memo.status, "idle");
    for (const member of view.members) {
      for (const step of ["plan2", "research2", "revised"] as const) {
        assert.equal(member.state.steps[step].status, "idle", `${member.slug} ${step}`);
      }
      assert.equal(member.plan2, null);
      assert.equal(member.research2, null);
    }
    await assert.rejects(runChairStep(meta.id, deps), /has not finished the later rounds/);
  });

  it("gives the generalist the allowance of both rounds", async () => {
    const meta = await start({ speed: "deep", withGeneralist: true, limits: { searches: 3 } });
    assert.equal((await readSessionView(meta.id, root)).generalist?.limits.searches, 12);
  });
});

describe("premortem and cross-examination", () => {
  it("runs the premortem on the member's own opinion alone", async () => {
    const meta = await start({ rounds: { premortem: true } });
    const { deps, chats } = stubs();
    await firstRound(meta.id, deps, ["operator"]);
    assert.deepEqual(await runPremortemStep(meta.id, "operator", deps), ok);
    const call = must(chats.find((c) => c.task === "premortem"));
    assert.ok(call?.user.includes("FIRST-OPINION-BY-OPERATOR"));
    assert.ok(!/skeptic/i.test(call.user));
    assert.deepEqual((await readSessionView(meta.id, root)).members[0].state.steps.premortem.saw?.slice(-1), [
      "Own opinion",
    ]);
  });

  it("holds cross-examination until every opinion is final", async () => {
    const meta = await start({ speed: "deep", rounds: { crossExam: true } });
    const { deps } = stubs();
    await firstRound(meta.id, deps);
    await assert.rejects(runCrossStep(meta.id, "operator", deps), /Still waiting for Operator, Skeptic/);
    await secondRound(meta.id, deps, ["operator"]);
    await assert.rejects(runCrossStep(meta.id, "operator", deps), /Still waiting for Skeptic/);
  });

  it("shows a member the others' opinions, and nothing else of theirs, only in cross-examination", async () => {
    const meta = await start({ rounds: { crossExam: true, premortem: true } });
    const { deps, chats } = stubs();
    await firstRound(meta.id, deps);
    await assert.rejects(runCrossStep(meta.id, "operator", deps), /premortem comes first/);
    for (const slug of ["operator", "skeptic"]) {
      assert.deepEqual(await runPremortemStep(meta.id, slug, deps), ok);
      assert.deepEqual(await runCrossStep(meta.id, slug, deps), ok);
    }
    const cross = must(chats.find((c) => c.who === "Operator" && c.task === "cross-examination"));
    assert.ok(cross?.user.includes("## Opinion from Skeptic (Skeptic seat)"));
    assert.ok(cross.user.includes("FIRST-OPINION-BY-SKEPTIC"));
    assert.ok(!cross.user.includes("NOTES-BY-SKEPTIC"));
    assert.ok(!cross.user.includes("PREMORTEM-BY-SKEPTIC"));
    assert.ok(!cross.system.includes("Skeptic profile"));

    // Every other step a member takes is still free of the others' work.
    for (const call of chats.filter((c) => c.who === "Operator" && c.task !== "cross-examination")) {
      assert.ok(!/SKEPTIC/.test(call.user), `${call.task} leaked Skeptic's work`);
    }

    assert.deepEqual(await runChairStep(meta.id, deps), ok);
    const memo = must(chats.find((c) => c.task === "board memo"));
    assert.ok(memo?.user.includes("## Operator on the other opinions\nCROSS-BY-OPERATOR"));
    assert.ok(memo.user.includes("## Premortem from Skeptic\nPREMORTEM-BY-SKEPTIC"));
    const saw = (await readSessionView(meta.id, root)).chair?.state.memo.saw ?? [];
    assert.ok(saw.includes("Cross-examination: Operator") && saw.includes("Premortem: Skeptic"));
  });

  it("redoes the others' cross-examination when a member is left out, and keeps their premortems", async () => {
    await createMember({ name: "Third", title: "", profile: "Third profile", directives: "" }, root);
    const meta = await start({ members: ["operator", "skeptic", "third"], rounds: { crossExam: true, premortem: true } });
    const { deps, chats } = stubs();
    const all = ["operator", "skeptic", "third"];
    await firstRound(meta.id, deps, all);
    for (const slug of all) assert.deepEqual(await runPremortemStep(meta.id, slug, deps), ok);
    for (const slug of all) assert.deepEqual(await runCrossStep(meta.id, slug, deps), ok);

    await setDropped(meta.id, "third", true, { root });
    const view = await readSessionView(meta.id, root);
    assert.equal(view.members[0].state.steps.cross.status, "idle");
    assert.equal(view.members[0].cross, null);
    assert.equal(view.members[0].state.steps.premortem.status, "done");

    assert.deepEqual(await runCrossStep(meta.id, "operator", deps), ok);
    const again = must(chats.filter((c) => c.who === "Operator" && c.task === "cross-examination").pop());
    assert.ok(again?.user.includes("FIRST-OPINION-BY-SKEPTIC"));
    assert.ok(!again.user.includes("FIRST-OPINION-BY-THIRD"));
  });

  it("needs two members for cross-examination", async () => {
    await assert.rejects(start({ members: ["operator"], rounds: { crossExam: true } }), /at least two members/);
  });
});

describe("private dossier", () => {
  const DOSSIER = "We were offered a bridge loan by Brightwater Capital.";

  it("goes to that member only, to the generalist in full, and never to the Chair", async () => {
    const meta = await start({ dossiers: { skeptic: DOSSIER }, withGeneralist: true });
    assert.equal(meta.members[1].dossierChars, DOSSIER.length);
    assert.equal(meta.members[0].dossierChars, undefined);
    const { deps, chats } = stubs();
    await firstRound(meta.id, deps);
    assert.deepEqual(await runChairStep(meta.id, deps), ok);
    assert.deepEqual(await runGeneralistPlanStep(meta.id, deps), ok);
    assert.deepEqual(await runGeneralistResearchStep(meta.id, deps), ok);
    assert.deepEqual(await runGeneralistMemoStep(meta.id, deps), ok);

    for (const call of chats) {
      const has = `${call.system}\n${call.user}`.includes("Brightwater");
      const should = call.who === "Skeptic" || call.who === "Generalist";
      assert.equal(has, should, `${call.who} / ${call.task}`);
    }
    const view = await readSessionView(meta.id, root);
    assert.equal(view.members[1].dossier?.trim(), DOSSIER);
    assert.equal(view.members[0].dossier, null);
    assert.ok(view.members[1].state.steps.opinion.saw?.some((s) => s.startsWith("Own private dossier")));
    assert.ok(!view.members[0].state.steps.opinion.saw?.some((s) => s.includes("dossier")));
    assert.ok(view.generalist?.state.steps.memo.saw?.some((s) => s.startsWith("Every private dossier")));
    assert.ok(!view.chair?.state.memo.saw?.some((s) => s.includes("dossier")));
    assert.ok(chats.find((c) => c.who === "Generalist")?.user.includes("## Given to Skeptic"));
  });

  it("holds a search that repeats a name from the dossier", async () => {
    const meta = await start({ dossiers: { skeptic: DOSSIER } });
    const chat: BoardChatFn = async () => ({
      content: JSON.stringify({ queries: [{ query: "Brightwater Capital reviews" }] }),
    });
    const { deps } = stubs({ chat });
    assert.deepEqual(await runPlanStep(meta.id, "skeptic", deps), ok);
    assert.deepEqual(await runPlanStep(meta.id, "operator", deps), ok);
    const view = await readSessionView(meta.id, root);
    assert.equal(view.members[1].plan?.approved, false);
    assert.deepEqual(view.members[1].plan?.flagged[0].terms.sort(), ["brightwater", "capital"]);
    // The same search from a member who never saw the dossier is not held.
    assert.equal(view.members[0].plan?.approved, true);
  });

  it("is refused for someone who is not in the session, and ignored in a research trial", async () => {
    await assert.rejects(start({ members: ["operator"], dossiers: { skeptic: DOSSIER } }), /not in the session/);
    const trial = await start({ kind: "trial", dossiers: { operator: DOSSIER } });
    assert.equal(trial.members[0].dossierChars, undefined);
  });
});

describe("searching the owner's own records", () => {
  const ownQuery = { query: "Northwind renewal history", why: "", where: "own" };
  const planChat: BoardChatFn = async () => ({
    content: JSON.stringify({ queries: [{ query: "general churn figures" }, ownQuery] }),
  });

  it("treats a search marked for own records as a web search when the member has no own records", async () => {
    const meta = await start({ material: "Our largest account is Northwind." });
    const { deps } = stubs({ chat: planChat });
    assert.deepEqual(await runPlanStep(meta.id, "operator", deps), ok);
    const plan = (await readSessionView(meta.id, root)).members[0].plan;
    assert.equal(plan?.queries[1].where, undefined);
    assert.equal(plan?.approved, false, "as a web search it repeats a name, so it is held");
  });

  it("searches own records for a member who is allowed to, without holding the search or sending it to the web", async () => {
    await updateMember("operator", { sources: ["airtable", "bogus" as never] }, root);
    assert.deepEqual((await readMember("operator", root))?.sources, ["airtable"]);
    const meta = await start({ material: "Our largest account is Northwind." });
    const asked: Array<{ query: string; sources: string[] }> = [];
    const own: OwnSearchFn = async (query, { sources }) => {
      asked.push({ query, sources });
      return {
        hits: [{ source: "airtable", title: "Northwind renewal 2025", text: "Renewed at a 5% discount." }],
        problems: [],
      };
    };
    const { deps, searches } = stubs({ chat: planChat, own });
    assert.deepEqual(await runPlanStep(meta.id, "operator", deps), ok);
    const planned = (await readSessionView(meta.id, root)).members[0];
    assert.equal(planned.plan?.queries[1].where, "own");
    assert.equal(planned.plan?.approved, true, "a search of own records may use a name from the material");

    assert.deepEqual(await runResearchStep(meta.id, "operator", deps), ok);
    assert.deepEqual(searches, ["general churn figures"]);
    assert.deepEqual(asked, [{ query: "Northwind renewal history", sources: ["airtable"] }]);
    const record = (await readSessionView(meta.id, root)).members[0].research;
    const page = record?.pages.find((p) => p.via.startsWith("own records"));
    assert.equal(page?.id, "S2");
    assert.equal(page?.via, "own records: Airtable records");
    assert.equal(page?.text, "Renewed at a 5% discount.");
    assert.equal(record?.queries[1].where, "own");
  });

  it("records why nothing could be searched when a source is not connected", async () => {
    await updateMember("operator", { sources: ["github"] }, root);
    const meta = await start();
    const { deps } = stubs({ chat: planChat });
    assert.deepEqual(await runPlanStep(meta.id, "operator", deps), ok);
    assert.deepEqual(await runResearchStep(meta.id, "operator", deps), ok);
    const record = (await readSessionView(meta.id, root)).members[0].research;
    assert.match(record?.queries[1].error ?? "", /no own records to search/);

    const own: OwnSearchFn = async () => ({ hits: [], problems: ["GitHub repositories: Not connected."] });
    const again = stubs({ chat: planChat, own });
    assert.deepEqual(await runResearchStep(meta.id, "operator", again.deps), ok);
    const second = (await readSessionView(meta.id, root)).members[0].research;
    assert.equal(second?.queries[1].error, "GitHub repositories: Not connected.");
  });

  it("tells the member which records they may search", async () => {
    await updateMember("skeptic", { sources: ["knowledge", "github"] }, root);
    const meta = await start();
    const { deps, chats } = stubs();
    await runPlanStep(meta.id, "skeptic", deps);
    await runPlanStep(meta.id, "operator", deps);
    const skeptic = must(chats.find((c) => c.who === "Skeptic"));
    assert.match(skeptic?.user ?? "", /owner's own records: knowledge cards, GitHub repositories/);
    assert.match(skeptic?.user ?? "", /"where":"own"/);
    assert.ok(!chats.find((c) => c.who === "Operator")?.user.includes("own records"));
  });

  it("ranks records by how many of the search's words they contain, title first", () => {
    const items = [
      { title: "Onboarding checklist", text: "Steps for new customers." },
      { title: "Pricing history", text: "Every change since 2021." },
      { title: "Notes", text: "A pricing change was discussed, with history of the last one." },
      { title: "Holiday rota", text: "Who is in when." },
    ];
    assert.deepEqual(
      rankOwnItems(items, "the pricing history", 5).map((i) => i.title),
      ["Pricing history", "Notes"],
    );
    assert.equal(rankOwnItems(items, "pricing", 1).length, 1);
    assert.deepEqual(rankOwnItems(items, "of the", 5), []);
  });
});

describe("lessons for a member's living file", () => {
  async function finished() {
    const meta = await start({ speed: "fast" });
    const { deps } = stubs();
    for (const slug of ["operator", "skeptic"]) await runOpinionStep(meta.id, slug, deps);
    return { meta, deps };
  }

  it("waits for the Chair's memo", async () => {
    const { meta, deps } = await finished();
    await assert.rejects(proposeLessons(meta.id, "operator", deps), /after the Chair's memo/);
  });

  it("proposes lessons from the member's own opinion, the memo and what the owner did", async () => {
    const { meta } = await finished();
    const { deps, chats } = stubs();
    await runChairStep(meta.id, deps);
    await saveDecision(meta.id, { status: "decided", choice: "Raise for new customers only", outcome: "Churn was flat." }, root);
    assert.deepEqual(await proposeLessons(meta.id, "operator", deps), ok);
    const call = must(chats.find((c) => c.task === "lessons"));
    assert.ok(call?.user.includes("FIRST-OPINION-BY-OPERATOR"));
    assert.ok(call.user.includes("CHAIR-MEMO"));
    assert.ok(call.user.includes("Decided: Raise for new customers only"));
    assert.ok(call.user.includes("What happened afterwards: Churn was flat."));
    assert.ok(!call.user.includes("FIRST-OPINION-BY-SKEPTIC"));
    const lessons = (await readSessionView(meta.id, root)).members[0].lessons;
    assert.deepEqual(lessons?.proposals.map((p) => [p.id, p.status]), [["L1", "proposed"], ["L2", "proposed"]]);
    assert.equal(lessons?.state.saw?.at(-1), "The owner's decision record");
    // Nothing has been written to the member yet.
    assert.equal((await readMember("operator", root))?.files.find((f) => f.name === "lessons.md"), undefined);
  });

  it("writes to the member's file only on approval, with the owner's wording", async () => {
    const { meta } = await finished();
    const { deps } = stubs();
    await runChairStep(meta.id, deps);
    await proposeLessons(meta.id, "operator", deps);
    assert.equal(
      (await readSessionView(meta.id, root)).members[0].lessons?.state.saw?.at(-1),
      "The owner's decision record (nothing recorded yet)",
    );

    await decideLesson(meta.id, "operator", "L2", { approve: false }, root, 2_000);
    assert.equal((await readMember("operator", root))?.files.find((f) => f.name === "lessons.md"), undefined);

    const now = Date.UTC(2026, 2, 4);
    const { file } = await decideLesson(meta.id, "operator", "L1", { approve: true, text: "  Ask for the base rate first. " }, root, now);
    assert.equal(file, "lessons.md");
    const saved = (await readMember("operator", root))?.files.find((f) => f.name === "lessons.md")?.content;
    assert.equal(saved, '# Lessons\n- Ask for the base rate first. _(2026-03-04, from "Should we raise prices?")_\n');
    // The copy of the member inside this session is left as it was.
    const snapshot = JSON.parse(readFileSync(path.join(sessionDir(meta.id, root), "members/operator/member.json"), "utf8"));
    assert.deepEqual(snapshot.files, []);

    await assert.rejects(decideLesson(meta.id, "operator", "L1", { approve: true }, root), /already approved/);
    await assert.rejects(decideLesson(meta.id, "operator", "L2", { approve: true }, root), /already rejected/);
    await assert.rejects(decideLesson(meta.id, "operator", "L9", { approve: true }, root), /Lesson not found/);
  });

  it("adds to an existing file, keeps approved lessons when asked again, and reads the file in the next session", async () => {
    const { meta } = await finished();
    const { deps } = stubs();
    await runChairStep(meta.id, deps);
    await proposeLessons(meta.id, "operator", deps);
    await decideLesson(meta.id, "operator", "L1", { approve: true }, root, 1);
    await proposeLessons(meta.id, "operator", deps);
    const lessons = (await readSessionView(meta.id, root)).members[0].lessons;
    assert.deepEqual(lessons?.proposals.map((p) => [p.id, p.status]), [
      ["L1", "approved"],
      ["L2", "proposed"],
      ["L3", "proposed"],
    ]);
    await decideLesson(meta.id, "operator", "L3", { approve: true }, root, 2);
    const saved = (await readMember("operator", root))?.files.find((f) => f.name === "lessons.md")?.content ?? "";
    assert.equal(saved.split("\n").filter((l) => l.startsWith("- ")).length, 2);

    const next = await start({ speed: "fast", members: ["operator"] });
    const later = stubs();
    await runOpinionStep(next.id, "operator", later.deps);
    assert.ok(later.chats[0].system.includes("Lesson one from Operator"));
  });

  it("reads lessons out of a model reply, capped at three", () => {
    assert.deepEqual(parseLessons('```json\n{"lessons":["a",{"lesson":"b"},"","c","d"]}\n```').map((l) => l.text), ["a", "b", "c"]);
    assert.deepEqual(parseLessons('{"lessons":[]}'), []);
    assert.throws(() => parseLessons("no lessons here"), /did not return a list/);
  });
});

describe("interview that drafts a member", () => {
  it("asks a question, then writes the draft, and saves nothing", async () => {
    const seen: string[] = [];
    const chat: BoardChatFn = async (args) => {
      seen.push(args.user);
      return args.user.includes("# Your task: member draft")
        ? { content: JSON.stringify({ draft: { name: "Regulatory eye", title: "Accountable for the rules.", profile: "You read rules.", directives: "- Regulators first" } }) }
        : { content: '{"question":"What should they catch?"}' };
    };
    const first = await interviewTurn({ model: "openai:gpt-test", transcript: [] }, { chat, root });
    assert.deepEqual(first, { kind: "question", question: "What should they catch?" });
    assert.ok(seen[0].includes("- Operator: Operator seat"), "the interviewer knows who is already on the board");
    assert.ok(!seen[0].includes("Operator profile"), "but not what is in their profiles");

    const transcript = [
      { role: "interviewer", text: "What should they catch?" },
      { role: "owner", text: "Rule changes." },
    ];
    const draft = await interviewTurn({ model: "openai:gpt-test", transcript, finish: true }, { chat, root });
    assert.equal(draft.kind, "draft");
    assert.equal(draft.kind === "draft" && draft.draft.name, "Regulatory eye");
    assert.ok(seen[1].includes("Owner: Rule changes."));
    assert.equal(await readMember("regulatory-eye", root), null);
  });

  it("asks for the draft once the question limit is reached", () => {
    const transcript = Array.from({ length: MAX_INTERVIEW_QUESTIONS }, (_, i) => [
      { role: "interviewer" as const, text: `Q${i}` },
      { role: "owner" as const, text: `A${i}` },
    ]).flat();
    assert.ok(interviewPrompt({ transcript, existing: [], finish: false }).user.includes("# Your task: member draft"));
    assert.ok(interviewPrompt({ transcript: transcript.slice(0, 2), existing: [], finish: false }).user.includes("# Your task: next question"));
  });

  it("refuses a draft before any answer, a missing model, and a reply that is neither", async () => {
    const chat: BoardChatFn = async () => ({ content: "Sure, happy to help!" });
    await assert.rejects(interviewTurn({ model: "m", transcript: [], finish: true }, { chat, root }), /Answer at least one question/);
    await assert.rejects(interviewTurn({ model: "", transcript: [] }, { chat, root }), /Choose a model/);
    await assert.rejects(interviewTurn({ model: "m", transcript: [{ role: "boss", text: "x" }] }, { chat, root }), /could not be read/);
    await assert.rejects(interviewTurn({ model: "m", transcript: [] }, { chat, root }), /neither a question nor a member draft/);
    assert.throws(() => parseInterview('{"draft":{"name":"X"}}'), /neither/);
  });
});
