"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { boardApi, errorText } from "@/components/board/board-api";
import type { MemberSummary } from "@/lib/board/types";

export function BoardHome() {
  const [members, setMembers] = useState<MemberSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const boot = async () => {
      try {
        const data = await boardApi<{ members: MemberSummary[] }>("/api/board/members");
        if (!cancelled) setMembers(data.members);
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
            A standing set of members who read the same material and see different things in
            it. You bring a decision; they advise; you decide.
          </p>
        </div>
        <div className="board-actions">
          <Link href="/board/members" className="btn btn-accent">
            Edit members
          </Link>
        </div>
      </header>

      {error ? (
        <p className="board-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="board-card">
        <h2>Members</h2>
        {members === null && !error ? <p className="sheet-help">Loading members…</p> : null}
        {members?.length === 0 ? (
          <p className="sheet-help">
            No members yet. <Link href="/board/members">Create one</Link>.
          </p>
        ) : null}
        <ul className="board-roster">
          {members?.map((m) => (
            <li key={m.slug}>
              <Link href={`/board/members?m=${m.slug}`} className="board-roster-item">
                <span className="board-member-name">{m.name}</span>
                <span className="board-member-title">{m.title || "No title yet"}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>

      <p className="sheet-help">
        Members can be shaped now. Running a decision through the board comes with the session
        screen.
      </p>
    </section>
  );
}
