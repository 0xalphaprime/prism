"use client";

import { useState } from "react";
import { boardApi, errorText } from "@/components/board/board-api";
import { ModelSelect } from "@/components/board/model-select";
import { loadBoardModel, saveBoardModel } from "@/components/board/session-intake";

type Turn = { role: "interviewer" | "owner"; text: string };
export type InterviewDraft = { name: string; title: string; profile: string; directives: string };
type Reply = { kind: "question"; question: string } | { kind: "draft"; draft: InterviewDraft };

/**
 * A short interview that drafts a new member. Nothing is saved here: the
 * draft is handed back, and the member is only created when the owner says so.
 */
export function MemberInterview({
  onCreate,
  onClose,
}: {
  onCreate: (draft: InterviewDraft) => void;
  onClose: () => void;
}) {
  const [model, setModel] = useState(() => (typeof window === "undefined" ? "" : loadBoardModel()));
  const [turns, setTurns] = useState<Turn[]>([]);
  const [answer, setAnswer] = useState("");
  const [draft, setDraft] = useState<InterviewDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ask = async (transcript: Turn[], finish: boolean) => {
    setBusy(true);
    setError(null);
    try {
      saveBoardModel(model);
      const reply = await boardApi<Reply>("/api/board/interview", {
        method: "POST",
        body: { model, transcript, finish },
      });
      if (reply.kind === "draft") {
        setTurns(transcript);
        setDraft(reply.draft);
      } else {
        setTurns([...transcript, { role: "interviewer", text: reply.question }]);
      }
      setAnswer("");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const withAnswer = (): Turn[] => (answer.trim() ? [...turns, { role: "owner", text: answer.trim() }] : turns);
  const started = turns.length > 0;
  const question = turns[turns.length - 1]?.role === "interviewer" ? turns[turns.length - 1].text : null;
  const answered = withAnswer().some((t) => t.role === "owner");
  const earlier = question ? turns.slice(0, -1) : turns;

  return (
    <div className="board-card board-interview" data-section="interview">
      <header className="board-seat-head">
        <div>
          <h2>Draft a member with an interview</h2>
          <p className="sheet-help">
            A few questions about what you want this member to see that the others do not, then a
            first draft of their profile and research directives. Nothing is saved until you say so.
          </p>
        </div>
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
      </header>
      {error ? (
        <p className="board-error" role="alert">
          {error}
        </p>
      ) : null}

      {!started && !draft ? (
        <>
          <label className="field">
            <span>Model</span>
            <ModelSelect value={model} onChange={setModel} />
          </label>
          <div className="board-actions">
            <button type="button" className="btn btn-accent" disabled={busy || !model} onClick={() => ask([], false)}>
              {busy ? "Starting…" : "Start the interview"}
            </button>
          </div>
        </>
      ) : null}

      {earlier.length ? (
        <ol className="board-interview-log">
          {earlier.map((turn, i) => (
            <li key={i} className={`is-${turn.role}`}>
              <span>{turn.role === "owner" ? "You" : "Question"}</span>
              {turn.text}
            </li>
          ))}
        </ol>
      ) : null}

      {question && !draft ? (
        <>
          <label className="field">
            <span>{question}</span>
            <textarea
              className="board-textarea board-textarea-short"
              aria-label="Your answer"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="Answer in your own words. A sentence or two is enough."
            />
          </label>
          <div className="board-actions">
            <button
              type="button"
              className="btn btn-accent"
              disabled={busy || !answer.trim()}
              onClick={() => ask(withAnswer(), false)}
            >
              {busy ? "Thinking…" : "Next question"}
            </button>
            <button type="button" className="btn" disabled={busy || !answered} onClick={() => ask(withAnswer(), true)}>
              Write the draft now
            </button>
          </div>
        </>
      ) : null}

      {draft ? (
        <div className="board-interview-draft">
          <div className="board-field-row">
            <label className="field">
              <span>Name</span>
              <input value={draft.name} maxLength={80} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </label>
            <label className="field">
              <span>Accountable for</span>
              <input value={draft.title} maxLength={240} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            </label>
          </div>
          <label className="field">
            <span>Profile</span>
            <textarea
              className="board-textarea"
              value={draft.profile}
              onChange={(e) => setDraft({ ...draft, profile: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Research directives</span>
            <textarea
              className="board-textarea board-textarea-short"
              value={draft.directives}
              onChange={(e) => setDraft({ ...draft, directives: e.target.value })}
            />
          </label>
          <div className="board-actions">
            <button
              type="button"
              className="btn btn-accent"
              disabled={!draft.name.trim() || !draft.profile.trim()}
              onClick={() => onCreate(draft)}
            >
              Create this member
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => setDraft(null)}>
              Back to the interview
            </button>
            <span className="board-member-meta">A draft written by a model. Read it and change what is wrong.</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
