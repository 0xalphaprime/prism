import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  emptyDecision,
  handoffDir,
  handoffFile,
  listDecisions,
  localDay,
  looseEnd,
  memoSection,
  positionLine,
  readDecision,
  removeHandoff,
  saveDecision,
  syncHandoff,
} from "./decisions";
import type { ReadFn, SearchFn } from "./research";
import { runChairStep, runOpinionStep, setDropped, type BoardChatFn, type RunnerDeps } from "./session-runner";
import { createSession, sessionDir } from "./session-store";
import { BoardStoreError, createMember } from "./store";
import type { DecisionRecord } from "./types";

let root = "";

const MEMO = [
  "## Recommendation",
  "Raise prices, but only for new customers.",
  "",
  "## The strongest case for",
  "Margins are thin.",
  "",
  "## What is missing or unknown",
  "How many customers are on annual contracts.",
  "",
  "## Next step",
  "Price-test with twenty new sign-ups.",
].join("\n");

function deps(): RunnerDeps {
  const chat: BoardChatFn = async (args) => {
    const who = args.system.match(/^You are (?:the )?([^,.\n]+)/)?.[1] ?? "?";
    if (args.user.includes("# Your task: board memo")) return { content: MEMO };
    return { content: `**Position:** ${who === "Skeptic" ? "Against" : "For"}. Said by ${who}.\n**Why:**\n- a reason` };
  };
  const search: SearchFn = async () => [];
  const read: ReadFn = async () => ({ text: "", via: "stub" });
  let tick = 9_000;
  return { chat, search, read, root, now: () => (tick += 1) };
}

async function fastSession(overrides: { kind?: "board" | "trial"; members?: string[] } = {}) {
  return createSession(
    {
      kind: overrides.kind ?? "board",
      speed: "fast",
      question: "Should we raise prices?",
      material: "Margins are 12%.",
      model: "openai:gpt-test",
      members: overrides.members ?? ["operator", "skeptic"],
    },
    root,
    Date.UTC(2026, 0, 5, 9, 0),
  );
}

async function finish(id: string) {
  const d = deps();
  for (const slug of ["operator", "skeptic"]) assert.deepEqual(await runOpinionStep(id, slug, d), { ok: true });
  assert.deepEqual(await runChairStep(id, d), { ok: true });
}

