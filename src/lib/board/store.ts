import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { STARTER_MEMBERS } from "./starters";
import {
  OWN_SOURCES,
  type Member,
  type MemberDraft,
  type MemberFile,
  type MemberMeta,
  type MemberSummary,
  type OwnSource,
} from "./types";

/**
 * Members live on disk as plain files so they can be edited by hand or by
 * another agent. Every read goes to disk; nothing is cached.
 *
 *   data/board/members/<slug>/member.json
 *   data/board/members/<slug>/profile.md
 *   data/board/members/<slug>/directives.md
 *   data/board/members/<slug>/files/*.md
 */

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const FILE_RE = /^[a-z0-9][a-z0-9-_]{0,63}\.md$/;
const MAX_TEXT = 200_000;

export class BoardStoreError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export function boardRoot(): string {
  return (
    process.env.PRISM_BOARD_DIR?.trim() ||
    path.join(process.cwd(), "data", "board")
  );
}

export function membersDir(root = boardRoot()) {
  return path.join(root, "members");
}

export function memberDir(slug: string, root = boardRoot()) {
  return path.join(membersDir(root), requireSlug(slug));
}

export function safeSlug(raw: unknown): string | null {
  return typeof raw === "string" && SLUG_RE.test(raw) ? raw : null;
}

function requireSlug(raw: unknown): string {
  const slug = safeSlug(raw);
  if (!slug) throw new BoardStoreError("Invalid member id");
  return slug;
}

export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return slug || "member";
}

/** Normalises a living-file name to `something.md`, or null when unusable. */
export function safeFileName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const base = raw
    .trim()
    .toLowerCase()
    .replace(/\.md$/, "")
    .replace(/\s+/g, "-");
  const name = `${base}.md`;
  return FILE_RE.test(name) ? name : null;
}

function requireFileName(raw: unknown): string {
  const name = safeFileName(raw);
  if (!name) {
    throw new BoardStoreError(
      "File names use letters, numbers, dashes and underscores, and end in .md",
    );
  }
  return name;
}

export async function exists(target: string) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

export async function readText(file: string): Promise<string> {
  try {
    return await readFile(file, "utf8");
  } catch {
    return "";
  }
}

/** Write through a temp file so a crash never leaves a half-written file. */
export async function writeText(file: string, text: string) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, text, "utf8");
  await rename(tmp, file);
}

function clip(text: unknown, label: string): string {
  if (typeof text !== "string") return "";
  if (text.length > MAX_TEXT) {
    throw new BoardStoreError(`${label} is longer than ${MAX_TEXT.toLocaleString()} characters`);
  }
  return text;
}

/** Keeps only the own-record sources this app knows, in a fixed order. Undefined when there are none. */
export function cleanSources(raw: unknown): OwnSource[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const picked = OWN_SOURCES.filter((source) => raw.includes(source));
  return picked.length ? picked : undefined;
}

