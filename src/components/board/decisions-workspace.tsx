"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { boardApi, errorText } from "@/components/board/board-api";
import { DECISION_STATUS, StatusChip } from "@/components/board/decision-card";
import type { DecisionRow, DecisionStatus } from "@/lib/board/types";

type Filter = DecisionStatus | "all";

function day(ms?: number) {
  return ms ? new Date(ms).toLocaleDateString() : "";
}

function clip(text: string, max = 260) {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function DecisionItem({ row }: { row: DecisionRow }) {
  const { decision } = row;
  return (
    <li className="board-decision-row">
      <div className="board-decision-row-head">
        <Link href={`/board/session/${row.id}#decision`} className="board-member-name">
          {row.title}
        </Link>
        <StatusChip status={decision.status} />
      </div>
      <p className="board-member-meta">
        Brought {day(row.createdAt)}
        {decision.decidedAt ? ` · decided ${day(decision.decidedAt)}` : ""}
        {decision.reviewOn ? ` · review on ${decision.reviewOn}` : ""}
        {` · ${row.members.join(", ")}`}
      </p>
      <dl className="board-decision-facts">
        {row.recommendation ? (
          <>
            <dt>Board recommended</dt>
            <dd>{clip(row.recommendation)}</dd>
          </>
        ) : null}
        {decision.choice ? (
          <>
            <dt>You decided</dt>
            <dd>{clip(decision.choice)}</dd>
          </>
        ) : null}
        {decision.outcome ? (
          <>
            <dt>What happened</dt>
            <dd>{clip(decision.outcome)}</dd>
          </>
        ) : null}
      </dl>
    </li>
  );
}

export function DecisionsWorkspace() {
  const [rows, setRows] = useState<DecisionRow[] | null>(null);
  const [handoffDir, setHandoffDir] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const boot = async () => {
      try {
        const data = await boardApi<{ decisions: DecisionRow[]; handoffDir: string }>("/api/board/decisions");
        if (cancelled) return;
        setRows(data.decisions);
        setHandoffDir(data.handoffDir);
      } catch (err) {
        if (!cancelled) setError(errorText(err));
      }
    };
    void boot();
    return () => {
      cancelled = true;
    };
  }, []);

  const loose = rows?.filter((row) => row.looseEnd) ?? [];
  const shown = rows?.filter((row) => filter === "all" || row.decision.status === filter) ?? [];
  const count = (status: Filter) =>
    status === "all" ? (rows?.length ?? 0) : (rows?.filter((r) => r.decision.status === status).length ?? 0);

  return (
    <section className="page-workspace board-workspace">
      <header className="page-workspace-header">
        <div>
          <p className="sheet-kicker">Board</p>
          <h1>Decisions</h1>
          <p className="sheet-help">
            Every decision you have brought to the board, what it recommended, what you did, and how
            it turned out.
          </p>
        </div>
        <div className="board-actions">
          <Link href="/board" className="btn btn-accent">
            Bring a decision
          </Link>
        </div>
      </header>

      {error ? (
        <p className="board-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="board-card" data-section="loose-ends">
        <h2>Loose ends</h2>
        {rows === null ? <p className="sheet-help">Loading…</p> : null}
        {rows !== null && loose.length === 0 ? (
          <p className="sheet-help">Nothing is waiting on you.</p>
        ) : null}
        {loose.length ? (
          <ul className="board-loose">
            {loose.map((row) => (
              <li key={row.id}>
                <Link href={`/board/session/${row.id}#decision`}>{row.title}</Link>
                <span>{row.looseEnd}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="board-card" data-section="all-decisions">
        <h2>All decisions</h2>
        <div className="board-filters" role="group" aria-label="Show">
          {[{ value: "all" as Filter, label: "All" }, ...DECISION_STATUS].map((option) => (
            <button
              key={option.value}
              type="button"
              className={`board-tab${filter === option.value ? " is-active" : ""}`}
              aria-pressed={filter === option.value}
              onClick={() => setFilter(option.value)}
            >
              {option.label} ({count(option.value)})
            </button>
          ))}
        </div>
        {rows !== null && shown.length === 0 ? (
          <p className="sheet-help">
            {rows.length === 0 ? "No decisions yet. Bring one to the board to start the record." : "None with this status."}
          </p>
        ) : null}
        {shown.length ? (
          <ul className="board-decision-list">
            {shown.map((row) => (
              <DecisionItem key={row.id} row={row} />
            ))}
          </ul>
        ) : null}
      </div>

      {handoffDir ? (
        <div className="board-card">
          <h2>Hand-off files</h2>
          <p className="sheet-help">
            One plain file per decision, written once the Chair has reported and rewritten whenever
            you save. Another program can read this folder to pick up what you decided and what is
            still open.
          </p>
          <p className="board-path">
            Folder: <code>{handoffDir}</code>
          </p>
        </div>
      ) : null}
    </section>
  );
}
