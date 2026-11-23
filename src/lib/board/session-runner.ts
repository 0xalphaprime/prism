import {
  chairPrompt,
  citedSources,
  generalistMemoPrompt,
  generalistPlanPrompt,
  notesPrompt,
  opinionPrompt,
  planPrompt,
  type Composed,
  type OpinionForChair,
  type SharedBrief,
} from "./compose";
import {
  cleanQueries,
  flagQueries,
  parsePlan,
  readPages,
  runResearch,
  type ReadFn,
  type SearchFn,
} from "./research";
import {
  GENERALIST,
  GENERALIST_STEPS,
  MEMBER_STEPS,
  generalistLimits,
  idleState,
  readChairState,
  readGeneralistState,
  readPlan,
  readResearch,
  readSeatState,
  readSeatText,
  readSnapshot,
  removeStepOutput,
  requireSession,
  resetChair,
  writeChairMemo,
  writeChairState,
  writeGeneralistState,
  writePlan,
  writeResearch,
  writeSeatState,
  writeSeatText,
} from "./session-store";
import { BoardStoreError, boardRoot } from "./store";
import type {
  GeneralistStepName,
  MemberPlan,
  MemberStepName,
  PlannedQuery,
  ResearchLimits,
  SessionMeta,
  StepState,
} from "./types";

/**
 * One function per step. The browser calls them one at a time; each saves
 * what it produced before returning, so a refresh picks up where things were.
 * The model, the search service and the page reader are passed in, so tests
 * can stand in for all three.
 */

export type BoardChatFn = (args: {
  model: string;
  system: string;
  user: string;
  maxTokens: number;
  temperature?: number;
}) => Promise<{ content: string; model?: string }>;

export type RunnerDeps = {
  chat: BoardChatFn;
  search: SearchFn;
  read: ReadFn;
  now?: () => number;
  root?: string;
};

export type StepOutcome = { ok: true } | { ok: false; error: string };

type StepOpts = { force?: boolean };

/** A step left "running" this long is treated as abandoned and may be started again. */
const STALE_AFTER_MS = 10 * 60 * 1000;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function seatOf(meta: SessionMeta, slug: string) {
  const seat = meta.members.find((m) => m.slug === slug);
  if (!seat) throw new BoardStoreError("This member is not part of the session", 404);
  return seat;
}

function requireBoard(meta: SessionMeta) {
  if (meta.kind !== "board") {
    throw new BoardStoreError("A research trial stops at the notes. Start a board session for opinions.", 409);
  }
}

function brief(meta: SessionMeta): SharedBrief {
  return { question: meta.question, material: meta.material, standing: meta.standing };
}

function finished(state: StepState) {
  return state.status === "done" || state.status === "skipped";
}

/**
 * A lane is one seat's ordered steps (a member's, the generalist's, or the
 * Chair's single step) and where their progress is saved.
 */
type Lane = {
  order: string[];
  read: () => Promise<Record<string, StepState>>;
  write: (steps: Record<string, StepState>) => Promise<void>;
  clear: (step: string) => Promise<void>;
};

function memberLane(id: string, slug: string, root: string): Lane {
  return {
    order: MEMBER_STEPS,
    read: async () => (await readSeatState(id, slug, root)).steps,
    write: async (steps) => {
      const state = await readSeatState(id, slug, root);
      await writeSeatState(id, slug, { ...state, steps: steps as typeof state.steps }, root);
    },
    clear: (step) => removeStepOutput(id, slug, step as MemberStepName, root),
  };
}

function generalistLane(id: string, root: string): Lane {
  return {
    order: GENERALIST_STEPS,
    read: async () => (await readGeneralistState(id, root)).steps,
    write: (steps) => writeGeneralistState(id, { steps: steps as Record<GeneralistStepName, StepState> }, root),
    clear: (step) => removeStepOutput(id, GENERALIST, step as GeneralistStepName, root),
  };
}

function chairLane(id: string, root: string): Lane {
  return {
    order: ["memo"],
    read: async () => ({ memo: (await readChairState(id, root)).memo }),
    write: (steps) => writeChairState(id, { memo: steps.memo }, root),
    clear: async () => undefined,
  };
}

