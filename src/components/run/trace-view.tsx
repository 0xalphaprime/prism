"use client";

import Link from "next/link";
import { useMemo } from "react";
import { CopyButton } from "@/components/run/copy-button";
import { TraceCellView } from "@/components/run/trace-cell";
import { TraceSpineView } from "@/components/run/trace-spine";
import { buildLiveTrace, buildTrace, slugForTrace, traceToJsonl, traceToPlain } from "@/lib/trace";
import { useGraphStore } from "@/store/graph-store";

function formatWhen(ts: number) {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

function downloadText(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function TraceView() {
  const architectures = useGraphStore((s) => s.architectures);
  const activeId = useGraphStore((s) => s.activeId);
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const selectedRunId = useGraphStore((s) => s.selectedRunId);
  const activeRunId = useGraphStore((s) => s.activeRunId);
  const selectRun = useGraphStore((s) => s.selectRun);
  const lastTalkMutation = useGraphStore((s) => s.lastTalkMutation);

  const active = useMemo(
    () => architectures.find((a) => a.id === activeId) ?? architectures[0],
    [architectures, activeId],
  );

  const selected =
    active?.runs.find((r) => r.id === selectedRunId) ?? active?.runs[0] ?? null;

  const live = !selected || selected.id === activeRunId;

  const trace = useMemo(() => {
    if (!active) return null;
    return live
      ? buildLiveTrace(active, selected, nodes, edges)
      : buildTrace(active, selected);
  }, [active, live, selected, nodes, edges]);

  if (!active || !trace) return null;

  const slug = slugForTrace(active.name);

  return (
    <div className="trace-layout">
      <aside className="trace-rail">
        <p className="sheet-kicker">Runs</p>
        <h2>Trace</h2>
        <p className="sheet-help">
          Graph composes the pathway. This report is the spine plus cells in
          graph order.
        </p>
        <ul className="trace-run-list">
          {active.runs.length === 0 ? (
            <li className="runs-empty">No runs yet — Step or Run all.</li>
          ) : (
            active.runs.map((run) => (
              <li key={run.id}>
                <button
                  type="button"
                  className={`runs-item ${selected?.id === run.id ? "is-active" : ""}`}
                  onClick={() => selectRun(run.id)}
                >
                  <span className="runs-item-title">
                    {run.pathwayLabel ?? active.name}
                  </span>
                  <span className="runs-item-meta">
                    {run.status} · {formatWhen(run.startedAt)}
                  </span>
                  <span className="runs-item-prompt">
                    {run.prompt.trim() || "(empty prompt)"}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      </aside>

      <section className="trace-main">
        <header className="trace-main-header">
          <div>
            <p className="sheet-kicker">
              {live ? "Live" : "Snapshot"} · {trace.status}
            </p>
            <h1>{active.name}</h1>
            <p className="sheet-help">
              {trace.prompt.trim() || "No run intent — set it on Prompt."}
            </p>
            {lastTalkMutation?.summary ? (
              <p className="trace-live-note">{lastTalkMutation.summary}</p>
            ) : null}
            <TraceSpineView spine={trace.spine} />
          </div>
          <div className="trace-main-actions">
            <CopyButton
              label="Copy all"
              text={traceToPlain(trace)}
              className="btn btn-accent"
            />
            <Link href="/" className="btn">
              Back to graph
            </Link>
            <button
              type="button"
              className="btn"
              onClick={() =>
                downloadText(
                  `${slug}.prism.trace.json`,
                  JSON.stringify(trace, null, 2),
                  "application/json",
                )
              }
            >
              Download JSON
            </button>
            <button
              type="button"
              className="btn"
              onClick={() =>
                downloadText(
                  `${slug}.prism.trace.jsonl`,
                  traceToJsonl(trace),
                  "application/x-ndjson",
                )
              }
            >
              Download JSONL
            </button>
          </div>
        </header>

        <div className="trace-cells">
          {trace.cells.length === 0 ? (
            <p className="runs-empty">No executable nodes on this graph.</p>
          ) : (
            trace.cells.map((cell, index) => (
              <TraceCellView key={cell.nodeId} index={index} cell={cell} />
            ))
          )}
        </div>
        {trace.cells.length > 0 ? (
          <div className="trace-main-actions trace-copy-footer">
            <CopyButton
              label="Copy all"
              text={traceToPlain(trace)}
              className="btn btn-accent"
            />
          </div>
        ) : null}
      </section>
    </div>
  );
}
