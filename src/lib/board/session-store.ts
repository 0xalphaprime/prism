import { mkdir, readdir, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { clampLimits, overlapReport, readPages } from "./research";
import { BoardStoreError, boardRoot, exists, readMember, readText, safeSlug, slugify, writeText } from "./store";
import type {
  ChairState,
  GeneralistState,
  GeneralistStepName,
  MemberPlan,
  MemberSnapshot,
  MemberStepName,
  ResearchLimits,
  ResearchRecord,
  SeatState,
  SessionDraft,
  SessionMemberView,
  SessionMeta,
  SessionSummary,
  SessionView,
  StepState,
} from "./types";

/**
 * A session is a folder of plain files:
 *
 *   data/board/sessions/<id>/session.json
 *   data/board/sessions/<id>/members/<slug>/member.json   (the member as they were at the start)
 *   data/board/sessions/<id>/members/<slug>/state.json
 *   data/board/sessions/<id>/members/<slug>/plan.json
 *   data/board/sessions/<id>/members/<slug>/research.json
 *   data/board/sessions/<id>/members/<slug>/notes.md
 *   data/board/sessions/<id>/members/<slug>/opinion.md
 *   data/board/sessions/<id>/chair.md  (+ chair.json for its progress)
 *   data/board/sessions/<id>/generalist/{state.json,plan.json,research.json,memo.md}
 *
 * Each member's progress is kept in that member's own folder, so members can
 * work at the same time without writing over each other.
 */

const ID_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;
const MAX_QUESTION = 4000;
const MAX_MATERIAL = 400_000;
const MAX_STANDING = 20_000;

/** Folder name for the generalist. Not a valid member id, so it can never collide with one. */
export const GENERALIST = "@generalist";

export const MEMBER_STEPS: MemberStepName[] = ["plan", "research", "notes", "opinion"];
export const GENERALIST_STEPS: GeneralistStepName[] = ["plan", "research", "memo"];

export function sessionsDir(root = boardRoot()) {
  return path.join(root, "sessions");
}

export function safeSessionId(raw: unknown): string | null {
  return typeof raw === "string" && ID_RE.test(raw) ? raw : null;
}

export function sessionDir(id: string, root = boardRoot()) {
  if (!safeSessionId(id)) throw new BoardStoreError("Invalid session id");
  return path.join(sessionsDir(root), id);
}

/** The folder one seat writes into: a member's, or the generalist's. */
function seatDir(id: string, seat: string, root: string) {
  if (seat === GENERALIST) return path.join(sessionDir(id, root), "generalist");
  if (!safeSlug(seat)) throw new BoardStoreError("Invalid member id");
  return path.join(sessionDir(id, root), "members", seat);
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

async function writeJson(file: string, value: unknown) {
  await writeText(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function readOptionalText(file: string): Promise<string | null> {
  return (await exists(file)) ? readText(file) : null;
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function newSessionId(title: string, now: number) {
  const d = new Date(now);
  const stamp = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;
  const rand = Math.random().toString(36).slice(2, 6).padEnd(4, "0");
  return `${stamp}-${slugify(title).slice(0, 32).replace(/-+$/g, "") || "session"}-${rand}`;
}

export function idleState(): StepState {
  return { status: "idle" };
}

function skippedState(now: number): StepState {
  return { status: "skipped", finishedAt: now };
}

export function freshSeatState(): SeatState {
  return {
    steps: { plan: idleState(), research: idleState(), notes: idleState(), opinion: idleState() },
  };
}

export function freshGeneralistState(): GeneralistState {
  return { steps: { plan: idleState(), research: idleState(), memo: idleState() } };
}

function titleFrom(question: string) {
  const line = question.trim().split("\n")[0].replace(/\s+/g, " ");
  return line.length > 80 ? `${line.slice(0, 77)}...` : line;
}

/* ---------- Standing context ---------- */

function standingFile(root: string) {
  return path.join(root, "standing.md");
}

/** What every member should always know about the owner. One shared file. */
export async function readStanding(root = boardRoot()): Promise<string> {
  return readText(standingFile(root));
}

export async function writeStanding(text: string, root = boardRoot()): Promise<string> {
  if (typeof text !== "string") throw new BoardStoreError("Standing context must be text");
  if (text.length > MAX_STANDING) {
    throw new BoardStoreError(
      `Standing context is longer than ${MAX_STANDING.toLocaleString("en-US")} characters`,
    );
  }
  await writeText(standingFile(root), text);
  return text;
}

/* ---------- Sessions ---------- */

export async function createSession(
  draft: SessionDraft,
  root = boardRoot(),
  now = Date.now(),
): Promise<SessionMeta> {
  const kind = draft.kind === "board" ? "board" : "trial";
  const question = typeof draft.question === "string" ? draft.question.trim() : "";
  if (!question) {
    throw new BoardStoreError(
      kind === "board" ? "Write the decision you want advice on" : "Write the question you want looked into",
    );
  }
  if (question.length > MAX_QUESTION) {
    throw new BoardStoreError(`The question is longer than ${MAX_QUESTION.toLocaleString("en-US")} characters`);
  }
  const material = typeof draft.material === "string" ? draft.material : "";
  if (material.length > MAX_MATERIAL) {
    throw new BoardStoreError(`The material is longer than ${MAX_MATERIAL.toLocaleString("en-US")} characters`);
  }
  const model = typeof draft.model === "string" ? draft.model.trim() : "";
  if (!model) throw new BoardStoreError("Choose a model");

  const speed = kind === "board" && draft.speed === "fast" ? "fast" : "standard";
  const slugs = [...new Set(Array.isArray(draft.members) ? draft.members : [])];
  if (!slugs.length) throw new BoardStoreError("Choose at least one member");
  if (speed === "fast" && slugs.length > 2) {
    throw new BoardStoreError("Fast takes one or two members. Choose Standard for the full board.");
  }
  const snapshots: MemberSnapshot[] = [];
  for (const slug of slugs) {
    const member = safeSlug(slug) ? await readMember(slug, root) : null;
    if (!member) throw new BoardStoreError(`Member not found: ${String(slug)}`, 404);
    snapshots.push({
      slug: member.slug,
      name: member.name,
      title: member.title,
      model: member.model,
      profile: member.profile,
      directives: member.directives,
      files: member.files.map((f) => ({ name: f.name, content: f.content })),
    });
  }

  const title = (typeof draft.title === "string" && draft.title.trim()) || titleFrom(question);
  const sensitive = Boolean(draft.sensitive);
  const withGeneralist = kind === "board" && Boolean(draft.withGeneralist);
  const meta: SessionMeta = {
    id: newSessionId(title, now),
    kind,
    title: title.slice(0, 120),
    question,
    material,
    standing: (await readStanding(root)).trim(),
    speed: kind === "board" ? speed : undefined,
    withGeneralist: kind === "board" ? withGeneralist : undefined,
    sensitive,
    approveSearches: sensitive || Boolean(draft.approveSearches),
    model,
    limits: clampLimits(draft.limits),
    members: snapshots.map(({ slug, name, title: t, model: m }) => ({ slug, name, title: t, model: m })),
    createdAt: now,
    updatedAt: now,
  };

  await mkdir(sessionDir(meta.id, root), { recursive: true });
  const fast = speed === "fast";
  for (const snapshot of snapshots) {
    const dir = seatDir(meta.id, snapshot.slug, root);
    const state = freshSeatState();
    if (fast) {
      for (const step of ["plan", "research", "notes"] as const) state.steps[step] = skippedState(now);
    }
    await writeJson(path.join(dir, "member.json"), snapshot);
    await writeJson(path.join(dir, "state.json"), state);
  }
  if (withGeneralist) {
    const state = freshGeneralistState();
    if (fast) {
      state.steps.plan = skippedState(now);
      state.steps.research = skippedState(now);
    }
    await writeJson(path.join(seatDir(meta.id, GENERALIST, root), "state.json"), state);
  }
  await writeJson(path.join(sessionDir(meta.id, root), "session.json"), meta);
  return meta;
}

export async function readSessionMeta(id: string, root = boardRoot()): Promise<SessionMeta | null> {
  if (!safeSessionId(id)) return null;
  return readJson<SessionMeta>(path.join(sessionDir(id, root), "session.json"));
}

export async function requireSession(id: string, root = boardRoot()): Promise<SessionMeta> {
  const meta = await readSessionMeta(id, root);
  if (!meta) throw new BoardStoreError("Session not found", 404);
  return meta;
}

export async function listSessions(root = boardRoot()): Promise<SessionSummary[]> {
  let entries;
  try {
    entries = await readdir(sessionsDir(root), { withFileTypes: true });
  } catch {
    return [];
  }
  const rows: SessionSummary[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !ID_RE.test(entry.name)) continue;
    const meta = await readSessionMeta(entry.name, root);
    if (!meta) continue;
    let finished: boolean;
    if (meta.kind === "board") {
      finished = (await readChairState(meta.id, root)).memo.status === "done";
    } else {
      const states = await Promise.all(meta.members.map((m) => readSeatState(meta.id, m.slug, root)));
      finished = states.every((s) => ["done", "skipped"].includes(s.steps.notes.status));
    }
    rows.push({
      id: meta.id,
      kind: meta.kind,
      title: meta.title,
      question: meta.question,
      createdAt: meta.createdAt,
      members: meta.members.map((m) => m.name),
      sensitive: meta.sensitive,
      speed: meta.speed,
      finished,
    });
  }
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

/** Moves the folder into `sessions/.trash/` instead of erasing it. */
export async function deleteSession(
  id: string,
  root = boardRoot(),
  now = Date.now(),
): Promise<{ trashedTo: string }> {
  const dir = sessionDir(id, root);
  if (!(await exists(dir))) throw new BoardStoreError("Session not found", 404);
  const trash = path.join(sessionsDir(root), ".trash");
  await mkdir(trash, { recursive: true });
  const trashedTo = path.join(trash, `${id}-${now}`);
  await rename(dir, trashedTo);
  return { trashedTo };
}

/* ---------- One seat's folder inside a session ---------- */

export async function readSnapshot(id: string, slug: string, root = boardRoot()): Promise<MemberSnapshot> {
  const snapshot = await readJson<MemberSnapshot>(path.join(seatDir(id, slug, root), "member.json"));
  if (!snapshot) throw new BoardStoreError("This member is not part of the session", 404);
  return snapshot;
}

export async function readSeatState(id: string, slug: string, root = boardRoot()): Promise<SeatState> {
  const saved = await readJson<SeatState>(path.join(seatDir(id, slug, root), "state.json"));
  const fresh = freshSeatState();
  return { ...saved, steps: { ...fresh.steps, ...(saved?.steps ?? {}) } };
}

export async function writeSeatState(id: string, slug: string, state: SeatState, root = boardRoot()) {
  await writeJson(path.join(seatDir(id, slug, root), "state.json"), state);
}

export async function readGeneralistState(id: string, root = boardRoot()): Promise<GeneralistState> {
  const saved = await readJson<GeneralistState>(path.join(seatDir(id, GENERALIST, root), "state.json"));
  const fresh = freshGeneralistState();
  return { steps: { ...fresh.steps, ...(saved?.steps ?? {}) } };
}

export async function writeGeneralistState(id: string, state: GeneralistState, root = boardRoot()) {
  await writeJson(path.join(seatDir(id, GENERALIST, root), "state.json"), state);
}

export async function readChairState(id: string, root = boardRoot()): Promise<ChairState> {
  const saved = await readJson<ChairState>(path.join(sessionDir(id, root), "chair.json"));
  return { memo: saved?.memo ?? idleState() };
}

export async function writeChairState(id: string, state: ChairState, root = boardRoot()) {
  await writeJson(path.join(sessionDir(id, root), "chair.json"), state);
}

/** `seat` is a member id or `GENERALIST`. */
export async function readPlan(id: string, seat: string, root = boardRoot()) {
  return readJson<MemberPlan>(path.join(seatDir(id, seat, root), "plan.json"));
}

export async function writePlan(id: string, seat: string, plan: MemberPlan, root = boardRoot()) {
  await writeJson(path.join(seatDir(id, seat, root), "plan.json"), plan);
}

export async function readResearch(id: string, seat: string, root = boardRoot()) {
  return readJson<ResearchRecord>(path.join(seatDir(id, seat, root), "research.json"));
}

export async function writeResearch(id: string, seat: string, record: ResearchRecord, root = boardRoot()) {
  await writeJson(path.join(seatDir(id, seat, root), "research.json"), record);
}

const TEXT_FILES = {
  notes: "notes.md",
  opinion: "opinion.md",
  memo: "memo.md",
} as const;

export type SeatText = keyof typeof TEXT_FILES;

export async function readSeatText(id: string, seat: string, name: SeatText, root = boardRoot()) {
  return readOptionalText(path.join(seatDir(id, seat, root), TEXT_FILES[name]));
}

export async function writeSeatText(id: string, seat: string, name: SeatText, text: string, root = boardRoot()) {
  await writeText(path.join(seatDir(id, seat, root), TEXT_FILES[name]), text);
}

export async function readChairMemo(id: string, root = boardRoot()) {
  return readOptionalText(path.join(sessionDir(id, root), "chair.md"));
}

export async function writeChairMemo(id: string, memo: string, root = boardRoot()) {
  await writeText(path.join(sessionDir(id, root), "chair.md"), memo);
}

const STEP_FILES: Record<MemberStepName | GeneralistStepName, string> = {
  plan: "plan.json",
  research: "research.json",
  notes: TEXT_FILES.notes,
  opinion: TEXT_FILES.opinion,
  memo: TEXT_FILES.memo,
};

/** Removes what a step wrote, so a rerun never leaves a stale result behind. */
export async function removeStepOutput(
  id: string,
  seat: string,
  step: MemberStepName | GeneralistStepName,
  root = boardRoot(),
) {
  await rm(path.join(seatDir(id, seat, root), STEP_FILES[step]), { force: true });
}

/** The Chair's memo is out of date as soon as any opinion under it changes. */
export async function resetChair(id: string, root = boardRoot()) {
  const state = await readChairState(id, root);
  if (state.memo.status === "idle") return;
  await rm(path.join(sessionDir(id, root), "chair.md"), { force: true });
  await writeChairState(id, { memo: idleState() }, root);
}

/** The generalist gets the same search allowance as the members taking part, added together. */
export function generalistLimits(limits: ResearchLimits, activeMembers: number): ResearchLimits {
  return { ...limits, searches: limits.searches * Math.max(1, activeMembers) };
}

/* ---------- What the screen is given ---------- */

export async function readSessionView(id: string, root = boardRoot()): Promise<SessionView> {
  const readAt = Date.now();
  const meta = await requireSession(id, root);
  const members: SessionMemberView[] = [];
  for (const seat of meta.members) {
    const [state, plan, research, notes, opinion] = await Promise.all([
      readSeatState(id, seat.slug, root),
      readPlan(id, seat.slug, root),
      readResearch(id, seat.slug, root),
      readSeatText(id, seat.slug, "notes", root),
      readSeatText(id, seat.slug, "opinion", root),
    ]);
    members.push({ ...seat, state, plan, research, notes, opinion });
  }

  const board = meta.kind === "board";
  const active = members.filter((m) => !m.state.dropped);
  const sealed = board && !active.every((m) => m.state.steps.opinion.status === "done");
  if (sealed) {
    for (const member of members) {
      member.notes = null;
      member.opinion = null;
    }
  }

  return {
    ...meta,
    members,
    sealed,
    chair: board
      ? { state: await readChairState(id, root), memo: await readChairMemo(id, root) }
      : null,
    generalist:
      board && meta.withGeneralist
        ? {
            state: await readGeneralistState(id, root),
            plan: await readPlan(id, GENERALIST, root),
            research: await readResearch(id, GENERALIST, root),
            memo: await readSeatText(id, GENERALIST, "memo", root),
            limits: generalistLimits(meta.limits, active.length),
          }
        : null,
    overlap: overlapReport(
      members.map((m) => ({
        slug: m.slug,
        pages: readPages(m.research).map((p) => ({ url: p.url, title: p.title })),
      })),
    ),
    dir: sessionDir(id, root),
    readAt,
  };
}
