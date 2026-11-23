"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { boardApi, errorText } from "@/components/board/board-api";
import { Prose } from "@/components/board/prose";
import {
  allMoves,
  opinionCount,
  useSession,
  type StepRequest,
} from "@/components/board/use-session";
import { modelLabel } from "@/lib/providers";
import type {
  GeneralistView,
  MemberPlan,
  OverlapReport,
  PlannedQuery,
  ResearchRecord,
  SessionMemberView,
  SessionView,
  StepState,
} from "@/lib/board/types";

type Run = (request: StepRequest) => void;

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
  children?: ReactNode;
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
  plan,
  planStep,
  researchStep,
  limit,
  onRetry,
  onApprove,
  onSkip,
}: {
  plan: MemberPlan | null;
  planStep: StepState;
  researchStep: StepState;
  limit: number;
  onRetry: () => void;
  onApprove: (queries: PlannedQuery[]) => void;
  onSkip: () => void;
}) {
  const held = Boolean(plan && !plan.approved && researchStep.status === "idle" && planStep.status === "done");
  const [draft, setDraft] = useState<{ source: MemberPlan; queries: PlannedQuery[] } | null>(null);
  const queries = held && draft && draft.source === plan ? draft.queries : (plan?.queries ?? []);
  const edit = (next: PlannedQuery[]) => plan && setDraft({ source: plan, queries: next });
  const flaggedFor = (query: string) => plan?.flagged.find((f) => f.query === query)?.terms ?? [];

  if (planStep.status === "skipped") return null;
  return (
    <section className="board-section">
      <h3>Search plan</h3>
      {planStep.status === "idle" ? <p className="sheet-help">Not written yet.</p> : null}
      {planStep.status === "running" ? <p className="sheet-help">Deciding what to look for…</p> : null}
      <StepError state={planStep} onRetry={onRetry} />

      {plan && planStep.status === "done" ? (
        <>
          {plan.queries.length === 0 && !held ? <p className="sheet-help">Chose not to search.</p> : null}
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
                    <button type="button" className="btn" onClick={() => edit(queries.filter((_, j) => j !== i))}>
                      Remove
                    </button>
                  </div>
                ) : (
                  <span className="board-query">{q.query}</span>
                )}
                {q.why ? <span className="board-why">{q.why}</span> : null}
                {flaggedFor(q.query).length ? (
                  <span className="board-flag">Repeats from your material: {flaggedFor(q.query).join(", ")}</span>
                ) : null}
              </li>
            ))}
          </ol>
          {held ? (
            <div className="board-actions">
              <button type="button" className="btn btn-accent" onClick={() => onApprove(queries)}>
                Approve and search
              </button>
              {queries.length < limit ? (
                <button type="button" className="btn" onClick={() => edit([...queries, { query: "", why: "" }])}>
                  Add a search
                </button>
              ) : null}
              <button type="button" className="btn" onClick={onSkip}>
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
  step,
  record,
  onRetry,
  onSkip,
}: {
  step: StepState;
  record: ResearchRecord | null;
  onRetry: () => void;
  onSkip: () => void;
}) {
  if (step.status === "skipped" && !record) {
    return (
      <section className="board-section">
        <h3>Research</h3>
        <p className="sheet-help">No outside research. Working from the shared material alone.</p>
      </section>
    );
  }
  return (
    <section className="board-section">
      <h3>Research trail</h3>
      {step.status === "idle" ? <p className="sheet-help">Nothing searched yet.</p> : null}
      {step.status === "running" ? <p className="sheet-help">Searching and reading…</p> : null}
      <StepError state={step} onRetry={onRetry}>
        <button type="button" className="btn" onClick={onSkip}>
          Continue without research
        </button>
      </StepError>
      {record && step.status !== "running" ? <ResearchTrail record={record} /> : null}
    </section>
  );
}

