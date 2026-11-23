"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { boardApi, errorText } from "@/components/board/board-api";
import { SearchStatus } from "@/components/board/search-status";
import { SessionIntake, SessionList } from "@/components/board/session-intake";
import type { SessionSummary } from "@/lib/board/types";

function StandingCard() {
  const [saved, setSaved] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [file, setFile] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const boot = async () => {
      try {
        const data = await boardApi<{ standing: string; file: string }>("/api/board/standing");
        if (cancelled) return;
        setSaved(data.standing);
        setText(data.standing);
        setFile(data.file);
      } catch (err) {
        if (!cancelled) setError(errorText(err));
      }
    };
    void boot();
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await boardApi<{ standing: string }>("/api/board/standing", {
        method: "PUT",
        body: { standing: text },
      });
      setSaved(data.standing);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const dirty = saved !== null && text !== saved;
  return (
    <details className="board-card board-standing" open={Boolean(saved)}>
      <summary>
        <h2>Standing context</h2>
      </summary>
      <p className="sheet-help">
        What everyone should always know about you and the business: what you are building, what you
        will not do, the constraints that do not change. Copied into each new session and read by
        every member, the Chair and the generalist.
      </p>
      {error ? (
        <p className="board-error" role="alert">
          {error}
        </p>
      ) : null}
      <textarea
        className="board-textarea board-standing-text"
        aria-label="Standing context"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Leave empty if you would rather put everything in the material each time."
      />
      <div className="board-actions">
        <button type="button" className="btn btn-accent" disabled={!dirty || busy} onClick={save}>
          {busy ? "Saving…" : "Save"}
        </button>
        <span className={`board-dirty${dirty ? " is-dirty" : ""}`}>
          {dirty ? "Unsaved changes" : saved !== null ? `${text.length.toLocaleString()} characters` : ""}
        </span>
      </div>
      {file ? (
        <p className="board-path">
          File: <code>{file}</code>
        </p>
      ) : null}
    </details>
  );
}

export function BoardHome() {
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const boot = async () => {
      try {
        const data = await boardApi<{ sessions: SessionSummary[] }>("/api/board/sessions");
        if (!cancelled) setSessions(data.sessions.filter((row) => row.kind === "board"));
      } catch (err) {
        if (!cancelled) setError(errorText(err));
      }
    };
    void boot();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="page-workspace board-workspace">
      <header className="page-workspace-header">
        <div>
          <p className="sheet-kicker">Board</p>
          <h1>Your board</h1>
          <p className="sheet-help">
            A standing set of members who read the same material and see different things in it. You
            bring a decision; each gives an opinion without seeing the others; the Chair lays out where
            they disagree and recommends. You decide.
          </p>
        </div>
        <div className="board-actions">
          <Link href="/board/members" className="btn">
            Edit members
          </Link>
        </div>
      </header>

      <SearchStatus />

      {error ? (
        <p className="board-error" role="alert">
          {error}
        </p>
      ) : null}

      <SessionIntake kind="board" />
      <StandingCard />

      <div className="board-card">
        <h2>Sessions</h2>
        <SessionList sessions={sessions} empty="No sessions yet." />
      </div>
    </section>
  );
}
