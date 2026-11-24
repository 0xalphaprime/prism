"use client";

import { useEffect, useState } from "react";
import { boardApi, errorText } from "@/components/board/board-api";
import { SearchStatus } from "@/components/board/search-status";
import { SessionIntake, SessionList } from "@/components/board/session-intake";
import type { SessionSummary } from "@/lib/board/types";

export function ResearchDesk() {
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const boot = async () => {
      try {
        const data = await boardApi<{ sessions: SessionSummary[] }>("/api/board/sessions");
        if (!cancelled) setSessions(data.sessions.filter((row) => row.kind === "trial"));
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
          <h1>Research desk</h1>
          <p className="sheet-help">
            Give one or more members a question and watch where each one looks. Every search, every
            page read, and the notes they take are kept and shown. Use it to tune a member&apos;s
            research directives. No opinions are given here.
          </p>
        </div>
      </header>

      <SearchStatus />

      {error ? (
        <p className="board-error" role="alert">
          {error}
        </p>
      ) : null}

      <SessionIntake kind="trial" />

      <div className="board-card">
        <h2>Earlier trials</h2>
        <SessionList sessions={sessions} empty="No trials yet." />
      </div>
    </section>
  );
}
