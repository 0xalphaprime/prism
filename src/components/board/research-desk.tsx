"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { boardApi, errorText } from "@/components/board/board-api";
import { ModelSelect } from "@/components/board/model-select";
import { SearchStatus } from "@/components/board/search-status";
import { loadProviderPrefs } from "@/lib/provider-prefs";
import { defaultModelForProvider } from "@/lib/providers";
import { DEFAULT_LIMITS, MAX_LIMITS } from "@/lib/board/research";
import type { MemberSummary, SessionSummary } from "@/lib/board/types";

const MODEL_KEY = "prism.board.model";

export function loadBoardModel(): string {
  try {
    const saved = window.localStorage.getItem(MODEL_KEY);
    if (saved) return saved;
  } catch {
    // fall through to the default channel
  }
  return defaultModelForProvider(loadProviderPrefs().defaultProvider);
}

export function saveBoardModel(model: string) {
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
              {s.sensitive ? " · sensitive" : ""}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function ResearchDesk() {
  const router = useRouter();
  const [members, setMembers] = useState<MemberSummary[] | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [question, setQuestion] = useState("");
  const [material, setMaterial] = useState("");
  const [model, setModel] = useState("");
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
        const [m, s] = await Promise.all([
          boardApi<{ members: MemberSummary[] }>("/api/board/members"),
          boardApi<{ sessions: SessionSummary[] }>("/api/board/sessions"),
        ]);
        if (cancelled) return;
        setMembers(m.members);
        setSessions(s.sessions.filter((row) => row.kind === "trial"));
        const wanted = new URLSearchParams(window.location.search).get("m");
        const first = m.members.find((row) => row.slug === wanted) ?? m.members[0];
        setPicked(first ? [first.slug] : []);
        setModel(loadBoardModel());
      } catch (err) {
        if (!cancelled) setError(errorText(err));
      }
    };
    void boot();
    return () => {
      cancelled = true;
    };
  }, []);

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
          kind: "trial",
          question,
          material,
          model,
          members: picked,
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

  const ready = question.trim() && picked.length > 0 && model;

  return (
    <section className="page-workspace board-workspace">
      <header className="page-workspace-header">
        <div>
          <p className="sheet-kicker">Board</p>
          <h1>Research desk</h1>
          <p className="sheet-help">
            Give one or more members a question and watch where each one looks. Every search, every
            page read, and the notes they take are kept and shown. Use it to tune a member&apos;s
            research directives.
          </p>
        </div>
      </header>

      <SearchStatus />

      {error ? (
        <p className="board-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="board-card">
        <h2>New research trial</h2>
        <label className="field">
          <span>Question</span>
          <textarea
            className="board-textarea board-textarea-short"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="What do you want looked into?"
          />
        </label>
        <label className="field">
          <span>Shared material (optional)</span>
          <textarea
            className="board-textarea"
            value={material}
            onChange={(e) => setMaterial(e.target.value)}
            placeholder="Paste anything every member should read. It stays on this machine; only the searches go out."
          />
          <small className="field-hint">{material.length.toLocaleString()} characters</small>
        </label>

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
        </div>

        <div className="board-field-grid">
          <label className="field">
            <span>Model</span>
            <ModelSelect value={model} onChange={setModel} />
          </label>
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
        </div>

        <label className="field-checkbox">
          <input type="checkbox" checked={approve || sensitive} disabled={sensitive} onChange={(e) => setApprove(e.target.checked)} />
          <span>Show me each member&apos;s searches before they run</span>
        </label>
        <label className="field-checkbox">
          <input type="checkbox" checked={sensitive} onChange={(e) => setSensitive(e.target.checked)} />
          <span>This is sensitive (searches always wait for my approval)</span>
        </label>
        <p className="board-member-meta">
          A search that repeats a name or figure from your material is always held for you, even with
          both boxes off.
        </p>

        <div className="board-actions">
          <button type="button" className="btn btn-accent" disabled={!ready || busy} onClick={start}>
            {busy ? "Starting…" : "Start research"}
          </button>
        </div>
      </div>

      <div className="board-card">
        <h2>Earlier trials</h2>
        <SessionList sessions={sessions} empty="No trials yet." />
      </div>
    </section>
  );
}
