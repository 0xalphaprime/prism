"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { boardApi, errorText } from "@/components/board/board-api";
import { nextMove, useSession, type StepRequest } from "@/components/board/use-session";
import { modelLabel } from "@/lib/providers";
import type {
  MemberPlan,
  OverlapReport,
  PlannedQuery,
  ResearchRecord,
  SessionMemberView,
  SessionView,
  StepState,
} from "@/lib/board/types";

const STEP_LABEL: Record<string, string> = {
  plan: "Search plan",
  research: "Research",
  notes: "Notes",
};

const STATUS_LABEL: Record<StepState["status"], string> = {
  idle: "Not started",
  running: "Working",
  done: "Done",
  error: "Failed",
  skipped: "Skipped",
};

function when(ms?: number) {
  return ms ? new Date(ms).toLocaleString() : "";
}

function seconds(from?: number, to?: number) {
  if (!from || !to || to < from) return "";
  return `${((to - from) / 1000).toFixed(1)}s`;
}

function plural(n: number, one: string, many = `${one}s`) {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

export function StepChip({ label, state }: { label: string; state: StepState }) {
  return (
    <span className={`board-step is-${state.status}`} title={state.error ?? STATUS_LABEL[state.status]}>
      {label}
      <em>{STATUS_LABEL[state.status]}</em>
    </span>
  );
}

export function SawList({ state }: { state: StepState }) {
  if (!state.saw?.length) return null;
  return (
    <details className="board-saw">
      <summary>
        What was put in front of the model{state.model ? ` (${modelLabel(state.model)})` : ""}
      </summary>
      <ul>
        {state.saw.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </details>
  );
}

function StepError({
  state,
  onRetry,
  children,
}: {
  state: StepState;
  onRetry: () => void;
  children?: React.ReactNode;
}) {
  if (state.status !== "error") return null;
  return (
    <div className="board-error" role="alert">
      <p>{state.error || "This step failed."}</p>
      <div className="board-actions">
        <button type="button" className="btn" onClick={onRetry}>
          Try again
        </button>
        {children}
      </div>
    </div>
  );
}

function PlanSection({
  member,
  limit,
  run,
}: {
  member: SessionMemberView;
  limit: number;
  run: (request: StepRequest) => void;
}) {
  const plan = member.plan;
  const { plan: planStep, research } = member.state.steps;
  const held = Boolean(plan && !plan.approved && research.status === "idle" && planStep.status === "done");
  const [draft, setDraft] = useState<{ source: MemberPlan; queries: PlannedQuery[] } | null>(null);
  const queries = held && draft && draft.source === plan ? draft.queries : (plan?.queries ?? []);
  const edit = (next: PlannedQuery[]) => plan && setDraft({ source: plan, queries: next });
  const flaggedFor = (query: string) => plan?.flagged.find((f) => f.query === query)?.terms ?? [];

  return (
    <section className="board-section">
      <h3>Search plan</h3>
      {planStep.status === "idle" ? <p className="sheet-help">Not written yet.</p> : null}
      {planStep.status === "running" ? <p className="sheet-help">Deciding what to look for…</p> : null}
      <StepError state={planStep} onRetry={() => run({ step: "plan", member: member.slug })} />

      {plan && planStep.status === "done" ? (
        <>
          {plan.queries.length === 0 && !held ? (
            <p className="sheet-help">This member chose not to search.</p>
          ) : null}
          {held ? (
            <p className="board-hold">
              {plan.flagged.length
                ? "Held for you: a search repeats a name or figure from your material. Edit or remove it, then approve."
                : "Held for you: nothing is searched until you approve. You can edit or remove searches first."}
            </p>
          ) : null}
          <ol className="board-queries">
            {queries.map((q, i) => (
              <li key={i}>
                {held ? (
                  <div className="board-query-edit">
                    <input
                      value={q.query}
                      aria-label={`Search ${i + 1}`}
                      onChange={(e) =>
                        edit(queries.map((item, j) => (j === i ? { ...item, query: e.target.value } : item)))
                      }
                    />
                    <button
                      type="button"
                      className="btn"
                      onClick={() => edit(queries.filter((_, j) => j !== i))}
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <span className="board-query">{q.query}</span>
                )}
                {q.why ? <span className="board-why">{q.why}</span> : null}
                {flaggedFor(q.query).length ? (
                  <span className="board-flag">
                    Repeats from your material: {flaggedFor(q.query).join(", ")}
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
          {held ? (
            <div className="board-actions">
              <button
                type="button"
                className="btn btn-accent"
                onClick={() =>
                  run({ step: "research", member: member.slug, body: { approve: true, queries } })
                }
              >
                Approve and search
              </button>
              {queries.length < limit ? (
                <button type="button" className="btn" onClick={() => edit([...queries, { query: "", why: "" }])}>
                  Add a search
                </button>
              ) : null}
              <button
                type="button"
                className="btn"
                onClick={() => run({ step: "skip-research", member: member.slug })}
              >
                Skip research
              </button>
            </div>
          ) : null}
          {plan.editedByOwner ? <p className="board-member-meta">You edited this list.</p> : null}
          <SawList state={planStep} />
        </>
      ) : null}
    </section>
  );
}

export function ResearchTrail({ record }: { record: ResearchRecord }) {
  const pageFor = (url: string) => record.pages.find((p) => p.url === url);
  const read = record.pages.filter((p) => !p.error).length;
  return (
    <div className="board-trail">
      <p className="board-member-meta">
        {plural(record.queries.length, "search", "searches")}, {plural(read, "page")} read, in{" "}
        {seconds(record.startedAt, record.finishedAt)}. Limits: {record.limits.searches} searches,{" "}
        {record.limits.pagesPerSearch} pages each, {record.limits.pageChars.toLocaleString()} characters a
        page.
      </p>
      {record.queries.map((q, i) => (
        <div key={`${q.query}-${i}`} className="board-trail-query">
          <p className="board-query">
            {i + 1}. {q.query}
            <span className="board-member-meta"> {seconds(q.startedAt, q.finishedAt)}</span>
          </p>
          {q.error ? <p className="board-flag">Search failed: {q.error}</p> : null}
          {!q.error && q.hits.length === 0 ? <p className="board-member-meta">No results.</p> : null}
          <ul className="board-hits">
            {q.hits.map((hit) => {
              const page = hit.read ? pageFor(hit.url) : undefined;
              return (
                <li key={hit.url} className={hit.read ? "is-read" : ""}>
                  <div className="board-hit-head">
                    {page ? <span className="board-source-id">{page.id}</span> : null}
                    <a href={hit.url} target="_blank" rel="noreferrer noopener">
                      {hit.title || hit.url}
                    </a>
                  </div>
                  <span className="board-hit-url">{hit.url}</span>
                  {page?.error ? <span className="board-flag">Could not be read: {page.error}</span> : null}
                  {page && !page.error ? (
                    <details className="board-page">
                      <summary>
                        Read {page.chars.toLocaleString()} characters
                        {page.truncated ? " (cut at the limit)" : ""}
                        {page.via ? ` via ${page.via}` : ""}
                      </summary>
                      <pre>{page.text}</pre>
                    </details>
                  ) : null}
                  {!hit.read ? (
                    <span className="board-member-meta">Not read: {hit.skipped ?? "skipped"}</span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

function ResearchSection({
  member,
  run,
}: {
  member: SessionMemberView;
  run: (request: StepRequest) => void;
}) {
  const step = member.state.steps.research;
  return (
    <section className="board-section">
      <h3>Research trail</h3>
      {step.status === "idle" ? <p className="sheet-help">Nothing searched yet.</p> : null}
      {step.status === "running" ? <p className="sheet-help">Searching and reading…</p> : null}
      {step.status === "skipped" ? (
        <p className="sheet-help">Skipped. This member works from the shared material alone.</p>
      ) : null}
      <StepError state={step} onRetry={() => run({ step: "research", member: member.slug })}>
        <button
          type="button"
          className="btn"
          onClick={() => run({ step: "skip-research", member: member.slug })}
        >
          Continue without research
        </button>
      </StepError>
      {member.research && step.status !== "running" ? <ResearchTrail record={member.research} /> : null}
    </section>
  );
}

function NotesSection({
  member,
  run,
}: {
  member: SessionMemberView;
  run: (request: StepRequest) => void;
}) {
  const step = member.state.steps.notes;
  if (step.status === "skipped") return null;
  return (
    <section className="board-section">
      <h3>Research notes</h3>
      {step.status === "idle" ? <p className="sheet-help">Written after research.</p> : null}
      {step.status === "running" ? <p className="sheet-help">Writing notes…</p> : null}
      <StepError state={step} onRetry={() => run({ step: "notes", member: member.slug })} />
      {member.notes && step.status === "done" ? (
        <>
          <div className="board-prose">{member.notes.trim()}</div>
          <SawList state={step} />
        </>
      ) : null}
    </section>
  );
}

export function OverlapCard({ overlap, view }: { overlap: OverlapReport; view: SessionView }) {
  const researched = view.members.filter((m) => m.research).length;
  if (researched < 2) return null;
  const name = (slug: string) => view.members.find((m) => m.slug === slug)?.name ?? slug;
  return (
    <div className="board-card">
      <h2>Overlap</h2>
      <p className="board-overlap-figure">
        <strong>{Math.round(overlap.figure * 100)}%</strong>
        <span>
          {overlap.shared.length} of {plural(overlap.distinct, "source")} pulled by more than one member.
          Low overlap means the members looked in different places.
        </span>
      </p>
      {overlap.shared.length ? (
        <ul className="board-shared">
          {overlap.shared.map((s) => (
            <li key={s.url}>
              <a href={s.url} target="_blank" rel="noreferrer noopener">
                {s.title || s.url}
              </a>
              <span className="board-member-meta"> {s.members.map(name).join(", ")}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function MemberColumn({
  member,
  view,
  run,
}: {
  member: SessionMemberView;
  view: SessionView;
  run: (request: StepRequest) => void;
}) {
  const steps = member.state.steps;
  return (
    <article className="board-seat" data-member={member.slug}>
      <header className="board-seat-head">
        <div>
          <h2>{member.name}</h2>
          <p className="board-member-title">{member.title}</p>
        </div>
        <Link href={`/board/members?m=${member.slug}`} className="board-seat-link">
          Edit member
        </Link>
      </header>
      <div className="board-steps">
        {(["plan", "research", "notes"] as const).map((name) => (
          <StepChip key={name} label={STEP_LABEL[name]} state={steps[name]} />
        ))}
      </div>
      <PlanSection member={member} limit={view.limits.searches} run={run} />
      <ResearchSection member={member} run={run} />
      <NotesSection member={member} run={run} />
      {steps.plan.status === "done" ? (
        <div className="board-actions board-seat-foot">
          <button type="button" className="btn" onClick={() => run({ step: "plan", member: member.slug })}>
            Start this member again
          </button>
        </div>
      ) : null}
    </article>
  );
}

export function SessionWorkspace({ id }: { id: string }) {
  const router = useRouter();
  const { view, error, setError, runStep, driving, setDriving, working } = useSession(id);

  if (!view) {
    return (
      <section className="page-workspace board-workspace">
        {error ? (
          <p className="board-error" role="alert">
            {error}
          </p>
        ) : (
          <p className="sheet-help">Loading…</p>
        )}
      </section>
    );
  }

  const moves = view.members.map(nextMove);
  const runnable = moves.some((m) => m.kind === "run");
  const waiting = moves.filter((m) => m.kind === "owner").length;
  const started = view.members.some((m) => m.state.steps.plan.status !== "idle");
  const allDone = moves.every((m) => m.kind === "finished");

  // Any action taken by hand also lets the rest of that member's steps follow on.
  const run = (request: StepRequest) => {
    setDriving(true);
    void runStep(request);
  };

  const remove = async () => {
    if (!window.confirm("Remove this session? Its folder is moved to the trash folder.")) return;
    try {
      await boardApi(`/api/board/sessions/${id}`, { method: "DELETE" });
      router.push("/board/research");
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <section className={`page-workspace board-workspace${view.members.length > 2 ? " is-wide" : ""}`}>
      <header className="page-workspace-header">
        <div>
          <p className="sheet-kicker">Research trial</p>
          <h1>{view.title}</h1>
          <p className="sheet-help">
            {when(view.createdAt)} · {modelLabel(view.model)} ·{" "}
            {view.approveSearches ? "searches wait for your approval" : "searches run without asking"}
            {view.sensitive ? " · marked sensitive" : ""}
          </p>
        </div>
        <div className="board-actions">
          {working ? <span className="board-dirty is-dirty">Working…</span> : null}
          {!working && allDone ? <span className="board-dirty">Finished</span> : null}
          {runnable && !(driving && working) ? (
            <button type="button" className="btn btn-accent" onClick={() => setDriving(true)}>
              {started ? "Continue" : "Run research"}
            </button>
          ) : null}
          <button type="button" className="btn" onClick={remove}>
            Remove
          </button>
        </div>
      </header>

      {error ? (
        <p className="board-error" role="alert">
          {error}
        </p>
      ) : null}
      {waiting && !working ? (
        <p className="board-hold">
          {plural(waiting, "member is", "members are")} waiting for you to approve searches.
        </p>
      ) : null}

      <div className="board-card">
        <h2>Question</h2>
        <div className="board-prose">{view.question}</div>
        {view.material.trim() ? (
          <details className="board-page">
            <summary>Shared material ({view.material.length.toLocaleString()} characters)</summary>
            <pre>{view.material}</pre>
          </details>
        ) : (
          <p className="board-member-meta">No shared material was given.</p>
        )}
        <p className="board-path">
          Folder: <code>{view.dir}</code>
        </p>
      </div>

      <OverlapCard overlap={view.overlap} view={view} />

      <div className="board-seats">
        {view.members.map((member) => (
          <MemberColumn key={member.slug} member={member} view={view} run={run} />
        ))}
      </div>
    </section>
  );
}