beforeEach(async () => {
  root = mkdtempSync(path.join(tmpdir(), "prism-decisions-"));
  for (const name of ["Operator", "Skeptic"]) {
    await createMember({ name, title: `${name} seat`, profile: `${name} profile`, directives: "" }, root);
  }
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("looseEnd", () => {
  const base: DecisionRecord = emptyDecision();
  const today = "2026-03-10";

  it("flags a finished session nobody has decided on", () => {
    assert.match(looseEnd(base, true, today) ?? "", /have not decided/);
  });

  it("flags a session that was started and left", () => {
    assert.match(looseEnd(base, false, today) ?? "", /has not finished/);
  });

  it("is quiet for a decision with no review date, and for one whose review is still ahead", () => {
    assert.equal(looseEnd({ ...base, status: "decided", choice: "Go" }, true, today), null);
    assert.equal(looseEnd({ ...base, status: "decided", choice: "Go", reviewOn: "2026-03-11" }, true, today), null);
  });

  it("flags a decision on its review date and after, until an outcome is written", () => {
    const due = { ...base, status: "decided" as const, choice: "Go", reviewOn: "2026-03-10" };
    assert.match(looseEnd(due, true, today) ?? "", /Review was due 2026-03-10/);
    assert.match(looseEnd({ ...due, reviewOn: "2026-01-01" }, true, today) ?? "", /Review was due/);
    assert.equal(looseEnd({ ...due, outcome: "It worked." }, true, today), null);
  });

  it("flags a parked decision with no date, or whose date has arrived", () => {
    assert.match(looseEnd({ ...base, status: "parked" }, true, today) ?? "", /no date/);
    assert.equal(looseEnd({ ...base, status: "parked", reviewOn: "2026-04-01" }, true, today), null);
    assert.match(looseEnd({ ...base, status: "parked", reviewOn: "2026-03-01" }, true, today) ?? "", /has arrived/);
  });

  it("never flags a dropped decision", () => {
    assert.equal(looseEnd({ ...base, status: "dropped", reviewOn: "2020-01-01" }, false, today), null);
  });
});

describe("reading a memo", () => {
  it("returns the text under a heading up to the next one", () => {
    assert.equal(memoSection(MEMO, "Recommendation"), "Raise prices, but only for new customers.");
    assert.equal(memoSection(MEMO, "next step"), "Price-test with twenty new sign-ups.");
  });

  it("returns null for a missing heading, an empty section, or no memo", () => {
    assert.equal(memoSection(MEMO, "Where the disagreement lies"), null);
    assert.equal(memoSection("## Recommendation\n\n## Next step\nGo", "Recommendation"), null);
    assert.equal(memoSection(null, "Recommendation"), null);
  });

  it("takes a member's position line with or without bold marks", () => {
    assert.equal(positionLine("**Position:** Against. Too early.\n**Why:** x"), "Against. Too early.");
    assert.equal(positionLine("Intro\nPosition: For, with care"), "For, with care");
    assert.equal(positionLine("My position on this is unclear"), null);
    assert.equal(positionLine(null), null);
  });
});

describe("saving a decision", () => {
  it("starts out undecided and empty", async () => {
    const meta = await fastSession();
    assert.deepEqual(await readDecision(meta.id, root), emptyDecision());
  });

  it("stores the record in the session folder and writes the hand-off file", async () => {
    const meta = await fastSession();
    await finish(meta.id);
    const now = Date.UTC(2026, 0, 6, 12, 0);
    const { decision, handoff } = await saveDecision(
      meta.id,
      { status: "decided", choice: " New customers only. ", rationale: "Churn risk.", reviewOn: "2026-04-01" },
      root,
      now,
    );
    assert.equal(decision.status, "decided");
    assert.equal(decision.choice, "New customers only.");
    assert.equal(decision.decidedAt, now);
    assert.ok(existsSync(path.join(sessionDir(meta.id, root), "decision.json")));
    assert.equal(handoff, handoffFile(meta.id, root));
    assert.deepEqual(readdirSync(handoffDir(root)), [`${meta.id}.md`]);
    assert.deepEqual(await readDecision(meta.id, root), decision);
  });

  it("keeps the first decided time when the record is edited later, and clears it if undone", async () => {
    const meta = await fastSession();
    const first = await saveDecision(meta.id, { status: "decided", choice: "Go" }, root, 1_000);
    const edited = await saveDecision(meta.id, { outcome: "It worked." }, root, 2_000);
    assert.equal(edited.decision.decidedAt, first.decision.decidedAt);
    assert.equal(edited.decision.choice, "Go");
    assert.equal(edited.decision.updatedAt, 2_000);
    const undone = await saveDecision(meta.id, { status: "undecided" }, root, 3_000);
    assert.equal(undone.decision.decidedAt, undefined);
  });

  it("refuses 'decided' with nothing written, a bad date, an unknown status, and a research trial", async () => {
    const meta = await fastSession();
    await assert.rejects(saveDecision(meta.id, { status: "decided" }, root), /Write what you decided/);
    await assert.rejects(saveDecision(meta.id, { reviewOn: "2026-02-31" }, root), /real date/);
    await assert.rejects(saveDecision(meta.id, { reviewOn: "next week" }, root), /real date/);
    await assert.rejects(
      saveDecision(meta.id, { status: "maybe" as never }, root),
      (error: unknown) => error instanceof BoardStoreError && /Unknown decision status/.test(error.message),
    );
    const trial = await fastSession({ kind: "trial", members: ["operator"] });
    await assert.rejects(saveDecision(trial.id, { status: "parked" }, root), /Only board sessions/);
    await assert.rejects(saveDecision("nope", { status: "parked" }, root), /not found|Invalid/i);
  });

  it("clears a review date when it is saved empty", async () => {
    const meta = await fastSession();
    await saveDecision(meta.id, { status: "parked", reviewOn: "2026-05-01" }, root);
    const { decision } = await saveDecision(meta.id, { reviewOn: "" }, root);
    assert.equal(decision.reviewOn, undefined);
  });
});

describe("the hand-off file", () => {
  it("is not written before there is anything to hand off", async () => {
    const meta = await fastSession();
    assert.equal(await syncHandoff(meta.id, root), null);
    assert.ok(!existsSync(handoffDir(root)));
  });

  it("is written once the Chair has reported, even before the owner decides", async () => {
    const meta = await fastSession();
    await finish(meta.id);
    const file = await syncHandoff(meta.id, root, Date.UTC(2026, 0, 6));
    assert.equal(file, handoffFile(meta.id, root));
    const text = readFileSync(file ?? "", "utf8");
    assert.match(text, /^---\nid: /);
    assert.match(text, /^status: undecided$/m);
    assert.match(text, /^needs_owner: true$/m);
    assert.match(text, /## What the board recommended\nRaise prices, but only for new customers\./);
    assert.match(text, /## Next step the board suggested\nPrice-test with twenty new sign-ups\./);
    assert.match(text, /## Still unknown\nHow many customers are on annual contracts\./);
    assert.match(text, /- \*\*Operator:\*\* For\. Said by Operator\./);
    assert.match(text, /- \*\*Skeptic:\*\* Against\. Said by Skeptic\./);
    assert.match(text, /## The Chair's memo in full\n\n### Recommendation/);
  });

  it("carries what the owner decided and does not carry the shared material", async () => {
    const meta = await fastSession();
    await finish(meta.id);
    const { handoff } = await saveDecision(
      meta.id,
      { status: "decided", choice: "New customers only.", rationale: "Churn risk.", reviewOn: "2099-01-01" },
      root,
    );
    const text = readFileSync(handoff, "utf8");
    assert.match(text, /^status: decided$/m);
    assert.match(text, /^review_on: 2099-01-01$/m);
    assert.match(text, /^needs_owner: false$/m);
    assert.match(text, /## What was decided\nNew customers only\./);
    assert.match(text, /## Why\nChurn risk\./);
    assert.match(text, /## The decision\nShould we raise prices\?/);
    assert.ok(!text.includes("Margins are 12%."), "the pasted material stays in the session folder");
  });

  it("leaves members' positions out until the Chair has reported", async () => {
    const meta = await fastSession();
    assert.deepEqual(await runOpinionStep(meta.id, "operator", deps()), { ok: true });
    const { handoff } = await saveDecision(meta.id, { status: "parked" }, root);
    const text = readFileSync(handoff, "utf8");
    assert.ok(!text.includes("Said by Operator"));
    assert.match(text, /- \*\*Operator:\*\* No opinion recorded\./);
    assert.match(text, /The Chair has not written a memo\./);
  });

  it("follows the session when the memo is cleared and when a member is left out", async () => {
    const meta = await fastSession();
    await finish(meta.id);
    await syncHandoff(meta.id, root);
    await setDropped(meta.id, "skeptic", true, { root });
    const text = readFileSync((await syncHandoff(meta.id, root)) ?? "", "utf8");
    assert.match(text, /The Chair has not written a memo\./);
    assert.match(text, /- \*\*Skeptic:\*\* Left out of this session\./);
  });

  it("can be removed, and ignores ids that are not sessions", async () => {
    const meta = await fastSession();
    await saveDecision(meta.id, { status: "dropped" }, root);
    await removeHandoff(meta.id, root);
    assert.deepEqual(readdirSync(handoffDir(root)), []);
    await removeHandoff("../../etc", root);
    assert.equal(await syncHandoff("../../etc", root), null);
    assert.throws(() => handoffFile("../x", root), /Invalid session id/);
  });
});

describe("the decisions list", () => {
  it("lists board sessions only, newest first, with the reason each still needs the owner", async () => {
    const older = await fastSession();
    await finish(older.id);
    await saveDecision(older.id, { status: "decided", choice: "Go", reviewOn: "2026-02-01" }, root);
    const newer = await createSession(
      { kind: "board", speed: "fast", question: "Hire a second engineer?", model: "openai:gpt-test", members: ["operator"] },
      root,
      Date.UTC(2026, 1, 1),
    );
    await fastSession({ kind: "trial", members: ["operator"] });

    const rows = await listDecisions(root, new Date(2026, 1, 10, 12).getTime());
    assert.deepEqual(rows.map((r) => r.id), [newer.id, older.id]);

    const [open, due] = rows;
    assert.equal(open.sessionFinished, false);
    assert.equal(open.decision.status, "undecided");
    assert.match(open.looseEnd ?? "", /has not finished/);
    assert.equal(open.recommendation, null);
    assert.equal(open.handoff, null);

    assert.equal(due.sessionFinished, true);
    assert.equal(due.recommendation, "Raise prices, but only for new customers.");
    assert.match(due.looseEnd ?? "", /Review was due 2026-02-01/);
    assert.equal(due.handoff, handoffFile(older.id, root));
  });

  it("drops the reason once the outcome is recorded", async () => {
    const meta = await fastSession();
    await finish(meta.id);
    await saveDecision(meta.id, { status: "decided", choice: "Go", reviewOn: "2026-02-01", outcome: "Fine." }, root);
    const [row] = await listDecisions(root, new Date(2026, 1, 10, 12).getTime());
    assert.equal(row.looseEnd, null);
  });
});

describe("localDay", () => {
  it("formats a moment as a calendar day on this machine", () => {
    assert.equal(localDay(new Date(2026, 2, 5, 23, 30).getTime()), "2026-03-05");
  });
});
