import {
  chairPrompt,
  citedSources,
  crossPrompt,
  generalistMemoPrompt,
  generalistPlanPrompt,
  mapPrompt,
  notesPrompt,
  opinionPrompt,
  parseMap,
  plan2Prompt,
  planPrompt,
  premortemPrompt,
  revisedPrompt,
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
  type OwnSearchFn,
  type ReadFn,
  type SearchFn,
} from "./research";
import {
  GENERALIST,
  GENERALIST_STEPS,
  MEMBER_STEPS,
  generalistLimits,
  idleState,
  readAllDossiers,
  readChairState,
  readGeneralistState,
  readLatestOpinion,
  readMap,
  readPlan,
  readResearch,
  readSeatState,
  readSeatText,
  readSnapshot,
  removeStepOutput,
  requireSession,
  resetChair,
  resetCross,
  resetSecondSitting,
  secondSteps,
  writeChairMemo,
  writeChairState,
  writeGeneralistState,
  writeMap,
  writePlan,
  type Round,
  writeResearch,
  writeSeatState,
  writeSeatText,
} from "./session-store";
import { BoardStoreError, boardRoot } from "./store";
import type {
  GeneralistStepName,
  MemberPlan,
  MemberStepName,
  OwnSource,
  PlannedQuery,
  ResearchLimits,
  ResearchRecord,
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
  /** Searches the owner's own records. Left out, members with own sources get "not connected". */
  own?: OwnSearchFn;
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

/** The shared brief plus this member's private dossier, if the owner gave them one. */
async function memberBrief(meta: SessionMeta, slug: string, root: string): Promise<SharedBrief> {
  const seat = meta.members.find((m) => m.slug === slug);
  const text = seat?.dossierChars ? await readSeatText(meta.id, slug, "dossier", root) : null;
  if (!text?.trim()) return brief(meta);
  return {
    ...brief(meta),
    dossier: {
      heading: "Your private dossier\nThe owner gave this to you alone. The other members have not seen it.",
      label: "Own private dossier",
      text,
    },
  };
}

/** The generalist is given every dossier, so it is not short of anything the board had. */
async function generalistBrief(meta: SessionMeta, root: string): Promise<SharedBrief> {
  const text = await readAllDossiers(meta, root);
  if (!text.trim()) return brief(meta);
  return {
    ...brief(meta),
    dossier: {
      heading: "Further material\nThe owner gave each of these to one board member. You have all of them.",
      label: "Every private dossier",
      text,
    },
  };
}

function finished(state: StepState) {
  return state.status === "done" || state.status === "skipped";
}

const FIRST = new Set<string>(["plan", "research", "notes", "opinion"]);

/**
 * A lane is one seat's ordered steps (a member's, the generalist's, or the
 * Chair's single step) and where their progress is saved.
 */
type Lane = {
  order: string[];
  /** Steps this session does not run. They stay skipped when an earlier step is run again. */
  off?: Set<string>;
  read: () => Promise<Record<string, StepState>>;
  write: (steps: Record<string, StepState>) => Promise<void>;
  clear: (step: string) => Promise<void>;
};

function memberLane(meta: SessionMeta, slug: string, root: string): Lane {
  const id = meta.id;
  const on = new Set<string>(secondSteps(meta));
  return {
    order: MEMBER_STEPS,
    off: new Set(MEMBER_STEPS.filter((step) => !FIRST.has(step) && !on.has(step))),
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

function chairLane(meta: SessionMeta, root: string): Lane {
  const id = meta.id;
  return {
    order: ["map", "memo"],
    off: new Set(meta.speed === "deep" ? [] : ["map"]),
    read: async () => ({ ...(await readChairState(id, root)) }),
    write: (steps) => writeChairState(id, { map: steps.map, memo: steps.memo }, root),
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
    if (lane.off?.has(name)) continue;
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
  /** Private material this seat was also given; names in it must not go out in a search either. */
  dossier = "",
): MemberPlan {
  const flagged = flagQueries(queries, `${meta.question}\n${meta.material}\n${meta.standing ?? ""}\n${dossier}`);
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
  /** Round 2 is the Deep speed's second round: its own plan and record, numbered on from round 1. */
  round?: Round;
  sources?: OwnSource[];
  dossier?: string;
}): Promise<StepOutcome> {
  const { id, seat, lane, meta, limits, deps, opts } = args;
  const round = args.round ?? 1;
  const planStep = round === 2 ? "plan2" : "plan";
  const researchStep = round === 2 ? "research2" : "research";
  const sources = args.sources ?? [];
  const root = deps.root ?? boardRoot();
  const now = deps.now ?? Date.now;
  const steps = await lane.read();
  if (steps[planStep].status !== "done") {
    throw new BoardStoreError("The search plan has to be written first", 409);
  }
  let plan = await readPlan(id, seat, root, round);
  if (!plan) throw new BoardStoreError("The search plan is missing; run it again", 409);

  if (opts.queries !== undefined) {
    plan = buildPlan(
      meta,
      cleanQueries(opts.queries, limits.searches, { allowOwn: sources.length > 0 }),
      plan.createdAt,
      { editedByOwner: true },
      args.dossier,
    );
  }
  if (opts.approve) plan = { ...plan, approved: true };
  if (!plan.approved) {
    throw new BoardStoreError("These searches are waiting for your approval", 409);
  }
  await writePlan(id, seat, plan, root, round);
  const queries = plan.queries;
  const earlier: ResearchRecord | null = round === 2 ? await readResearch(id, seat, root, 1) : null;

  return runStep(lane, researchStep, deps, opts, async () => {
    const record = await runResearch({
      queries,
      limits,
      search: deps.search,
      read: deps.read,
      now,
      earlier,
      own: deps.own,
      sources,
    });
    await writeResearch(id, seat, record, root, round);
    const failed = record.queries.filter((q) => q.error);
    if (record.queries.length > 0 && failed.length === record.queries.length) {
      throw new Error(failed[0].error ?? "Every search failed");
    }
    return {
      saw: record.queries.map((q) => `${q.where === "own" ? "Search of own records" : "Search"}: ${q.query}`),
    };
  });
}

/** Called whenever a member's first-round work changes: everything resting on it is out of date. */
async function firstRoundChanged(meta: SessionMeta, root: string) {
  await resetChair(meta.id, root);
  await resetSecondSitting(meta, root);
}

async function dossierOf(meta: SessionMeta, slug: string, root: string) {
  const seat = meta.members.find((m) => m.slug === slug);
  return seat?.dossierChars ? ((await readSeatText(meta.id, slug, "dossier", root)) ?? "") : "";
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
  await firstRoundChanged(meta, root);
  return runStep(memberLane(meta, slug, root), "plan", deps, opts, async () => {
    const member = await readSnapshot(id, slug, root);
    const prompt = planPrompt({ member, brief: await memberBrief(meta, slug, root), limits: meta.limits });
    const reply = await ask(deps, seat.model || meta.model, prompt);
    const queries =
      meta.limits.searches > 0
        ? parsePlan(reply.content, meta.limits.searches, { allowOwn: Boolean(member.sources?.length) })
        : [];
    await writePlan(id, slug, buildPlan(meta, queries, now(), {}, await dossierOf(meta, slug, root)), root);
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
  await firstRoundChanged(meta, root);
  return research({
    id,
    seat: slug,
    lane: memberLane(meta, slug, root),
    meta,
    limits: meta.limits,
    deps,
    opts,
    sources: (await readSnapshot(id, slug, root)).sources,
    dossier: await dossierOf(meta, slug, root),
  });
}

/** Marks research and notes as skipped, so the member goes on with the shared material alone. */
export async function skipResearch(id: string, slug: string, deps: Pick<RunnerDeps, "now" | "root"> = {}) {
  const root = deps.root ?? boardRoot();
  const now = (deps.now ?? Date.now)();
  const meta = await requireSession(id, root);
  seatOf(meta, slug);
  await firstRoundChanged(meta, root);
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
  await firstRoundChanged(meta, root);

  return runStep(memberLane(meta, slug, root), "notes", deps, opts, async () => {
    if (readPages(record).length === 0) {
      await writeSeatText(id, slug, "notes", "No pages were read, so there are no research notes.\n", root);
      return { saw: [] };
    }
    const member = await readSnapshot(id, slug, root);
    const prompt = notesPrompt({ member, brief: await memberBrief(meta, slug, root), research: record });
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
  await firstRoundChanged(meta, root);

  return runStep(memberLane(meta, slug, root), "opinion", deps, opts, async () => {
    const [member, notes, record] = await Promise.all([
      readSnapshot(id, slug, root),
      state.steps.notes.status === "done" ? readSeatText(id, slug, "notes", root) : null,
      state.steps.research.status === "done" ? readResearch(id, slug, root) : null,
    ]);
    const prompt = opinionPrompt({ member, brief: await memberBrief(meta, slug, root), notes, research: record });
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
  // The others' cross-examinations quoted this member, or left them out.
  await resetCross(meta, root, slug);
}

/* ---------- After the blind round ---------- */

/** Members still taking part, with where each one stands. */
async function activeSeats(meta: SessionMeta, root: string) {
  const seats = await Promise.all(
    meta.members.map(async (seat) => ({ seat, state: await readSeatState(meta.id, seat.slug, root) })),
  );
  return seats.filter((s) => !s.state.dropped);
}

async function firstOpinions(meta: SessionMeta, root: string): Promise<OpinionForChair[]> {
  const opinions: OpinionForChair[] = [];
  for (const { seat, state } of await activeSeats(meta, root)) {
    if (state.steps.opinion.status !== "done") {
      throw new BoardStoreError(
        `${seat.name} has not given an opinion yet. Wait for it, or go on without that member.`,
        409,
      );
    }
    const opinion = await readSeatText(meta.id, seat.slug, "opinion", root);
    if (!opinion?.trim()) throw new BoardStoreError(`${seat.name}'s opinion is missing; run it again`, 409);
    opinions.push({ name: seat.name, title: seat.title, opinion, cited: [] });
  }
  if (!opinions.length) throw new BoardStoreError("There are no opinions to read", 409);
  return opinions;
}

function requireStep(meta: SessionMeta, step: MemberStepName, what: string) {
  requireBoard(meta);
  if (!secondSteps(meta).includes(step)) {
    throw new BoardStoreError(`This session was started without ${what}`, 409);
  }
}

/** Deep speed: the Chair names what the members disagree on, without saying who holds which side. */
export async function runMapStep(id: string, deps: RunnerDeps, opts: StepOpts = {}): Promise<StepOutcome> {
  const root = deps.root ?? boardRoot();
  const now = deps.now ?? Date.now;
  const meta = await requireSession(id, root);
  requireStep(meta, "plan2", "a second research round");
  const opinions = await firstOpinions(meta, root);
  // The second round is aimed at this list, so a new list starts the second round over.
  await resetSecondSitting(meta, root, { keepMap: true });
  return runStep(chairLane(meta, root), "map", deps, opts, async () => {
    const prompt = mapPrompt({ brief: brief(meta), opinions });
    const reply = await ask(deps, meta.model, prompt);
    const points = parseMap(reply.content, meta.members.map((m) => m.name));
    await writeMap(id, { points, createdAt: now() }, root);
    return { model: reply.model, saw: prompt.saw };
  });
}

async function requireMap(id: string, root: string) {
  const chair = await readChairState(id, root);
  const map = chair.map.status === "done" ? await readMap(id, root) : null;
  if (!map) throw new BoardStoreError("The Chair has not listed the open points yet", 409);
  return map;
}

/** Second round, step 1: the member plans searches aimed at the open points. */
export async function runPlan2Step(
  id: string,
  slug: string,
  deps: RunnerDeps,
  opts: StepOpts = {},
): Promise<StepOutcome> {
  const root = deps.root ?? boardRoot();
  const now = deps.now ?? Date.now;
  const meta = await requireSession(id, root);
  requireStep(meta, "plan2", "a second research round");
  const seat = seatOf(meta, slug);
  const state = await readSeatState(id, slug, root);
  if (state.dropped) throw new BoardStoreError("This member has been left out of the session", 409);
  if (state.steps.opinion.status !== "done") throw new BoardStoreError("The first opinion has to be in first", 409);
  const map = await requireMap(id, root);
  await resetChair(id, root);
  await resetCross(meta, root, slug);
  return runStep(memberLane(meta, slug, root), "plan2", deps, opts, async () => {
    if (!map.points.length || meta.limits.searches === 0) {
      await writePlan(id, slug, buildPlan(meta, [], now()), root, 2);
      return { saw: [] };
    }
    const member = await readSnapshot(id, slug, root);
    const opinion = (await readSeatText(id, slug, "opinion", root)) ?? "";
    const prompt = plan2Prompt({
      member,
      brief: await memberBrief(meta, slug, root),
      opinion,
      points: map.points,
      limits: meta.limits,
    });
    const reply = await ask(deps, seat.model || meta.model, prompt);
    const first = new Set(((await readPlan(id, slug, root))?.queries ?? []).map((q) => q.query.toLowerCase()));
    const queries = parsePlan(reply.content, meta.limits.searches, {
      allowOwn: Boolean(member.sources?.length),
    }).filter((q) => !first.has(q.query.toLowerCase()));
    await writePlan(id, slug, buildPlan(meta, queries, now(), {}, await dossierOf(meta, slug, root)), root, 2);
    return { model: reply.model, saw: prompt.saw };
  });
}

/** Second round, step 2: the research desk runs those searches. Pages read in round 1 are not read again. */
export async function runResearch2Step(
  id: string,
  slug: string,
  deps: RunnerDeps,
  opts: StepOpts & { approve?: boolean; queries?: unknown } = {},
): Promise<StepOutcome> {
  const root = deps.root ?? boardRoot();
  const meta = await requireSession(id, root);
  requireStep(meta, "research2", "a second research round");
  seatOf(meta, slug);
  await resetChair(id, root);
  await resetCross(meta, root, slug);
  return research({
    id,
    seat: slug,
    lane: memberLane(meta, slug, root),
    meta,
    limits: meta.limits,
    deps,
    opts,
    round: 2,
    sources: (await readSnapshot(id, slug, root)).sources,
    dossier: await dossierOf(meta, slug, root),
  });
}

/**
 * Second round, step 3: the member revises their opinion, still without having
 * seen anyone else's. If the round turned up nothing to read, the first
 * opinion stands and no model is called.
 */
export async function runRevisedStep(
  id: string,
  slug: string,
  deps: RunnerDeps,
  opts: StepOpts = {},
): Promise<StepOutcome> {
  const root = deps.root ?? boardRoot();
  const meta = await requireSession(id, root);
  requireStep(meta, "revised", "a second research round");
  const seat = seatOf(meta, slug);
  const state = await readSeatState(id, slug, root);
  if (state.dropped) throw new BoardStoreError("This member has been left out of the session", 409);
  if (state.steps.research2.status !== "done") {
    throw new BoardStoreError("The second round of research has to finish first", 409);
  }
  const map = await requireMap(id, root);
  await resetChair(id, root);
  await resetCross(meta, root, slug);
  return runStep(memberLane(meta, slug, root), "revised", deps, opts, async () => {
    const record = await readResearch(id, slug, root, 2);
    if (!record || readPages(record).length === 0) return { saw: [] };
    const [member, opinion, notes] = await Promise.all([
      readSnapshot(id, slug, root),
      readSeatText(id, slug, "opinion", root),
      state.steps.notes.status === "done" ? readSeatText(id, slug, "notes", root) : null,
    ]);
    const prompt = revisedPrompt({
      member,
      brief: await memberBrief(meta, slug, root),
      opinion: opinion ?? "",
      notes,
      points: map.points,
      research: record,
    });
    const reply = await ask(deps, seat.model || meta.model, prompt);
    await writeSeatText(id, slug, "revised", `${reply.content}\n`, root);
    return { model: reply.model, saw: prompt.saw };
  });
}

/** True once this member's opinion is final: given, and revised if the session has a second round. */
function opinionSettled(meta: SessionMeta, steps: Record<MemberStepName, StepState>) {
  if (steps.opinion.status !== "done") return false;
  return !secondSteps(meta).includes("revised") || steps.revised.status === "done";
}

/** The member assumes their own advice was followed and failed. Nobody else's work is read here. */
export async function runPremortemStep(
  id: string,
  slug: string,
  deps: RunnerDeps,
  opts: StepOpts = {},
): Promise<StepOutcome> {
  const root = deps.root ?? boardRoot();
  const meta = await requireSession(id, root);
  requireStep(meta, "premortem", "a premortem");
  const seat = seatOf(meta, slug);
  const state = await readSeatState(id, slug, root);
  if (state.dropped) throw new BoardStoreError("This member has been left out of the session", 409);
  if (!opinionSettled(meta, state.steps)) {
    throw new BoardStoreError("This member's opinion has to be final first", 409);
  }
  await resetChair(id, root);
  return runStep(memberLane(meta, slug, root), "premortem", deps, opts, async () => {
    const member = await readSnapshot(id, slug, root);
    const opinion = (await readLatestOpinion(id, slug, root)).text ?? "";
    const prompt = premortemPrompt({ member, brief: await memberBrief(meta, slug, root), opinion });
    const reply = await ask(deps, seat.model || meta.model, prompt);
    await writeSeatText(id, slug, "premortem", `${reply.content}\n`, root);
    return { model: reply.model, saw: prompt.saw };
  });
}

/**
 * Cross-examination: the only step where a member reads another member's
 * opinion. It runs once every opinion is final, so the first opinions were
 * still given blind.
 */
export async function runCrossStep(
  id: string,
  slug: string,
  deps: RunnerDeps,
  opts: StepOpts = {},
): Promise<StepOutcome> {
  const root = deps.root ?? boardRoot();
  const meta = await requireSession(id, root);
  requireStep(meta, "cross", "cross-examination");
  const seat = seatOf(meta, slug);
  const seats = await activeSeats(meta, root);
  const own = seats.find((s) => s.seat.slug === slug);
  if (!own) throw new BoardStoreError("This member has been left out of the session", 409);
  const waiting = seats.filter((s) => !opinionSettled(meta, s.state.steps));
  if (waiting.length) {
    throw new BoardStoreError(
      `Cross-examination starts once every opinion is final. Still waiting for ${waiting.map((s) => s.seat.name).join(", ")}.`,
      409,
    );
  }
  if (secondSteps(meta).includes("premortem") && own.state.steps.premortem.status !== "done") {
    throw new BoardStoreError("This member's premortem comes first", 409);
  }
  const others = seats.filter((s) => s.seat.slug !== slug);
  if (!others.length) throw new BoardStoreError("There is no other member to cross-examine", 409);
  await resetChair(id, root);
  return runStep(memberLane(meta, slug, root), "cross", deps, opts, async () => {
    const member = await readSnapshot(id, slug, root);
    const opinion = (await readLatestOpinion(id, slug, root)).text ?? "";
    const prompt = crossPrompt({
      member,
      brief: await memberBrief(meta, slug, root),
      opinion,
      others: await Promise.all(
        others.map(async (o) => ({
          name: o.seat.name,
          title: o.seat.title,
          opinion: (await readLatestOpinion(id, o.seat.slug, root)).text ?? "",
        })),
      ),
    });
    const reply = await ask(deps, seat.model || meta.model, prompt);
    await writeSeatText(id, slug, "cross", `${reply.content}\n`, root);
    return { model: reply.model, saw: prompt.saw };
  });
}

/* ---------- Chair ---------- */

/** The Chair reads every opinion once all of them are in, and writes the memo. */
export async function runChairStep(id: string, deps: RunnerDeps, opts: StepOpts = {}): Promise<StepOutcome> {
  const root = deps.root ?? boardRoot();
  const meta = await requireSession(id, root);
  requireBoard(meta);

  const extra = secondSteps(meta);
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
    const unfinished = extra.find((step) => state.steps[step].status !== "done");
    if (unfinished) {
      throw new BoardStoreError(
        `${seat.name} has not finished the later rounds yet. Wait for them, or go on without that member.`,
        409,
      );
    }
    const latest = await readLatestOpinion(id, seat.slug, root);
    const opinion = latest.text;
    if (!opinion?.trim()) throw new BoardStoreError(`${seat.name}'s opinion is missing; run it again`, 409);
    const pages = [
      ...(state.steps.research.status === "done" ? readPages(await readResearch(id, seat.slug, root)) : []),
      ...(state.steps.research2.status === "done" ? readPages(await readResearch(id, seat.slug, root, 2)) : []),
    ];
    opinions.push({
      name: seat.name,
      title: seat.title,
      opinion,
      revised: latest.revised,
      cited: citedSources(opinion, pages),
      premortem: extra.includes("premortem") ? await readSeatText(id, seat.slug, "premortem", root) : null,
      cross: extra.includes("cross") ? await readSeatText(id, seat.slug, "cross", root) : null,
    });
  }
  if (!opinions.length) throw new BoardStoreError("There are no opinions for the Chair to read", 409);

  return runStep(chairLane(meta, root), "memo", deps, opts, async () => {
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
  // The generalist may search every own-record source any member may.
  const snapshots = await Promise.all(meta.members.map((m) => readSnapshot(id, m.slug, root)));
  const sources = [...new Set(snapshots.flatMap((m) => m.sources ?? []))];
  return {
    meta,
    limits: generalistLimits(meta.limits, active, meta.speed === "deep"),
    sources,
    brief: await generalistBrief(meta, root),
  };
}

export async function runGeneralistPlanStep(
  id: string,
  deps: RunnerDeps,
  opts: StepOpts = {},
): Promise<StepOutcome> {
  const root = deps.root ?? boardRoot();
  const now = deps.now ?? Date.now;
  const { meta, limits, sources, brief: shared } = await requireGeneralist(id, root);
  return runStep(generalistLane(id, root), "plan", deps, opts, async () => {
    const prompt = generalistPlanPrompt({ brief: shared, limits, sources });
    const reply = await ask(deps, meta.model, prompt);
    const queries =
      limits.searches > 0 ? parsePlan(reply.content, limits.searches, { allowOwn: sources.length > 0 }) : [];
    await writePlan(id, GENERALIST, buildPlan(meta, queries, now(), {}, shared.dossier?.text), root);
    return { model: reply.model, saw: prompt.saw };
  });
}

export async function runGeneralistResearchStep(
  id: string,
  deps: RunnerDeps,
  opts: StepOpts & { approve?: boolean; queries?: unknown } = {},
): Promise<StepOutcome> {
  const root = deps.root ?? boardRoot();
  const { meta, limits, sources, brief: shared } = await requireGeneralist(id, root);
  return research({
    id,
    seat: GENERALIST,
    lane: generalistLane(id, root),
    meta,
    limits,
    deps,
    opts,
    sources,
    dossier: shared.dossier?.text,
  });
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
  const { meta, brief: shared } = await requireGeneralist(id, root);
  const state = await readGeneralistState(id, root);
  if (!finished(state.steps.research)) {
    throw new BoardStoreError("The generalist's research has to finish (or be skipped) first", 409);
  }
  return runStep(generalistLane(id, root), "memo", deps, opts, async () => {
    const record = state.steps.research.status === "done" ? await readResearch(id, GENERALIST, root) : null;
    const prompt = generalistMemoPrompt({ brief: shared, research: record });
    const reply = await ask(deps, meta.model, prompt);
    await writeSeatText(id, GENERALIST, "memo", `${reply.content}\n`, root);
    return { model: reply.model, saw: prompt.saw };
  });
}