function NotesSection({ member, sealed, run }: { member: SessionMemberView; sealed: boolean; run: Run }) {
  const step = member.state.steps.notes;
  if (step.status === "skipped") return null;
  return (
    <section className="board-section">
      <h3>Research notes</h3>
      {step.status === "idle" ? <p className="sheet-help">Written after research.</p> : null}
      {step.status === "running" ? <p className="sheet-help">Writing notes…</p> : null}
      <StepError state={step} onRetry={() => run({ step: "notes", member: member.slug })} />
      {step.status === "done" && sealed ? (
        <p className="board-sealed">Written. Sealed until every member has given an opinion.</p>
      ) : null}
      {member.notes && step.status === "done" ? (
        <>
          <Prose text={member.notes} />
          <SawList state={step} />
        </>
      ) : null}
    </section>
  );
}

function OpinionSection({ member, sealed, run }: { member: SessionMemberView; sealed: boolean; run: Run }) {
  const step = member.state.steps.opinion;
  return (
    <section className="board-section board-opinion">
      <h3>Opinion</h3>
      {step.status === "idle" ? <p className="sheet-help">Given after research, without seeing anyone else&apos;s.</p> : null}
      {step.status === "running" ? <p className="sheet-help">Writing an opinion…</p> : null}
      <StepError state={step} onRetry={() => run({ step: "opinion", member: member.slug })}>
        <button type="button" className="btn" onClick={() => run({ step: "drop", member: member.slug })}>
          Continue without this member
        </button>
      </StepError>
      {step.status === "done" && sealed ? (
        <p className="board-sealed">Opinion is in. Sealed until every member has answered.</p>
      ) : null}
      {member.opinion && step.status === "done" ? (
        <>
          <Prose text={member.opinion} />
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

function MemberColumn({ member, view, run }: { member: SessionMemberView; view: SessionView; run: Run }) {
  const steps = member.state.steps;
  const board = view.kind === "board";
  const slug = member.slug;
  const chips: Array<[string, StepState]> = [
    ["Search plan", steps.plan],
    ["Research", steps.research],
    ["Notes", steps.notes],
  ];
  if (board) chips.push(["Opinion", steps.opinion]);
  const dropped = Boolean(member.state.dropped);

  return (
    <article className={`board-seat${dropped ? " is-dropped" : ""}`} data-member={slug}>
      <header className="board-seat-head">
        <div>
          <h2>{member.name}</h2>
          <p className="board-member-title">{member.title}</p>
        </div>
        <Link href={`/board/members?m=${slug}`} className="board-seat-link">
          Edit member
        </Link>
      </header>
      {dropped ? (
        <div className="board-hold">
          Left out of this session. The Chair does not read this member.
          <div className="board-actions">
            <button type="button" className="btn" onClick={() => run({ step: "restore", member: slug })}>
              Bring back
            </button>
          </div>
        </div>
      ) : null}
      <div className="board-steps">
        {chips.map(([label, state]) => (
          <StepChip key={label} label={label} state={state} />
        ))}
      </div>
      {board ? <OpinionSection member={member} sealed={view.sealed} run={run} /> : null}
      <PlanSection
        plan={member.plan}
        planStep={steps.plan}
        researchStep={steps.research}
        limit={view.limits.searches}
        onRetry={() => run({ step: "plan", member: slug })}
        onApprove={(queries) => run({ step: "research", member: slug, body: { approve: true, queries } })}
        onSkip={() => run({ step: "skip-research", member: slug })}
      />
      <ResearchSection
        step={steps.research}
        record={member.research}
        onRetry={() => run({ step: "research", member: slug })}
        onSkip={() => run({ step: "skip-research", member: slug })}
      />
      <NotesSection member={member} sealed={view.sealed} run={run} />
      {steps.plan.status === "done" && !dropped ? (
        <div className="board-actions board-seat-foot">
          <button type="button" className="btn" onClick={() => run({ step: "plan", member: slug })}>
            Start this member again
          </button>
        </div>
      ) : null}
    </article>
  );
}

function ChairCard({ view, run }: { view: SessionView; run: Run }) {
  if (!view.chair) return null;
  const memo = view.chair.state.memo;
  const { done, total } = opinionCount(view);
  return (
    <article className="board-memo" data-seat="chair">
      <header className="board-seat-head">
        <div>
          <h2>The board (Chair&apos;s memo)</h2>
          <p className="board-member-title">
            Reads every opinion and the sources they cite. Does not read the members&apos; notes.
          </p>
        </div>
        <StepChip label="Memo" state={memo} />
      </header>
      {memo.status === "idle" ? (
        <p className="sheet-help">
          Written once every opinion is in ({done} of {total} so far).
        </p>
      ) : null}
      {memo.status === "running" ? <p className="sheet-help">Reading the opinions…</p> : null}
      <StepError state={memo} onRetry={() => run({ step: "chair" })} />
      {view.chair.memo && memo.status === "done" ? (
        <>
          <Prose text={view.chair.memo} />
          <SawList state={memo} />
          <div className="board-actions">
            <button type="button" className="btn" onClick={() => run({ step: "chair" })}>
              Write the memo again
            </button>
          </div>
        </>
      ) : null}
    </article>
  );
}

function GeneralistCard({ generalist, run }: { generalist: GeneralistView; run: Run }) {
  const { plan, research, memo } = generalist.state.steps;
  return (
    <article className="board-memo" data-seat="generalist">
      <header className="board-seat-head">
        <div>
          <h2>The generalist</h2>
          <p className="board-member-title">
            One adviser, same material, up to {generalist.limits.searches} searches (the members&apos;
            allowance added together).
          </p>
        </div>
        <StepChip label="Memo" state={memo} />
      </header>
      {memo.status === "idle" && research.status !== "error" && plan.status !== "error" ? (
        <p className="sheet-help">Written after its own research.</p>
      ) : null}
      {memo.status === "running" ? <p className="sheet-help">Writing the memo…</p> : null}
      <StepError state={memo} onRetry={() => run({ step: "generalist-memo" })} />
      {generalist.memo && memo.status === "done" ? (
        <>
          <Prose text={generalist.memo} />
          <SawList state={memo} />
        </>
      ) : null}
      <details className="board-page" open={Boolean(generalist.plan && !generalist.plan.approved) || research.status === "error" || plan.status === "error"}>
        <summary>The generalist&apos;s research</summary>
        <div className="board-generalist-research">
          <PlanSection
            plan={generalist.plan}
            planStep={plan}
            researchStep={research}
            limit={generalist.limits.searches}
            onRetry={() => run({ step: "generalist-plan" })}
            onApprove={(queries) => run({ step: "generalist-research", body: { approve: true, queries } })}
            onSkip={() => run({ step: "generalist-skip-research" })}
          />
          <ResearchSection
            step={research}
            record={generalist.research}
            onRetry={() => run({ step: "generalist-research" })}
            onSkip={() => run({ step: "generalist-skip-research" })}
          />
        </div>
      </details>
    </article>
  );
}

function WhoSawWhat({ view }: { view: SessionView }) {
  const rows: Array<{ who: string; step: string; state: StepState }> = [];
  for (const m of view.members) {
    rows.push({ who: m.name, step: "Search plan", state: m.state.steps.plan });
    rows.push({ who: m.name, step: "Notes", state: m.state.steps.notes });
    rows.push({ who: m.name, step: "Opinion", state: m.state.steps.opinion });
  }
  if (view.chair) rows.push({ who: "Chair", step: "Memo", state: view.chair.state.memo });
  if (view.generalist) {
    rows.push({ who: "Generalist", step: "Search plan", state: view.generalist.state.steps.plan });
    rows.push({ who: "Generalist", step: "Memo", state: view.generalist.state.steps.memo });
  }
  const shown = rows.filter((r) => r.state.status === "done" && r.state.saw);
  if (!shown.length) return null;
  return (
    <details className="board-card board-who">
      <summary>
        <h2>Who saw what</h2>
      </summary>
      <table>
        <thead>
          <tr>
            <th>Who</th>
            <th>Step</th>
            <th>Was given</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={`${r.who}-${r.step}`}>
              <td>{r.who}</td>
              <td>{r.step}</td>
              <td>{r.state.saw?.join(" · ") || "Nothing"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
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

  const board = view.kind === "board";
  const moves = allMoves(view);
  const runnable = moves.some((m) => m.kind === "run");
  const waiting = moves.filter((m) => m.kind === "owner").length;
  const stopped = moves.filter((m) => m.kind === "stopped").length;
  const allDone = moves.every((m) => m.kind === "finished");
  const started =
    view.members.some((m) => Object.values(m.state.steps).some((s) => !["idle", "skipped"].includes(s.status))) ||
    Boolean(view.generalist && view.generalist.state.steps.plan.status !== "idle");
  const { done, total } = opinionCount(view);

  // Any action taken by hand also lets the steps that follow it run on.
  const run: Run = (request) => {
    setDriving(true);
    void runStep(request);
  };

  const remove = async () => {
    if (!window.confirm("Remove this session? Its folder is moved to the trash folder.")) return;
    try {
      await boardApi(`/api/board/sessions/${id}`, { method: "DELETE" });
      router.push(board ? "/board" : "/board/research");
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <section className={`page-workspace board-workspace${view.members.length > 2 ? " is-wide" : ""}`}>
      <header className="page-workspace-header">
        <div>
          <p className="sheet-kicker">
            {board ? `Board session · ${view.speed === "fast" ? "Fast" : "Standard"}` : "Research trial"}
          </p>
          <h1>{view.title}</h1>
          <p className="sheet-help">
            {when(view.createdAt)} · {modelLabel(view.model)}
            {board && view.speed === "fast"
              ? " · no outside research"
              : view.approveSearches
                ? " · searches wait for your approval"
                : " · searches run without asking"}
            {view.sensitive ? " · marked sensitive" : ""}
          </p>
        </div>
        <div className="board-actions">
          {working ? <span className="board-dirty is-dirty">Working…</span> : null}
          {!working && allDone ? <span className="board-dirty">Finished</span> : null}
          {runnable && !(driving && working) ? (
            <button type="button" className="btn btn-accent" onClick={() => setDriving(true)}>
              {started ? "Continue" : board ? "Run the board" : "Run research"}
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
        <p className="board-hold">{plural(waiting, "search plan is", "search plans are")} waiting for your approval.</p>
      ) : null}
      {stopped && !working ? (
        <p className="board-hold">
          {plural(stopped, "step")} failed. Each one has a &quot;Try again&quot; button where it stopped.
        </p>
      ) : null}
      {board && view.sealed && started ? (
        <p className="board-sealed">
          Opinions are sealed: {done} of {total} in. Notes and opinions open together once every member
          has answered, so no one&apos;s view is shaped by another&apos;s.
        </p>
      ) : null}

      <div className="board-card">
        <h2>{board ? "The decision" : "Question"}</h2>
        <div className="board-prose">{view.question}</div>
        {view.material.trim() ? (
          <details className="board-page">
            <summary>Shared material ({view.material.length.toLocaleString()} characters)</summary>
            <pre>{view.material}</pre>
          </details>
        ) : (
          <p className="board-member-meta">No shared material was given.</p>
        )}
        {view.standing?.trim() ? (
          <details className="board-page">
            <summary>Standing context ({view.standing.length.toLocaleString()} characters)</summary>
            <pre>{view.standing}</pre>
          </details>
        ) : null}
        <p className="board-path">
          Folder: <code>{view.dir}</code>
        </p>
      </div>

      {board ? (
        <div className={`board-memos${view.generalist ? " is-pair" : ""}`}>
          <ChairCard view={view} run={run} />
          {view.generalist ? <GeneralistCard generalist={view.generalist} run={run} /> : null}
        </div>
      ) : null}

      <OverlapCard overlap={view.overlap} view={view} />

      <div className="board-seats">
        {view.members.map((member) => (
          <MemberColumn key={member.slug} member={member} view={view} run={run} />
        ))}
      </div>

      {board ? <WhoSawWhat view={view} /> : null}
    </section>
  );
}
