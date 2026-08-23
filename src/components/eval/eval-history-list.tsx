"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type ExperimentRow = {
  id: string;
  name: string;
  status: string;
  createdAt: number;
  updatedAt: number;
  itemIds: string[];
  progress?: { total: number; done: number; errors: number; pending: number };
};

export function EvalHistoryList() {
  const [rows, setRows] = useState<ExperimentRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const boot = async () => {
      try {
        const res = await fetch("/api/eval/experiments");
        const data = (await res.json()) as { experiments?: ExperimentRow[] };
        if (!cancelled) setRows(data.experiments ?? []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    };
    void boot();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="page-workspace eval-workspace">
      <header className="page-workspace-header">
        <div>
          <p className="sheet-kicker">Eval Lab</p>
          <h1>History</h1>
          <p className="sheet-help">
            Past leftovers and finished experiments. The live floor stays on
            Eval.
          </p>
        </div>
        <Link href="/eval" className="btn btn-accent">
          Back to Eval
        </Link>
      </header>

      {error ? <p className="eval-error">{error}</p> : null}

      {rows.length ? (
        rows.map((row) => (
          <section key={row.id} className="eval-card">
            <h2>{row.name}</h2>
            <p className="sheet-help">
              {row.status} · {new Date(row.updatedAt).toLocaleString()}
              {row.progress
                ? ` · ${row.progress.done}/${row.progress.total} cells`
                : ""}
            </p>
            <ul className="eval-history-items">
              {(row.itemIds ?? []).map((itemId) => (
                <li key={itemId}>
                  <Link href={`/eval/history/${row.id}?item=${encodeURIComponent(itemId)}`}>
                    {itemId}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))
      ) : (
        <p className="sheet-help">No experiments on disk yet.</p>
      )}
    </div>
  );
}