function nameFromSlug(slug: string) {
  const words = slug.replace(/-+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : slug;
}

async function readMeta(slug: string, root: string): Promise<MemberMeta | null> {
  const dir = memberDir(slug, root);
  let info;
  try {
    info = await stat(dir);
  } catch {
    return null;
  }
  if (!info.isDirectory()) return null;
  const fallbackTime = Math.round(info.birthtimeMs || info.mtimeMs || 0);
  let parsed: Partial<MemberMeta> = {};
  try {
    parsed = JSON.parse(await readFile(path.join(dir, "member.json"), "utf8")) as Partial<MemberMeta>;
  } catch {
    // A folder made by hand has no member.json yet; describe it from its name.
  }
  return {
    slug,
    name: typeof parsed.name === "string" && parsed.name.trim() ? parsed.name : nameFromSlug(slug),
    title: typeof parsed.title === "string" ? parsed.title : "",
    model: typeof parsed.model === "string" && parsed.model ? parsed.model : undefined,
    sources: cleanSources(parsed.sources),
    createdAt: typeof parsed.createdAt === "number" ? parsed.createdAt : fallbackTime,
    updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : fallbackTime,
  };
}

async function readFiles(slug: string, root: string): Promise<MemberFile[]> {
  const dir = path.join(memberDir(slug, root), "files");
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const files: MemberFile[] = [];
  for (const name of names.sort()) {
    if (!FILE_RE.test(name)) continue;
    const full = path.join(dir, name);
    try {
      const [content, info] = await Promise.all([readFile(full, "utf8"), stat(full)]);
      files.push({ name, content, updatedAt: Math.round(info.mtimeMs) });
    } catch {
      // skip unreadable files
    }
  }
  return files;
}

export async function readMember(slug: string, root = boardRoot()): Promise<Member | null> {
  if (!safeSlug(slug)) return null;
  const meta = await readMeta(slug, root);
  if (!meta) return null;
  const dir = memberDir(slug, root);
  const [profile, directives, files] = await Promise.all([
    readText(path.join(dir, "profile.md")),
    readText(path.join(dir, "directives.md")),
    readFiles(slug, root),
  ]);
  return { ...meta, profile, directives, files };
}

async function memberSlugs(root: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(membersDir(root), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && SLUG_RE.test(e.name))
    .map((e) => e.name);
}

export async function listMembers(root = boardRoot()): Promise<MemberSummary[]> {
  const rows: MemberSummary[] = [];
  for (const slug of await memberSlugs(root)) {
    const member = await readMember(slug, root);
    if (!member) continue;
    const { profile, directives, files, ...meta } = member;
    rows.push({
      ...meta,
      profileChars: profile.length,
      directivesChars: directives.length,
      fileCount: files.length,
    });
  }
  return rows.sort((a, b) => a.createdAt - b.createdAt || a.name.localeCompare(b.name));
}

async function uniqueSlug(base: string, root: string): Promise<string> {
  const taken = new Set(await memberSlugs(root));
  if (!taken.has(base)) return base;
  for (let i = 2; i < 500; i += 1) {
    const candidate = `${base.slice(0, 44)}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new BoardStoreError("Could not find a free member id");
}

function cleanName(raw: unknown): string {
  const name = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
  if (!name) throw new BoardStoreError("A member needs a name");
  if (name.length > 80) throw new BoardStoreError("Name is longer than 80 characters");
  return name;
}

function cleanTitle(raw: unknown): string {
  const title = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
  if (title.length > 240) throw new BoardStoreError("Title is longer than 240 characters");
  return title;
}

async function writeMeta(meta: MemberMeta, root: string) {
  const { model, ...rest } = meta;
  const body = model ? { ...rest, model } : rest;
  await writeText(
    path.join(memberDir(meta.slug, root), "member.json"),
    `${JSON.stringify(body, null, 2)}\n`,
  );
}

export async function createMember(
  draft: MemberDraft,
  root = boardRoot(),
  now = Date.now(),
): Promise<Member> {
  const name = cleanName(draft.name);
  const slug = await uniqueSlug(slugify(name), root);
  const dir = memberDir(slug, root);
  const meta: MemberMeta = {
    slug,
    name,
    title: cleanTitle(draft.title),
    model: draft.model?.trim() || undefined,
    sources: cleanSources(draft.sources),
    createdAt: now,
    updatedAt: now,
  };
  await mkdir(path.join(dir, "files"), { recursive: true });
  await writeMeta(meta, root);
  await writeText(path.join(dir, "profile.md"), clip(draft.profile, "Profile"));
  await writeText(path.join(dir, "directives.md"), clip(draft.directives, "Research directives"));
  for (const file of draft.files ?? []) {
    await writeText(
      path.join(dir, "files", requireFileName(file.name)),
      clip(file.content, "File"),
    );
  }
  const member = await readMember(slug, root);
  if (!member) throw new BoardStoreError("Member could not be read back", 500);
  return member;
}

export async function updateMember(
  slug: string,
  patch: Partial<Pick<MemberDraft, "name" | "title" | "profile" | "directives" | "model" | "sources">>,
  root = boardRoot(),
  now = Date.now(),
): Promise<Member> {
  const meta = await readMeta(requireSlug(slug), root);
  if (!meta) throw new BoardStoreError("Member not found", 404);
  const dir = memberDir(slug, root);
  const next: MemberMeta = {
    ...meta,
    name: patch.name !== undefined ? cleanName(patch.name) : meta.name,
    title: patch.title !== undefined ? cleanTitle(patch.title) : meta.title,
    model: patch.model !== undefined ? patch.model.trim() || undefined : meta.model,
    sources: patch.sources !== undefined ? cleanSources(patch.sources) : meta.sources,
    updatedAt: now,
  };
  if (patch.profile !== undefined) {
    await writeText(path.join(dir, "profile.md"), clip(patch.profile, "Profile"));
  }
  if (patch.directives !== undefined) {
    await writeText(
      path.join(dir, "directives.md"),
      clip(patch.directives, "Research directives"),
    );
  }
  await writeMeta(next, root);
  const member = await readMember(slug, root);
  if (!member) throw new BoardStoreError("Member could not be read back", 500);
  return member;
}

export async function duplicateMember(
  slug: string,
  root = boardRoot(),
  now = Date.now(),
): Promise<Member> {
  const source = await readMember(requireSlug(slug), root);
  if (!source) throw new BoardStoreError("Member not found", 404);
  return createMember(
    {
      name: `${source.name} (copy)`.slice(0, 80),
      title: source.title,
      profile: source.profile,
      directives: source.directives,
      model: source.model,
      sources: source.sources,
      files: source.files.map((f) => ({ name: f.name, content: f.content })),
    },
    root,
    now,
  );
}

/** Moves the folder into `members/.trash/` instead of erasing it. */
export async function deleteMember(
  slug: string,
  root = boardRoot(),
  now = Date.now(),
): Promise<{ trashedTo: string }> {
  const dir = memberDir(slug, root);
  if (!(await exists(dir))) throw new BoardStoreError("Member not found", 404);
  const trash = path.join(membersDir(root), ".trash");
  await mkdir(trash, { recursive: true });
  const trashedTo = path.join(trash, `${slug}-${now}`);
  await rename(dir, trashedTo);
  return { trashedTo };
}

export async function saveMemberFile(
  slug: string,
  rawName: string,
  content: string,
  root = boardRoot(),
  now = Date.now(),
): Promise<Member> {
  const meta = await readMeta(requireSlug(slug), root);
  if (!meta) throw new BoardStoreError("Member not found", 404);
  const name = requireFileName(rawName);
  await writeText(path.join(memberDir(slug, root), "files", name), clip(content, "File"));
  await writeMeta({ ...meta, updatedAt: now }, root);
  const member = await readMember(slug, root);
  if (!member) throw new BoardStoreError("Member could not be read back", 500);
  return member;
}

export async function deleteMemberFile(
  slug: string,
  rawName: string,
  root = boardRoot(),
): Promise<Member> {
  const name = requireFileName(rawName);
  const file = path.join(memberDir(slug, root), "files", name);
  if (!(await exists(file))) throw new BoardStoreError("File not found", 404);
  await rm(file);
  const member = await readMember(slug, root);
  if (!member) throw new BoardStoreError("Member not found", 404);
  return member;
}

/**
 * Writes the starter members the first time the Board is opened. Once the
 * members folder exists this does nothing, so deleting a starter sticks.
 */
export async function seedStartersOnFirstRun(
  root = boardRoot(),
  now = Date.now(),
): Promise<boolean> {
  if (await exists(membersDir(root))) return false;
  await mkdir(membersDir(root), { recursive: true });
  for (const [i, draft] of STARTER_MEMBERS.entries()) {
    await createMember(draft, root, now + i);
  }
  return true;
}

/** Adds back any starter whose name is no longer present. Never overwrites. */
export async function restoreMissingStarters(
  root = boardRoot(),
  now = Date.now(),
): Promise<string[]> {
  await mkdir(membersDir(root), { recursive: true });
  const present = new Set((await listMembers(root)).map((m) => m.name.toLowerCase()));
  const added: string[] = [];
  for (const [i, draft] of STARTER_MEMBERS.entries()) {
    if (present.has(draft.name.toLowerCase())) continue;
    const member = await createMember(draft, root, now + i);
    added.push(member.slug);
  }
  return added;
}