async function runStep(
  lane: Lane,
  step: string,
  deps: RunnerDeps,
  opts: StepOpts,
  work: () => Promise<Partial<StepState> | void>,
): Promise<StepOutcome> {
  const now = deps.now ?? Date.now;
  const steps = await lane.read();
  const current = steps[step];
  if (
    current.status === "running" &&
    !opts.force &&
    now() - (current.startedAt ?? 0) < STALE_AFTER_MS
  ) {
    throw new BoardStoreError("This step is already running", 409);
  }

  // Anything built on this step is now out of date.
  for (const name of lane.order.slice(lane.order.indexOf(step) + 1)) {
    steps[name] = idleState();
    await lane.clear(name);
  }
  const startedAt = now();
  steps[step] = { status: "running", startedAt };
  await lane.write(steps);

  let outcome: StepOutcome = { ok: true };
  let result: StepState;
  try {
    const extra = (await work()) ?? {};
    result = { status: "done", startedAt, finishedAt: now(), ...extra };
  } catch (error) {
    if (error instanceof BoardStoreError) {
      const latest = await lane.read();
      latest[step] = current.status === "running" ? idleState() : current;
      await lane.write(latest);
      throw error;
    }
    const message = errorMessage(error);
    result = { status: "error", startedAt, finishedAt: now(), error: message };
    outcome = { ok: false, error: message };
  }
  const latest = await lane.read();
  latest[step] = result;
  await lane.write(latest);
  return outcome;
}

async function ask(deps: RunnerDeps, model: string, prompt: Composed) {
  const reply = await deps.chat({
    model,
    system: prompt.system,
    user: prompt.user,
    maxTokens: prompt.maxTokens,
  });
  const content = (reply.content ?? "").trim();
  if (!content) throw new Error("The model returned nothing");
  return { content, model: reply.model ?? model };
}

function buildPlan(
  meta: SessionMeta,
  queries: PlannedQuery[],
  now: number,
  extra: Partial<MemberPlan> = {},
): MemberPlan {
  const flagged = flagQueries(queries, `${meta.question}\n${meta.material}\n${meta.standing ?? ""}`);
  return {
    queries,
    flagged,
    // Held for the owner when approval is on, or when a search repeats a name
    // or figure from the material.
    approved: queries.length === 0 || !(meta.approveSearches || flagged.length > 0),
    createdAt: now,
    ...extra,
  };
}

/** Shared by members and the generalist: release or edit a held plan, then search inside the limits. */
async function research(args: {
  id: string;
  seat: string;
  lane: Lane;
  meta: SessionMeta;
  limits: ResearchLimits;
  deps: RunnerDeps;
  opts: StepOpts & { approve?: boolean; queries?: unknown };
}): Promise<StepOutcome> {
  const { id, seat, lane, meta, limits, deps, opts } = args;
  const root = deps.root ?? boardRoot();
  const now = deps.now ?? Date.now;
  const steps = await lane.read();
  if (steps.plan.status !== "done") {
    throw new BoardStoreError("The search plan has to be written first", 409);
  }
  let plan = await readPlan(id, seat, root);
  if (!plan) throw new BoardStoreError("The search plan is missing; run it again", 409);

  if (opts.queries !== undefined) {
    plan = buildPlan(meta, cleanQueries(opts.queries, limits.searches), plan.createdAt, {
      editedByOwner: true,
    });
  }
  if (opts.approve) plan = { ...plan, approved: true };
  if (!plan.approved) {
    throw new BoardStoreError("These searches are waiting for your approval", 409);
  }
  await writePlan(id, seat, plan, root);
  const queries = plan.queries;

  return runStep(lane, "research", deps, opts, async () => {
    const record = await runResearch({ queries, limits, search: deps.search, read: deps.read, now });
    await writeResearch(id, seat, record, root);
    const failed = record.queries.filter((q) => q.error);
    if (record.queries.length > 0 && failed.length === record.queries.length) {
      throw new Error(failed[0].error ?? "Every search failed");
    }
    return { saw: record.queries.map((q) => `Search: ${q.query}`) };
  });
}

/* ---------- Members ---------- */

/** Step 1: the member writes the searches they want. Nothing leaves the machine yet. */
export async function runPlanStep(
  id: string,
  slug: string,
  deps: RunnerDeps,
  opts: StepOpts = {},
): Promise<StepOutcome> {
  const root = deps.root ?? boardRoot();
  const now = deps.now ?? Date.now;
  const meta = await requireSession(id, root);
  const seat = seatOf(meta, slug);
  await resetChair(id, root);
  return runStep(memberLane(id, slug, root), "plan", deps, opts, async () => {
    const member = await readSnapshot(id, slug, root);
    const prompt = planPrompt({ member, brief: brief(meta), limits: meta.limits });
    const reply = await ask(deps, seat.model || meta.model, prompt);
    const queries = meta.limits.searches > 0 ? parsePlan(reply.content, meta.limits.searches) : [];
    await writePlan(id, slug, buildPlan(meta, queries, now()), root);
    return { model: reply.model, saw: prompt.saw };
  });
}

/**
 * Step 2: the research desk runs the member's searches inside the limits.
 * `queries` replaces the member's list with the owner's edited one;
 * `approve` releases a held plan.
 */
