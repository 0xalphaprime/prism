"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { boardApi, errorText } from "@/components/board/board-api";
import { ModelSelect } from "@/components/board/model-select";
import { loadProviderPrefs } from "@/lib/provider-prefs";
import { defaultModelForProvider } from "@/lib/providers";
import { DEFAULT_LIMITS, MAX_LIMITS } from "@/lib/board/research";
import type { MemberSummary, SessionKind, SessionSpeed, SessionSummary } from "@/lib/board/types";

const MODEL_KEY = "prism.board.model";

function loadBoardModel(): string {
  try {
    const saved = window.localStorage.getItem(MODEL_KEY);
    if (saved) return saved;
  } catch {
    // fall through to the default channel
  }
  return defaultModelForProvider(loadProviderPrefs().defaultProvider);
}

function saveBoardModel(model: string) {
  try {
    window.localStorage.setItem(MODEL_KEY, model);
  } catch {
    // not being able to remember the choice is harmless
  }
}

export function SessionList({
  sessions,
  empty,
}: {
  sessions: SessionSummary[] | null;
  empty: string;
}) {
  if (sessions === null) return <p className="sheet-help">Loading…</p>;
  if (sessions.length === 0) return <p className="sheet-help">{empty}</p>;
  return (
    <ul className="board-session-list">
      {sessions.map((s) => (
        <li key={s.id}>
          <Link href={`/board/session/${s.id}`} className="board-roster-item">
            <span className="board-member-name">{s.title}</span>
            <span className="board-member-title">{s.members.join(", ")}</span>
            <span className="board-member-meta">
              {new Date(s.createdAt).toLocaleString()}
              {s.kind === "board" ? ` · ${s.speed === "fast" ? "Fast" : "Standard"}` : ""}
              {s.finished ? " · finished" : " · not finished"}
              {s.sensitive ? " · sensitive" : ""}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** The form that starts a research trial (`trial`) or a full board session (`board`). */
export function SessionIntake({ kind }: { kind: SessionKind }) {
  const router = useRouter();
  const board = kind === "board";
  const [members, setMembers] = useState<MemberSummary[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [question, setQuestion] = useState("");
  const [material, setMaterial] = useState("");
  const [model, setModel] = useState("");
  const [speed, setSpeed] = useState<SessionSpeed>("standard");
  const [generalist, setGeneralist] = useState(false);
  const [searches, setSearches] = useState(DEFAULT_LIMITS.searches);
  const [pages, setPages] = useState(DEFAULT_LIMITS.pagesPerSearch);
  const [approve, setApprove] = useState(false);
  const [sensitive, setSensitive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const boot = async () => {
      try {
        const data = await boardApi<{ members: MemberSummary[] }>("/api/board/members");
        if (cancelled) return;
        setMembers(data.members);
        if (board) {
          setPicked(data.members.map((m) => m.slug));
        } else {
          const wanted = new URLSearchParams(window.location.search).get("m");
          const first = data.members.find((row) => row.slug === wanted) ?? data.members[0];
          setPicked(first ? [first.slug] : []);
        }
        setModel(loadBoardModel());
      } catch (err) {
        if (!cancelled) setError(errorText(err));
      }
    };
    void boot();
    return () => {
      cancelled = true;
    };
  }, [board]);

  const fast = board && speed === "fast";
  const toggle = (slug: string) =>
    setPicked((list) => (list.includes(slug) ? list.filter((s) => s !== slug) : [...list, slug]));

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      saveBoardModel(model);
      const data = await boardApi<{ id: string }>("/api/board/sessions", {
        method: "POST",
        body: {
          kind,
          question,
          material,
          model,
          members: picked,
          speed: board ? speed : undefined,
          withGeneralist: board ? generalist : undefined,
          sensitive,
          approveSearches: approve || sensitive,
          limits: { searches, pagesPerSearch: pages },
        },
      });
      router.push(`/board/session/${data.id}?run=1`);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  const tooMany = fast && picked.length > 2;
  const ready = question.trim() && picked.length > 0 && model && !tooMany;

  return (
    <div className="board-card">
      <h2>{board ? "Bring a decision" : "New research trial"}</h2>
      {error ? (
        <p className="board-error" role="alert">
          {error}
        </p>
      ) : null}
      <label className="field">
        <span>{board ? "The decision" : "Question"}</span>
        <textarea
          className="board-textarea board-textarea-short"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={
            board
              ? "What are you deciding? Say what the options are if you know them."
              : "What do you want looked into?"
          }
        />
      </label>
      <label className="field">
        <span>Shared material{board ? "" : " (optional)"}</span>
        <textarea
          className="board-textarea"
          value={material}
          onChange={(e) => setMaterial(e.target.value)}
          placeholder="Paste what every member should read. It stays on this machine; only the searches go out."
        />
        <small className="field-hint">
          {material.length.toLocaleString()} characters. Every member reads exactly this.
        </small>
      </label>

      {board ? (
        <div className="field">
          <span>Speed</span>
          <div className="board-picks">
            <label className={`board-pick${speed === "standard" ? " is-on" : ""}`}>
              <input type="radio" name="speed" checked={speed === "standard"} onChange={() => setSpeed("standard")} />
              <span>
                <strong>Standard</strong>
                <em>Each member researches, takes notes, then gives an opinion. The Chair writes the memo.</em>
              </span>
            </label>
            <label className={`board-pick${speed === "fast" ? " is-on" : ""}`}>
              <input type="radio" name="speed" checked={speed === "fast"} onChange={() => setSpeed("fast")} />
              <span>
                <strong>Fast</strong>
                <em>No outside research. One or two members give an opinion from the material alone.</em>
              </span>
            </label>
          </div>
        </div>
      ) : null}

      <div className="field">
        <span>Members</span>
        <div className="board-picks">
          {members?.map((m) => (
            <label key={m.slug} className={`board-pick${picked.includes(m.slug) ? " is-on" : ""}`}>
              <input type="checkbox" checked={picked.includes(m.slug)} onChange={() => toggle(m.slug)} />
              <span>
                <strong>{m.name}</strong>
                <em>{m.title}</em>
              </span>
            </label>
          ))}
        </div>
        {members?.length === 0 ? (
          <small className="field-hint">
            No members yet. <Link href="/board/members">Create one</Link>.
          </small>
        ) : null}
        {tooMany ? (
          <small className="field-hint board-flag">Fast takes one or two members. Untick some, or choose Standard.</small>
        ) : null}
      </div>

      <div className="board-field-grid">
        <label className="field">
          <span>Model</span>
          <ModelSelect value={model} onChange={setModel} />
        </label>
        {fast ? null : (
          <>
            <label className="field">
              <span>Searches per member</span>
              <input
                type="number"
                min={0}
                max={MAX_LIMITS.searches}
                value={searches}
                onChange={(e) => setSearches(Number(e.target.value))}
              />
            </label>
            <label className="field">
              <span>Pages read per search</span>
              <input
                type="number"
                min={1}
                max={MAX_LIMITS.pagesPerSearch}
                value={pages}
                onChange={(e) => setPages(Number(e.target.value))}
              />
            </label>
          </>
        )}
      </div>

      {board ? (
        <label className="field-checkbox">
          <input type="checkbox" checked={generalist} onChange={(e) => setGeneralist(e.target.checked)} />
          <span>
            Also run one generalist on the same material with the same search allowance, to compare
          </span>
        </label>
      ) : null}
      {fast ? null : (
        <>
          <label className="field-checkbox">
            <input
              type="checkbox"
              checked={approve || sensitive}
              disabled={sensitive}
              onChange={(e) => setApprove(e.target.checked)}
            />
            <span>Show me the searches before they run</span>
          </label>
          <label className="field-checkbox">
            <input type="checkbox" checked={sensitive} onChange={(e) => setSensitive(e.target.checked)} />
            <span>This is sensitive (searches always wait for my approval)</span>
          </label>
          <p className="board-member-meta">
            A search that repeats a name or figure from your material is always held for you, even with
            both boxes off.
          </p>
        </>
      )}

      <div className="board-actions">
        <button type="button" className="btn btn-accent" disabled={!ready || busy} onClick={start}>
          {busy ? "Starting…" : board ? "Convene the board" : "Start research"}
        </button>
      </div>
    </div>
  );
}
