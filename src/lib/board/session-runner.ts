import { notesPrompt, planPrompt, type Composed } from "./compose";
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
  MEMBER_STEPS,
  idleState,
  readPlan,
  readResearch,
  readSeatState,
  readSnapshot,
  removeStepOutput,
  requireSession,
  writeNotes,
  writePlan,
  writeResearch,
  writeSeatState,
} from "./session-store";
import { BoardStoreError, boardRoot } from "./store";
import type { MemberPlan, MemberStepName, PlannedQuery, SessionMeta, StepState } from "./types";

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

function brief(meta: SessionMeta) {
  return { question: meta.question, material: meta.material };
}

async function runStep(
  id: string,
  slug: string,
  step: MemberStepName,
  deps: RunnerDeps,
  opts: { force?: boolean },
  work: () => Promise<Partial<StepState> | void>,
): Promise<StepOutcome> {
  const root = deps.root ?? boardRoot();
  const now = deps.now ?? Date.now;
  const state = await readSeatState(id, slug, root);
  const current = state.steps[step];
  if (
    current.status === "running" &&
    !opts.force &&
    now() - (current.startedAt ?? 0) < STALE_AFTER_MS
  ) {
    throw new BoardStoreError("This step is already running", 409);
  }

  // Anything built on this step is now out of date.
  const later = MEMBER_STEPS.slice(MEMBER_STEPS.indexOf(step) + 1);
  for (const name of later) {
    state.steps[name] = idleState();
    await removeStepOutput(id, slug, name, root);
  }
  const startedAt = now();
  state.steps[step] = { status: "running", startedAt };
  await writeSeatState(id, slug, state, root);

  let outcome: StepOutcome = { ok: true };
  let result: StepState;
  try {
    const extra = (await work()) ?? {};
    result = { status: "done", startedAt, finishedAt: now(), ...extra };
  } catch (error) {
    if (error instanceof BoardStoreError) {
      state.steps[step] = current.status === "running" ? idleState() : current;
      await writeSeatState(id, slug, state, root);
      throw error;
    }
    const message = errorMessage(error);
    result = { status: "error", startedAt, finishedAt: now(), error: message };
    outcome = { ok: false, error: message };
  }
  const latest = await readSeatState(id, slug, root);
  latest.steps[step] = result;
  await writeSeatState(id, slug, latest, root);
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
  const flagged = flagQueries(queries, `${meta.question}\n${meta.material}`);
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

/** Step 1: the member writes the searches they want. Nothing leaves the machine yet. */
export async function runPlanStep(
  id: string,
  slug: string,
  deps: RunnerDeps,
  opts: { force?: boolean } = {},
): Promise<StepOutcome> {
  const root = deps.root ?? boardRoot();
  const now = deps.now ?? Date.now;
  const meta = await requireSession(id, root);
  const seat = seatOf(meta, slug);
  return runStep(id, slug, "plan", deps, opts, async () => {
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
  opts: { force?: boolean; approve?: boolean; queries?: unknown } = {},
): Promise<StepOutcome> {
  const root = deps.root ?? boardRoot();
  const now = deps.now ?? Date.now;
  const meta = await requireSession(id, root);
  seatOf(meta, slug);
  const state = await readSeatState(id, slug, root);
  if (state.steps.plan.status !== "done") {
    throw new BoardStoreError("The search plan has to be written first", 409);
  }
  let plan = await readPlan(id, slug, root);
  if (!plan) throw new BoardStoreError("The search plan is missing; run it again", 409);

  if (opts.queries !== undefined) {
    const edited = cleanQueries(opts.queries, meta.limits.searches);
    plan = buildPlan(meta, edited, plan.createdAt, { editedByOwner: true });
  }
  if (opts.approve) plan = { ...plan, approved: true };
  if (!plan.approved) {
    throw new BoardStoreError("These searches are waiting for your approval", 409);
  }
  await writePlan(id, slug, plan, root);
  const queries = plan.queries;

  return runStep(id, slug, "research", deps, opts, async () => {
    const record = await runResearch({
      queries,
      limits: meta.limits,
      search: deps.search,
      read: deps.read,
      now,
    });
    await writeResearch(id, slug, record, root);
    const failed = record.queries.filter((q) => q.error);
    if (record.queries.length > 0 && failed.length === record.queries.length) {
      throw new Error(failed[0].error ?? "Every search failed");
    }
    return {
      saw: record.queries.map((q) => `Search: ${q.query}`),
    };
  });
}

/** Marks research and notes as skipped, so the member goes on with the shared material alone. */
export async function skipResearch(id: string, slug: string, deps: Pick<RunnerDeps, "now" | "root"> = {}) {
  const root = deps.root ?? boardRoot();
  const now = (deps.now ?? Date.now)();
  const meta = await requireSession(id, root);
  seatOf(meta, slug);
  const state = await readSeatState(id, slug, root);
  for (const step of ["research", "notes"] as const) {
    await removeStepOutput(id, slug, step, root);
    state.steps[step] = { status: "skipped", finishedAt: now };
  }
  await writeSeatState(id, slug, state, root);
}

/** Step 3: the member writes private notes on what they read. */
export async function runNotesStep(
  id: string,
  slug: string,
  deps: RunnerDeps,
  opts: { force?: boolean } = {},
): Promise<StepOutcome> {
  const root = deps.root ?? boardRoot();
  const meta = await requireSession(id, root);
  const seat = seatOf(meta, slug);
  const state = await readSeatState(id, slug, root);
  if (state.steps.research.status !== "done") {
    throw new BoardStoreError("Research has to finish first", 409);
  }
  const research = await readResearch(id, slug, root);
  if (!research) throw new BoardStoreError("The research record is missing; run research again", 409);

  return runStep(id, slug, "notes", deps, opts, async () => {
    if (readPages(research).length === 0) {
      await writeNotes(id, slug, "No pages were read, so there are no research notes.\n", root);
      return { saw: [] };
    }
    const member = await readSnapshot(id, slug, root);
    const prompt = notesPrompt({ member, brief: brief(meta), research });
    const reply = await ask(deps, seat.model || meta.model, prompt);
    await writeNotes(id, slug, `${reply.content}\n`, root);
    return { model: reply.model, saw: prompt.saw };
  });
}