export async function runResearchStep(
  id: string,
  slug: string,
  deps: RunnerDeps,
  opts: StepOpts & { approve?: boolean; queries?: unknown } = {},
): Promise<StepOutcome> {
  const root = deps.root ?? boardRoot();
  const meta = await requireSession(id, root);
  seatOf(meta, slug);
  await resetChair(id, root);
  return research({
    id,
    seat: slug,
    lane: memberLane(id, slug, root),
    meta,
    limits: meta.limits,
    deps,
    opts,
  });
}

/** Marks research and notes as skipped, so the member goes on with the shared material alone. */
export async function skipResearch(id: string, slug: string, deps: Pick<RunnerDeps, "now" | "root"> = {}) {
  const root = deps.root ?? boardRoot();
  const now = (deps.now ?? Date.now)();
  const meta = await requireSession(id, root);
  seatOf(meta, slug);
  await resetChair(id, root);
  const state = await readSeatState(id, slug, root);
  for (const step of ["research", "notes"] as const) {
    await removeStepOutput(id, slug, step, root);
    state.steps[step] = { status: "skipped", finishedAt: now };
  }
  await removeStepOutput(id, slug, "opinion", root);
  state.steps.opinion = idleState();
  await writeSeatState(id, slug, state, root);
}

/** Step 3: the member writes private notes on what they read. */
export async function runNotesStep(
  id: string,
  slug: string,
  deps: RunnerDeps,
  opts: StepOpts = {},
): Promise<StepOutcome> {
  const root = deps.root ?? boardRoot();
  const meta = await requireSession(id, root);
  const seat = seatOf(meta, slug);
  const state = await readSeatState(id, slug, root);
  if (state.steps.research.status !== "done") {
    throw new BoardStoreError("Research has to finish first", 409);
  }
  const record = await readResearch(id, slug, root);
  if (!record) throw new BoardStoreError("The research record is missing; run research again", 409);
  await resetChair(id, root);

  return runStep(memberLane(id, slug, root), "notes", deps, opts, async () => {
    if (readPages(record).length === 0) {
      await writeSeatText(id, slug, "notes", "No pages were read, so there are no research notes.\n", root);
      return { saw: [] };
    }
    const member = await readSnapshot(id, slug, root);
    const prompt = notesPrompt({ member, brief: brief(meta), research: record });
    const reply = await ask(deps, seat.model || meta.model, prompt);
    await writeSeatText(id, slug, "notes", `${reply.content}\n`, root);
    return { model: reply.model, saw: prompt.saw };
  });
}

/**
 * Step 4: the member gives an opinion. The prompt is built from the shared
 * material and this member's own notes; no other member's work is read here.
 */
export async function runOpinionStep(
  id: string,
  slug: string,
  deps: RunnerDeps,
  opts: StepOpts = {},
): Promise<StepOutcome> {
  const root = deps.root ?? boardRoot();
  const meta = await requireSession(id, root);
  requireBoard(meta);
  const seat = seatOf(meta, slug);
  const state = await readSeatState(id, slug, root);
  if (state.dropped) throw new BoardStoreError("This member has been left out of the session", 409);
  if (!finished(state.steps.research) || !finished(state.steps.notes)) {
    throw new BoardStoreError("Research and notes have to finish (or be skipped) first", 409);
  }
  await resetChair(id, root);

  return runStep(memberLane(id, slug, root), "opinion", deps, opts, async () => {
    const [member, notes, record] = await Promise.all([
      readSnapshot(id, slug, root),
      state.steps.notes.status === "done" ? readSeatText(id, slug, "notes", root) : null,
      state.steps.research.status === "done" ? readResearch(id, slug, root) : null,
    ]);
    const prompt = opinionPrompt({ member, brief: brief(meta), notes, research: record });
    const reply = await ask(deps, seat.model || meta.model, prompt);
    await writeSeatText(id, slug, "opinion", `${reply.content}\n`, root);
    return { model: reply.model, saw: prompt.saw };
  });
}

/** Leaves a member out (or brings them back), so the Chair can go on without a stuck opinion. */
export async function setDropped(
  id: string,
  slug: string,
  dropped: boolean,
  deps: Pick<RunnerDeps, "root"> = {},
) {
  const root = deps.root ?? boardRoot();
  const meta = await requireSession(id, root);
  requireBoard(meta);
  seatOf(meta, slug);
  const state = await readSeatState(id, slug, root);
  if (dropped) {
    const others = await Promise.all(
      meta.members.filter((m) => m.slug !== slug).map((m) => readSeatState(id, m.slug, root)),
    );
    if (others.every((s) => s.dropped)) {
      throw new BoardStoreError("At least one member has to stay in the session", 409);
    }
  }
  await writeSeatState(id, slug, { ...state, dropped: dropped || undefined }, root);
  await resetChair(id, root);
}

