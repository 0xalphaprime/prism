import { lessonsPrompt, parseLessons } from "./compose";
import { readDecision } from "./decisions";
import type { RunnerDeps, StepOutcome } from "./session-runner";
import {
  readChairMemo,
  readChairState,
  readLatestOpinion,
  readLessons,
  readSeatState,
  readSnapshot,
  requireSession,
  writeLessons,
} from "./session-store";
import { BoardStoreError, boardRoot, readMember, saveMemberFile } from "./store";
import type { LessonProposal, LessonsRecord, SessionMeta } from "./types";

/**
 * Lessons are how a member's living file grows. After the owner has dealt with
 * a decision, a member can propose a few lines for their `lessons.md`. Nothing
 * is written to the member until the owner approves a line, and the owner can
 * reword it first.
 */

export const LESSONS_FILE = "lessons.md";
const STALE_AFTER_MS = 10 * 60 * 1000;
const MAX_LESSON = 500;

async function requireFinished(id: string, slug: string, root: string): Promise<SessionMeta> {
  const meta = await requireSession(id, root);
  if (meta.kind !== "board") throw new BoardStoreError("Only board sessions produce lessons", 409);
  if (!meta.members.some((m) => m.slug === slug)) {
    throw new BoardStoreError("This member is not part of the session", 404);
  }
  if ((await readChairState(id, root)).memo.status !== "done") {
    throw new BoardStoreError("Lessons come after the Chair's memo", 409);
  }
  if ((await readSeatState(id, slug, root)).dropped) {
    throw new BoardStoreError("This member was left out of the session", 409);
  }
  return meta;
}

/** Asks one member what they would carry forward. Lines already approved are kept. */
export async function proposeLessons(
  id: string,
  slug: string,
  deps: RunnerDeps,
  opts: { force?: boolean } = {},
): Promise<StepOutcome> {
  const root = deps.root ?? boardRoot();
  const now = deps.now ?? Date.now;
  const meta = await requireFinished(id, slug, root);
  const before: LessonsRecord = (await readLessons(id, slug, root)) ?? { state: { status: "idle" }, proposals: [] };
  if (
    before.state.status === "running" &&
    !opts.force &&
    now() - (before.state.startedAt ?? 0) < STALE_AFTER_MS
  ) {
    throw new BoardStoreError("This step is already running", 409);
  }
  const [memo, opinion, decision, member] = await Promise.all([
    readChairMemo(id, root),
    readLatestOpinion(id, slug, root),
    readDecision(id, root),
    readSnapshot(id, slug, root),
  ]);
  if (!memo?.trim() || !opinion.text?.trim()) {
    throw new BoardStoreError("The memo or this member's opinion is missing", 409);
  }

  const kept = before.proposals.filter((p) => p.status === "approved");
  const startedAt = now();
  await writeLessons(id, slug, { state: { status: "running", startedAt }, proposals: kept }, root);
  try {
    const prompt = lessonsPrompt({ member, question: meta.question, opinion: opinion.text, memo, decision });
    const seat = meta.members.find((m) => m.slug === slug);
    const reply = await deps.chat({
      model: seat?.model || meta.model,
      system: prompt.system,
      user: prompt.user,
      maxTokens: prompt.maxTokens,
    });
    const taken = new Set(kept.map((p) => p.id));
    let n = 0;
    const fresh: LessonProposal[] = parseLessons(reply.content ?? "").map((lesson) => {
      do n += 1;
      while (taken.has(`L${n}`));
      return { id: `L${n}`, text: lesson.text, status: "proposed" };
    });
    await writeLessons(
      id,
      slug,
      {
        state: { status: "done", startedAt, finishedAt: now(), model: reply.model ?? meta.model, saw: prompt.saw },
        proposals: [...kept, ...fresh],
      },
      root,
    );
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeLessons(
      id,
      slug,
      { state: { status: "error", startedAt, finishedAt: now(), error: message }, proposals: kept },
      root,
    );
    return { ok: false, error: message };
  }
}

function day(ms: number) {
  return new Date(ms).toISOString().slice(0, 10);
}

/** What gets added to the member's file for one approved lesson. */
export function lessonEntry(text: string, title: string, now: number) {
  return `- ${text.replace(/\s+/g, " ").trim()} _(${day(now)}, from "${title.replace(/["\n]/g, " ").trim()}")_`;
}

/**
 * Approves or rejects one proposed lesson. Approving adds a line to the
 * member's own `lessons.md` (the live member, not the copy in this session),
 * so it is read in every later session.
 */
export async function decideLesson(
  id: string,
  slug: string,
  lessonId: string,
  action: { approve: boolean; text?: string },
  root = boardRoot(),
  now = Date.now(),
): Promise<{ record: LessonsRecord; file: string | null }> {
  const meta = await requireFinished(id, slug, root);
  const record = await readLessons(id, slug, root);
  const proposal = record?.proposals.find((p) => p.id === lessonId);
  if (!record || !proposal) throw new BoardStoreError("Lesson not found", 404);
  if (proposal.status !== "proposed") {
    throw new BoardStoreError(`This lesson was already ${proposal.status}`, 409);
  }

  let file: string | null = null;
  if (action.approve) {
    const text = (typeof action.text === "string" ? action.text : proposal.text).replace(/\s+/g, " ").trim();
    if (!text) throw new BoardStoreError("The lesson is empty");
    if (text.length > MAX_LESSON) throw new BoardStoreError(`A lesson is at most ${MAX_LESSON} characters`);
    const member = await readMember(slug, root);
    if (!member) {
      throw new BoardStoreError("This member no longer exists, so there is no file to add the lesson to", 404);
    }
    const current = member.files.find((f) => f.name === LESSONS_FILE)?.content ?? "";
    const base = current.trim() ? current.replace(/\s+$/, "") : "# Lessons";
    await saveMemberFile(slug, LESSONS_FILE, `${base}\n${lessonEntry(text, meta.title, now)}\n`, root, now);
    proposal.text = text;
    proposal.status = "approved";
    file = LESSONS_FILE;
  } else {
    proposal.status = "rejected";
  }
  proposal.decidedAt = now;
  await writeLessons(id, slug, record, root);
  return { record, file };
}
