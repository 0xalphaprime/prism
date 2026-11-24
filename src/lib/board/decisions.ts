import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import {
  listSessions,
  readChairMemo,
  readChairState,
  readSeatState,
  readSeatText,
  requireSession,
  safeSessionId,
  sessionDir,
} from "./session-store";
import { BoardStoreError, boardRoot, exists, writeText } from "./store";
import type {
  DecisionDraft,
  DecisionRecord,
  DecisionRow,
  DecisionStatus,
  SessionMeta,
} from "./types";

/**
 * What the owner did with the board's advice.
 *
 *   data/board/sessions/<id>/decision.json   the record
 *   data/board/handoffs/<id>.md              the same decision as one readable file
 *
 * The hand-off folder is flat on purpose: another program (Hermes) can watch
 * one folder and pick up every decision without knowing how sessions are laid out.
 */

const STATUSES: DecisionStatus[] = ["undecided", "decided", "parked", "dropped"];
const MAX_CHOICE = 4_000;
const MAX_LONG = 12_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function handoffDir(root = boardRoot()) {
  return path.join(root, "handoffs");
}

export function handoffFile(id: string, root = boardRoot()) {
  if (!safeSessionId(id)) throw new BoardStoreError("Invalid session id");
  return path.join(handoffDir(root), `${id}.md`);
}

function decisionFile(id: string, root: string) {
  return path.join(sessionDir(id, root), "decision.json");
}

export function emptyDecision(): DecisionRecord {
  return { status: "undecided", choice: "", rationale: "", outcome: "", updatedAt: 0 };
}