/* ---------- Chair ---------- */

/** The Chair reads every opinion once all of them are in, and writes the memo. */
export async function runChairStep(id: string, deps: RunnerDeps, opts: StepOpts = {}): Promise<StepOutcome> {
  const root = deps.root ?? boardRoot();
  const meta = await requireSession(id, root);
  requireBoard(meta);

  const opinions: OpinionForChair[] = [];
  for (const seat of meta.members) {
    const state = await readSeatState(id, seat.slug, root);
    if (state.dropped) continue;
    if (state.steps.opinion.status !== "done") {
      throw new BoardStoreError(
        `${seat.name} has not given an opinion yet. Wait for it, or go on without that member.`,
        409,
      );
    }
    const opinion = await readSeatText(id, seat.slug, "opinion", root);
    if (!opinion?.trim()) throw new BoardStoreError(`${seat.name}'s opinion is missing; run it again`, 409);
    const record = state.steps.research.status === "done" ? await readResearch(id, seat.slug, root) : null;
    opinions.push({ name: seat.name, title: seat.title, opinion, cited: citedSources(opinion, record) });
  }
  if (!opinions.length) throw new BoardStoreError("There are no opinions for the Chair to read", 409);

  return runStep(chairLane(id, root), "memo", deps, opts, async () => {
    const prompt = chairPrompt({ brief: brief(meta), opinions });
    const reply = await ask(deps, meta.model, prompt);
    await writeChairMemo(id, `${reply.content}\n`, root);
    return { model: reply.model, saw: prompt.saw };
  });
}

/* ---------- Generalist ---------- */

async function requireGeneralist(id: string, root: string) {
  const meta = await requireSession(id, root);
  requireBoard(meta);
  if (!meta.withGeneralist) {
    throw new BoardStoreError("This session was started without the generalist comparison", 409);
  }
  const states = await Promise.all(meta.members.map((m) => readSeatState(id, m.slug, root)));
  const active = states.filter((s) => !s.dropped).length;
  return { meta, limits: generalistLimits(meta.limits, active) };
}

export async function runGeneralistPlanStep(
  id: string,
  deps: RunnerDeps,
  opts: StepOpts = {},
): Promise<StepOutcome> {
  const root = deps.root ?? boardRoot();
  const now = deps.now ?? Date.now;
  const { meta, limits } = await requireGeneralist(id, root);
  return runStep(generalistLane(id, root), "plan", deps, opts, async () => {
    const prompt = generalistPlanPrompt({ brief: brief(meta), limits });
    const reply = await ask(deps, meta.model, prompt);
    const queries = limits.searches > 0 ? parsePlan(reply.content, limits.searches) : [];
    await writePlan(id, GENERALIST, buildPlan(meta, queries, now()), root);
    return { model: reply.model, saw: prompt.saw };
  });
}

export async function runGeneralistResearchStep(
  id: string,
  deps: RunnerDeps,
  opts: StepOpts & { approve?: boolean; queries?: unknown } = {},
): Promise<StepOutcome> {
  const root = deps.root ?? boardRoot();
  const { meta, limits } = await requireGeneralist(id, root);
  return research({ id, seat: GENERALIST, lane: generalistLane(id, root), meta, limits, deps, opts });
}

export async function skipGeneralistResearch(id: string, deps: Pick<RunnerDeps, "now" | "root"> = {}) {
  const root = deps.root ?? boardRoot();
  const now = (deps.now ?? Date.now)();
  await requireGeneralist(id, root);
  const state = await readGeneralistState(id, root);
  await removeStepOutput(id, GENERALIST, "research", root);
  await removeStepOutput(id, GENERALIST, "memo", root);
  state.steps.research = { status: "skipped", finishedAt: now };
  state.steps.memo = idleState();
  await writeGeneralistState(id, state, root);
}

/** The generalist's memo: same material, its own research, the Chair's layout. */
export async function runGeneralistMemoStep(
  id: string,
  deps: RunnerDeps,
  opts: StepOpts = {},
): Promise<StepOutcome> {
  const root = deps.root ?? boardRoot();
  const { meta } = await requireGeneralist(id, root);
  const state = await readGeneralistState(id, root);
  if (!finished(state.steps.research)) {
    throw new BoardStoreError("The generalist's research has to finish (or be skipped) first", 409);
  }
  return runStep(generalistLane(id, root), "memo", deps, opts, async () => {
    const record = state.steps.research.status === "done" ? await readResearch(id, GENERALIST, root) : null;
    const prompt = generalistMemoPrompt({ brief: brief(meta), research: record });
    const reply = await ask(deps, meta.model, prompt);
    await writeSeatText(id, GENERALIST, "memo", `${reply.content}\n`, root);
    return { model: reply.model, saw: prompt.saw };
  });
}
