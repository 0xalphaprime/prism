"use client";

import { useEffect, useState } from "react";
import { boardApi, errorText } from "@/components/board/board-api";
import type { DecisionRecord, DecisionStatus } from "@/lib/board/types";

export const DECISION_STATUS: Array<{ value: DecisionStatus; label: string; help: string }> = [
  { value: "undecided", label: "Not decided", help: "Still thinking." },
  { value: "decided", label: "Decided", help: "You have made the call." },
  { value: "parked", label: "Parked", help: "Not now. Set a date to come back." },
  { value: "dropped", label: "Dropped", help: "No longer a live question." },
];

export function statusLabel(status: DecisionStatus) {
  return DECISION_STATUS.find((s) => s.value === status)?.label ?? status;
}

export function StatusChip({ status }: { status: DecisionStatus }) {
  return <span className={`board-status is-${status}`}>{statusLabel(status)}</span>;
}

type Form = {
  status: DecisionStatus;
  choice: string;
  rationale: string;
  reviewOn: string;
  outcome: string;
};

function toForm(decision: DecisionRecord): Form {
  return {
    status: decision.status,
    choice: decision.choice,
    rationale: decision.rationale,
    reviewOn: decision.reviewOn ?? "",
    outcome: decision.outcome,
  };
}

function same(a: Form, b: Form) {
  return (Object.keys(a) as Array<keyof Form>).every((key) => a[key] === b[key]);
}

type Loaded = { decision: DecisionRecord; handoff: string | null };

/** Where the owner writes down what they did with the advice. One per board session. */
export function DecisionCard({ id, chairDone }: { id: string; chairDone: boolean }) {
  const [saved, setSaved] = useState<Loaded | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reloaded when the Chair finishes, because that is when the hand-off file first appears.
  useEffect(() => {
    let cancelled = false;
    const boot = async () => {
      try {
        const data = await boardApi<Loaded>(`/api/board/sessions/${id}/decision`);
        if (cancelled) return;
        setSaved(data);
        setForm((current) => current ?? toForm(data.decision));
      } catch (err) {
        if (!cancelled) setError(errorText(err));
      }
    };
    void boot();
    return () => {
      cancelled = true;
    };
  }, [id, chairDone]);

  if (!saved || !form) {
    return (
      <div className="board-card board-decision" id="decision">
        <h2>Your decision</h2>
        {error ? (
          <p className="board-error" role="alert">
            {error}
          </p>
        ) : (
          <p className="sheet-help">Loading…</p>
        )}
      </div>
    );
  }

  const set = (patch: Partial<Form>) => setForm({ ...form, ...patch });
  const dirty = !same(form, toForm(saved.decision));
  const needsChoice = form.status === "decided" && !form.choice.trim();

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await boardApi<{ decision: DecisionRecord; handoff: string }>(
        `/api/board/sessions/${id}/decision`,
        { method: "PUT", body: form },
      );
      setSaved(data);
      setForm(toForm(data.decision));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const { decision } = saved;
  return (
    <div className="board-card board-decision" id="decision">
      <header className="board-seat-head">
        <div>
          <h2>Your decision</h2>
          <p className="sheet-help">
            The board advises; you decide. Write down what you did so you can check later whether it
            was right.
          </p>
        </div>
        <StatusChip status={decision.status} />
      </header>
      {!chairDone ? (
        <p className="board-member-meta">
          The Chair has not reported yet. You can still park or drop this now.
        </p>
      ) : null}
      {error ? (
        <p className="board-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="field">
        <span>Where it stands</span>
        <div className="board-picks">
          {DECISION_STATUS.map((option) => (
            <label key={option.value} className={`board-pick${form.status === option.value ? " is-on" : ""}`}>
              <input
                type="radio"
                name="decision-status"
                checked={form.status === option.value}
                onChange={() => set({ status: option.value })}
              />
              <span>
                <strong>{option.label}</strong>
                <em>{option.help}</em>
              </span>
            </label>
          ))}
        </div>
      </div>

      <label className="field">
        <span>What you decided</span>
        <textarea
          className="board-textarea board-textarea-short"
          value={form.choice}
          onChange={(e) => set({ choice: e.target.value })}
          placeholder="In one or two sentences. Say it the way you would tell someone else."
        />
        {needsChoice ? (
          <small className="field-hint board-flag">Write what you decided before saving it as decided.</small>
        ) : null}
      </label>
      <label className="field">
        <span>Why</span>
        <textarea
          className="board-textarea board-textarea-short"
          value={form.rationale}
          onChange={(e) => set({ rationale: e.target.value })}
          placeholder="Which argument carried it? What did you set aside, and why?"
        />
      </label>
      <div className="board-field-grid">
        <label className="field">
          <span>Review on</span>
          <input type="date" value={form.reviewOn} onChange={(e) => set({ reviewOn: e.target.value })} />
          <small className="field-hint">The day this shows up under loose ends again.</small>
        </label>
      </div>
      <label className="field">
        <span>What happened</span>
        <textarea
          className="board-textarea board-textarea-short"
          value={form.outcome}
          onChange={(e) => set({ outcome: e.target.value })}
          placeholder="Fill this in at review. Was the board right? Who saw it coming?"
        />
      </label>

      <div className="board-actions">
        <button type="button" className="btn btn-accent" disabled={!dirty || busy || needsChoice} onClick={save}>
          {busy ? "Saving…" : "Save decision"}
        </button>
        <span className={`board-dirty${dirty ? " is-dirty" : ""}`}>
          {dirty
            ? "Unsaved changes"
            : decision.updatedAt
              ? `Saved ${new Date(decision.updatedAt).toLocaleString()}`
              : "Nothing recorded yet"}
        </span>
      </div>
      {saved.handoff ? (
        <p className="board-path">
          Hand-off file: <code>{saved.handoff}</code>
        </p>
      ) : null}
    </div>
  );
}
