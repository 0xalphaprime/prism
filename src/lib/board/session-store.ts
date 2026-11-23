import { mkdir, readdir, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { clampLimits, overlapReport, readPages } from "./research";
import { BoardStoreError, boardRoot, exists, readMember, readText, safeSlug, slugify, writeText } from "./store";
import type {
  MemberPlan,
  MemberSnapshot,
  MemberStepName,
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
 * A session is a folder of plain files, one sub-folder per member:
 *
 *   data/board/sessions/<id>/session.json
 *   data/board/sessions/<id>/members/<slug>/member.json   (the member as they were at the start)
 *   data/board/sessions/<id>/members/<slug>/state.json
 *   data/board/sessions/<id>/members/<slug>/plan.json
 *   data/board/sessions/<id>/members/<slug>/research.json
 *   data/board/sessions/<id>/members/<slug>/notes.md
 *
 * Each member's progress is kept in that member's own folder, so members can
 * work at the same time without writing over each other.
 */

const ID_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;
const MAX_QUESTION = 4000;
const MAX_MATERIAL = 400_000;

export const MEMBER_STEPS: MemberStepName[] = ["plan", "research", "notes"];

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

function seatDir(id: string, slug: string, root: string) {
  if (!safeSlug(slug)) throw new BoardStoreError("Invalid member id");
  return path.join(sessionDir(id, root), "members", slug);
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

export function freshSeatState(): SeatState {
  return { steps: { plan: idleState(), research: idleState(), notes: idleState() } };
}

function titleFrom(question: string) {
  const line = question.trim().split("\n")[0].replace(/\s+/g, " ");
  return line.length > 80 ? `${line.slice(0, 77)}...` : line;
}

export async function createSession(
  draft: SessionDraft,
  root = boardRoot(),
  now = Date.now(),
): Promise<SessionMeta> {
  const question = typeof draft.question === "string" ? draft.question.trim() : "";
  if (!question) throw new BoardStoreError("Write the question you want looked into");
  if (question.length > MAX_QUESTION) {
    throw new BoardStoreError(`The question is longer than ${MAX_QUESTION.toLocaleString("en-US")} characters`);
  }
  const material = typeof draft.material === "string" ? draft.material : "";
  if (material.length > MAX_MATERIAL) {
    throw new BoardStoreError(`The material is longer than ${MAX_MATERIAL.toLocaleString("en-US")} characters`);
  }
  const model = typeof draft.model === "string" ? draft.model.trim() : "";
  if (!model) throw new BoardStoreError("Choose a model");

  const slugs = [...new Set(Array.isArray(draft.members) ? draft.members : [])];
  if (!slugs.length) throw new BoardStoreError("Choose at least one member");
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
  const meta: SessionMeta = {
    id: newSessionId(title, now),
    kind: "trial",
    title: title.slice(0, 120),
    question,
    material,
    sensitive,
    approveSearches: sensitive || Boolean(draft.approveSearches),
    model,
    limits: clampLimits(draft.limits),
    members: snapshots.map(({ slug, name, title: t, model: m }) => ({ slug, name, title: t, model: m })),
    createdAt: now,
    updatedAt: now,
  };

  await mkdir(sessionDir(meta.id, root), { recursive: true });
  for (const snapshot of snapshots) {
    const dir = seatDir(meta.id, snapshot.slug, root);
    await writeJson(path.join(dir, "member.json"), snapshot);
    await writeJson(path.join(dir, "state.json"), freshSeatState());
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
    rows.push({
      id: meta.id,
      kind: meta.kind,
      title: meta.title,
      question: meta.question,
      createdAt: meta.createdAt,
      members: meta.members.map((m) => m.name),
      sensitive: meta.sensitive,
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

/* ---------- One member's folder inside a session ---------- */

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

export async function readPlan(id: string, slug: string, root = boardRoot()) {
  return readJson<MemberPlan>(path.join(seatDir(id, slug, root), "plan.json"));
}

export async function writePlan(id: string, slug: string, plan: MemberPlan, root = boardRoot()) {
  await writeJson(path.join(seatDir(id, slug, root), "plan.json"), plan);
}

export async function readResearch(id: string, slug: string, root = boardRoot()) {
  return readJson<ResearchRecord>(path.join(seatDir(id, slug, root), "research.json"));
}

export async function writeResearch(id: string, slug: string, record: ResearchRecord, root = boardRoot()) {
  await writeJson(path.join(seatDir(id, slug, root), "research.json"), record);
}

export async function readNotes(id: string, slug: string, root = boardRoot()): Promise<string | null> {
  const file = path.join(seatDir(id, slug, root), "notes.md");
  return (await exists(file)) ? readText(file) : null;
}

export async function writeNotes(id: string, slug: string, notes: string, root = boardRoot()) {
  await writeText(path.join(seatDir(id, slug, root), "notes.md"), notes);
}

const STEP_FILES: Record<MemberStepName, string> = {
  plan: "plan.json",
  research: "research.json",
  notes: "notes.md",
};

/** Removes what a step wrote, so a rerun never leaves a stale result behind. */
export async function removeStepOutput(id: string, slug: string, step: MemberStepName, root = boardRoot()) {
  await rm(path.join(seatDir(id, slug, root), STEP_FILES[step]), { force: true });
}

/* ---------- What the screen is given ---------- */

export async function readSessionView(id: string, root = boardRoot()): Promise<SessionView> {
  const meta = await requireSession(id, root);
  const members: SessionMemberView[] = [];
  for (const seat of meta.members) {
    const [state, plan, research, notes] = await Promise.all([
      readSeatState(id, seat.slug, root),
      readPlan(id, seat.slug, root),
      readResearch(id, seat.slug, root),
      readNotes(id, seat.slug, root),
    ]);
    members.push({ ...seat, state, plan, research, notes });
  }
  return {
    ...meta,
    members,
    overlap: overlapReport(
      members.map((m) => ({
        slug: m.slug,
        pages: readPages(m.research).map((p) => ({ url: p.url, title: p.title })),
      })),
    ),
    dir: sessionDir(id, root),
  };
}
