"use client";

import { useState } from "react";
import { boardApi, errorText } from "@/components/board/board-api";
import { Prose } from "@/components/board/prose";
import { SawList, StepError } from "@/components/board/session-parts";
import type { StepRequest } from "@/components/board/use-session";
import type { LessonProposal, SessionMemberView, SessionView, StepState } from "@/lib/board/types";

type Run = (request: StepRequest) => void;

/** What the owner gave this member and no one else. */
export function DossierNote({ text }: { text: string }) {
  const note = text.trim();
  return (
    <details className="board-page board-dossier">
      <summary>Private dossier: {note.length.toLocaleString()} characters only this member was given</summary>
      <pre>{note}</pre>
    </details>
  );
}

/** A step whose whole output is one piece of writing: the premortem and the cross-examination. */
export function WrittenStep({
  title,
  state,
  text,
  idleText,
  busyText,
  onRetry,
}: {
  title: string;
  state: StepState;
  text: string | null;
  idleText: string;
  busyText: string;
  onRetry: () => void;
}) {
  if (state.status === "skipped") return null;
  return (
    <section className="board-section">
      <h3>{title}</h3>
      {state.status === "idle" ? <p className="sheet-help">{idleText}</p> : null}
      {state.status === "running" ? <p className="sheet-help">{busyText}</p> : null}
      <StepError state={state} onRetry={onRetry} />
      {text && state.status === "done" ? (
        <>
          <Prose text={text} />
          <SawList state={state} />
        </>
      ) : null}
    </section>
  );
}

/** Deep speed: the Chair's list of what the members disagree on, which aims the second round. */
export function OpenPoints({ view, onRetry }: { view: SessionView; onRetry: () => void }) {
  const chair = view.chair;
  if (!chair || chair.state.map.status === "skipped") return null;
  const { map } = chair.state;
  const points = chair.map?.points ?? [];
  return (
    <section className="board-section" data-section="open-points">
      <h3>Open points</h3>
      {map.status === "idle" ? (
        <p className="sheet-help">Listed once every first opinion is in. They aim the second round of research.</p>
      ) : null}
      {map.status === "running" ? <p className="sheet-help">Reading the first opinions…</p> : null}
      <StepError state={map} onRetry={onRetry} />
      {map.status === "done" && points.length === 0 ? (
        <p className="sheet-help">The members did not disagree on anything research could settle. No second round.</p>
      ) : null}
      {map.status === "done" && points.length ? (
        <>
          <p className="board-member-meta">
            What the members disagree on, without saying who holds which view. Each member is shown this
            list and nothing else from the others before researching again.
          </p>
          <ol className="board-points">
            {points.map((point) => (
              <li key={point.id}>
                <span className="board-source-id">{point.id}</span>
                <div>
                  <p>{point.point}</p>
                  {point.settle ? <p className="board-why">Would settle it: {point.settle}</p> : null}
                </div>
              </li>
            ))}
          </ol>
          <SawList state={map} />
        </>
      ) : null}
    </section>
  );
}

function LessonRow({
  proposal,
  busy,
  onDecide,
}: {
  proposal: LessonProposal;
  busy: boolean;
  onDecide: (action: "approve" | "reject", text: string) => void;
}) {
  const [text, setText] = useState(proposal.text);
  if (proposal.status !== "proposed") {
    return (
      <li className={`board-lesson is-${proposal.status}`}>
        <p>{proposal.text}</p>
        <span className="board-member-meta">
          {proposal.status === "approved" ? "Added to this member's lessons file" : "Rejected. Nothing was saved"}
        </span>
      </li>
    );
  }
  return (
    <li className="board-lesson">
      <textarea
        className="board-textarea board-textarea-short"
        aria-label={`Lesson ${proposal.id}`}
        value={text}
        maxLength={500}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="board-actions">
        <button type="button" className="btn btn-accent" disabled={busy || !text.trim()} onClick={() => onDecide("approve", text)}>
          Approve and save
        </button>
        <button type="button" className="btn" disabled={busy} onClick={() => onDecide("reject", text)}>
          Reject
        </button>
      </div>
    </li>
  );
}

/**
 * After the memo, a member can propose lines for their own lessons file.
 * Nothing reaches the member until the owner approves a line.
 */
export function LessonsSection({
  id,
  member,
  run,
  onChange,
}: {
  id: string;
  member: SessionMemberView;
  run: Run;
  onChange: (next: SessionView) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const record = member.lessons;
  const state: StepState = record?.state ?? { status: "idle" };
  const propose = () => run({ step: "lessons", member: member.slug });

  const decide = async (lesson: string, action: "approve" | "reject", text: string) => {
    setBusy(true);
    setError(null);
    try {
      const data = await boardApi<{ session: SessionView }>(`/api/board/sessions/${id}/lessons`, {
        method: "POST",
        body: { member: member.slug, lesson, action, text },
      });
      onChange(data.session);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="board-section" data-section="lessons">
      <h3>Lessons to keep</h3>
      {state.status === "idle" ? (
        <>
          <p className="sheet-help">
            Ask this member what they would carry into the next decision. You approve each line before it is
            added to their lessons file. It is worth doing after you have recorded your decision.
          </p>
          <div className="board-actions">
            <button type="button" className="btn" onClick={propose}>
              Suggest lessons
            </button>
          </div>
        </>
      ) : null}
      {state.status === "running" ? <p className="sheet-help">Thinking about what to keep…</p> : null}
      <StepError state={state} onRetry={propose} />
      {error ? (
        <p className="board-error" role="alert">
          {error}
        </p>
      ) : null}
      {state.status === "done" && record ? (
        <>
          {record.proposals.length === 0 ? <p className="sheet-help">Nothing worth keeping from this one.</p> : null}
          <ul className="board-lessons">
            {record.proposals.map((proposal) => (
              <LessonRow
                key={`${proposal.id}-${proposal.status}-${proposal.text}`}
                proposal={proposal}
                busy={busy}
                onDecide={(action, text) => void decide(proposal.id, action, text)}
              />
            ))}
          </ul>
          <SawList state={state} />
          <div className="board-actions">
            <button type="button" className="btn" onClick={propose}>
              Suggest again
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}