function isRealDate(value: string) {
  if (!DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** `YYYY-MM-DD` for a moment, in this machine's own time zone. */
export function localDay(ms: number) {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function requireBoardSession(id: string, root: string): Promise<SessionMeta> {
  const meta = await requireSession(id, root);
  if (meta.kind !== "board") {
    throw new BoardStoreError("Only board sessions carry a decision. This one is a research trial.");
  }
  return meta;
}

async function readSaved(id: string, root: string): Promise<DecisionRecord | null> {
  try {
    const saved = JSON.parse(await readFile(decisionFile(id, root), "utf8")) as Partial<DecisionRecord>;
    return {
      ...emptyDecision(),
      ...saved,
      status: STATUSES.includes(saved.status as DecisionStatus) ? (saved.status as DecisionStatus) : "undecided",
    };
  } catch {
    return null;
  }
}

/** The saved record, or an empty "undecided" one if the owner has not written anything yet. */
export async function readDecision(id: string, root = boardRoot()): Promise<DecisionRecord> {
  await requireBoardSession(id, root);
  return (await readSaved(id, root)) ?? emptyDecision();
}

function cleanText(value: unknown, fallback: string, max: number, label: string) {
  if (value === undefined) return fallback;
  if (typeof value !== "string") throw new BoardStoreError(`${label} must be text`);
  const text = value.trim();
  if (text.length > max) {
    throw new BoardStoreError(`${label} is longer than ${max.toLocaleString("en-US")} characters`);
  }
  return text;
}

export async function saveDecision(
  id: string,
  draft: DecisionDraft,
  root = boardRoot(),
  now = Date.now(),
): Promise<{ decision: DecisionRecord; handoff: string }> {
  await requireBoardSession(id, root);
  const before = (await readSaved(id, root)) ?? emptyDecision();

  const status = draft.status === undefined ? before.status : draft.status;
  if (!STATUSES.includes(status)) throw new BoardStoreError("Unknown decision status");
  const choice = cleanText(draft.choice, before.choice, MAX_CHOICE, "What you decided");
  const rationale = cleanText(draft.rationale, before.rationale, MAX_LONG, "Why");
  const outcome = cleanText(draft.outcome, before.outcome, MAX_LONG, "What happened");

  let reviewOn = before.reviewOn;
  if (draft.reviewOn !== undefined) {
    const raw = typeof draft.reviewOn === "string" ? draft.reviewOn.trim() : "";
    if (raw && !isRealDate(raw)) throw new BoardStoreError("The review date must be a real date, like 2026-03-01");
    reviewOn = raw || undefined;
  }
  if (status === "decided" && !choice) {
    throw new BoardStoreError("Write what you decided before marking this as decided");
  }

  const decision: DecisionRecord = {
    status,
    choice,
    rationale,
    reviewOn,
    outcome,
    decidedAt: status === "decided" ? (before.status === "decided" && before.decidedAt ? before.decidedAt : now) : undefined,
    updatedAt: now,
  };
  await writeText(decisionFile(id, root), `${JSON.stringify(decision, null, 2)}\n`);
  return { decision, handoff: await writeHandoff(id, root, now) };
}

/* ---------- Loose ends ---------- */

/**
 * Why a decision still needs the owner, or null when nothing is outstanding.
 * `today` is `YYYY-MM-DD`.
 */
export function looseEnd(decision: DecisionRecord, sessionFinished: boolean, today: string): string | null {
  const due = Boolean(decision.reviewOn && decision.reviewOn <= today);
  switch (decision.status) {
    case "dropped":
      return null;
    case "undecided":
      return sessionFinished
        ? "The board has reported. You have not decided."
        : "The session was started but the board has not finished.";
    case "parked":
      if (!decision.reviewOn) return "Parked with no date to come back to it.";
      return due ? `Parked until ${decision.reviewOn}. That date has arrived.` : null;
    case "decided":
      if (decision.outcome) return null;
      return due ? `Review was due ${decision.reviewOn}. Record what happened.` : null;
  }
}

/* ---------- Reading the memo ---------- */

/** The text under one `## Heading` of a memo, up to the next heading. */
export function memoSection(memo: string | null, heading: string): string | null {
  if (!memo) return null;
  const lines = memo.split("\n");
  const wanted = heading.trim().toLowerCase();
  const start = lines.findIndex((line) => {
    const m = line.match(/^#{1,6}\s+(.*?)\s*#*\s*$/);
    return Boolean(m && m[1].trim().toLowerCase() === wanted);
  });
  if (start < 0) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^#{1,6}\s+/.test(line));
  const text = (end < 0 ? rest : rest.slice(0, end)).join("\n").trim();
  return text || null;
}

/** A member's one-line position, taken from the first line of their opinion. */
export function positionLine(opinion: string | null): string | null {
  if (!opinion) return null;
  const line = opinion.split("\n").find((l) => /^[\s>*_#-]*position[\s*_]*:/i.test(l));
  if (!line) return null;
  const text = line
    .replace(/^[\s>*_#-]*position[\s*_]*:?[\s*_]*/i, "")
    .replace(/\*\*/g, "")
    .trim();
  return text || null;
}

/* ---------- Hand-off file ---------- */

function when(ms?: number) {
  return ms ? new Date(ms).toISOString() : "";
}

function quoted(text: string) {
  return JSON.stringify(text.replace(/\s+/g, " ").trim());
}

const STATUS_WORDS: Record<DecisionStatus, string> = {
  undecided: "Not decided yet",
  decided: "Decided",
  parked: "Parked",
  dropped: "Dropped",
};

/** The hand-off as text. Kept separate from the writing so it can be checked without a disk. */
export function handoffText(args: {
  meta: SessionMeta;
  decision: DecisionRecord;
  memo: string | null;
  positions: Array<{ name: string; position: string | null; dropped: boolean }>;
  sessionFolder: string;
  today: string;
  now: number;
}): string {
  const { meta, decision, memo, positions } = args;
  const loose = looseEnd(decision, Boolean(memo), args.today);
  const head = [
    "---",
    `id: ${meta.id}`,
    `title: ${quoted(meta.title)}`,
    `status: ${decision.status}`,
    `decided_at: ${when(decision.decidedAt)}`,
    `review_on: ${decision.reviewOn ?? ""}`,
    `outcome_recorded: ${decision.outcome ? "true" : "false"}`,
    `needs_owner: ${loose ? "true" : "false"}`,
    `sensitive: ${meta.sensitive ? "true" : "false"}`,
    `session_started: ${when(meta.createdAt)}`,
    `session_folder: ${quoted(args.sessionFolder)}`,
    `written_at: ${when(args.now)}`,
    "---",
  ];
  const body: string[] = [
    "",
    `# ${meta.title}`,
    "",
    "## The decision",
    meta.question.trim(),
    "",
    "## Status",
    STATUS_WORDS[decision.status] + (loose ? `. ${loose}` : "."),
    "",
    "## What was decided",
    decision.choice || "Nothing recorded yet.",
    "",
    "## Why",
    decision.rationale || "Nothing recorded yet.",
    "",
    "## Review",
    decision.reviewOn ? `Review on ${decision.reviewOn}.` : "No review date set.",
    "",
    "## What happened",
    decision.outcome || "Nothing recorded yet.",
    "",
    "## What the board recommended",
    memoSection(memo, "Recommendation") ?? (memo ? "The memo has no Recommendation section. See the full memo below." : "The Chair has not written a memo."),
    "",
    "## Next step the board suggested",
    memoSection(memo, "Next step") ?? "None recorded.",
    "",
    "## Still unknown",
    memoSection(memo, "What is missing or unknown") ?? "None recorded.",
    "",
    "## Where each member stood",
  ];
  if (positions.length) {
    for (const p of positions) {
      const text = p.dropped ? "Left out of this session." : (p.position ?? "No opinion recorded.");
      body.push(`- **${p.name}:** ${text}`);
    }
  } else {
    body.push("No members.");
  }
  if (memo) {
    body.push("", "## The Chair's memo in full", "", memo.trim().replace(/^(#{1,5})\s/gm, "#$1 "));
  }
  return `${[...head, ...body].join("\n")}\n`;
}

/** Writes (or rewrites) the hand-off file for one session and returns its path. */
export async function writeHandoff(id: string, root = boardRoot(), now = Date.now()): Promise<string> {
  const meta = await requireBoardSession(id, root);
  const decision = (await readSaved(id, root)) ?? emptyDecision();
  const chairDone = (await readChairState(id, root)).memo.status === "done";
  const memo = chairDone ? await readChairMemo(id, root) : null;
  const positions = await Promise.all(
    meta.members.map(async (seat) => {
      const state = await readSeatState(id, seat.slug, root);
      // Opinions stay out of the hand-off until the Chair has reported, the same as on screen.
      const opinion = chairDone ? await readSeatText(id, seat.slug, "opinion", root) : null;
      return { name: seat.name, position: positionLine(opinion), dropped: Boolean(state.dropped) };
    }),
  );
  const file = handoffFile(id, root);
  await mkdir(handoffDir(root), { recursive: true });
  await writeText(
    file,
    handoffText({
      meta,
      decision,
      memo,
      positions,
      sessionFolder: sessionDir(id, root),
      today: localDay(now),
      now,
    }),
  );
  return file;
}

/**
 * Keeps the hand-off in step with the session: written once the Chair has
 * reported or the owner has recorded something, and rewritten after that
 * whenever the session changes. Returns null when there is nothing to hand off yet.
 */
export async function syncHandoff(id: string, root = boardRoot(), now = Date.now()): Promise<string | null> {
  const meta = safeSessionId(id) ? await requireSession(id, root) : null;
  if (!meta || meta.kind !== "board") return null;
  const worthWriting =
    (await exists(handoffFile(id, root))) ||
    (await exists(decisionFile(id, root))) ||
    (await readChairState(id, root)).memo.status === "done";
  return worthWriting ? writeHandoff(id, root, now) : null;
}

export async function removeHandoff(id: string, root = boardRoot()) {
  if (!safeSessionId(id)) return;
  await rm(handoffFile(id, root), { force: true });
}

/* ---------- The list ---------- */

export async function listDecisions(root = boardRoot(), now = Date.now()): Promise<DecisionRow[]> {
  const today = localDay(now);
  const rows: DecisionRow[] = [];
  for (const session of await listSessions(root)) {
    if (session.kind !== "board") continue;
    const decision = (await readSaved(session.id, root)) ?? emptyDecision();
    const memo = session.finished ? await readChairMemo(session.id, root) : null;
    const file = handoffFile(session.id, root);
    rows.push({
      id: session.id,
      title: session.title,
      question: session.question,
      createdAt: session.createdAt,
      speed: session.speed,
      members: session.members,
      sessionFinished: session.finished,
      recommendation: memoSection(memo, "Recommendation"),
      decision,
      looseEnd: looseEnd(decision, session.finished, today),
      handoff: (await exists(file)) ? file : null,
    });
  }
  return rows;
}
