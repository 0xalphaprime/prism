"use client";

import { useMemo } from "react";
import { useGraphStore } from "@/store/graph-store";

function formatWhen(ts: number) {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

export function RunsPanel() {
  const architectures = useGraphStore((s) => s.architectures);
  const activeId = useGraphStore((s) => s.activeId);
  const open = useGraphStore((s) => s.runsOpen);
  const setRunsOpen = useGraphStore((s) => s.setRunsOpen);
  const selectedRunId = useGraphStore((s) => s.selectedRunId);
  const selectRun = useGraphStore((s) => s.selectRun);
  const recordRunStub = useGraphStore((s) => s.recordRunStub);

  const active = useMemo(
    () => architectures.find((a) => a.id === activeId) ?? architectures[0],
    [architectures, activeId],
  );

  const selected = active?.runs.find((r) => r.id === selectedRunId) ?? active?.runs[0];

  if (!open || !active) return null;

  return (
    <section className="sheet-panel runs-panel">
      <header className="sheet-panel-header">
        <div>
          <p className="sheet-kicker">Runs</p>
          <h2>Pathway history</h2>
          <p className="sheet-help">
            Every checkpoint keeps prompt, pathway label, and per-node slots so
            you can compare sequences later — and eventually converge on the best
            architecture. Block 3 fills live outputs.
          </p>
        </div>
        <div className="sheet-panel-actions">
          <button type="button" className="btn btn-accent" onClick={() => recordRunStub()}>
            Log checkpoint
          </button>
          <button type="button" className="btn" onClick={() => setRunsOpen(false)}>
            Close
          </button>
        </div>
      </header>

      <div className="runs-layout">
        <ul className="runs-list">
          {active.runs.length === 0 ? (
            <li className="runs-empty">No runs yet — log a checkpoint anytime.</li>
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

        <div className="runs-detail">
          {!selected ? (
            <p className="runs-empty">Select a run to inspect metadata.</p>
          ) : (
            <>
              <h3>Selected run</h3>
              <dl className="runs-meta">
                <div>
                  <dt>Status</dt>
                  <dd>{selected.status}</dd>
                </div>
                <div>
                  <dt>Started</dt>
                  <dd>{formatWhen(selected.startedAt)}</dd>
                </div>
                <div>
                  <dt>Pathway</dt>
                  <dd>{selected.pathwayLabel ?? "—"}</dd>
                </div>
                <div>
                  <dt>Parent</dt>
                  <dd>{selected.parentRunId ?? "—"}</dd>
                </div>
              </dl>
              <label className="field">
                <span>Prompt snapshot</span>
                <textarea rows={4} value={selected.prompt} readOnly />
              </label>
              <h4>Node slots</h4>
              <ul className="runs-nodes">
                {selected.nodeResults.length === 0 ? (
                  <li className="runs-empty">No node results yet.</li>
                ) : (
                  selected.nodeResults.map((node) => (
                    <li key={node.nodeId}>
                      <strong>{node.label}</strong>
                      <span>{node.model ?? "unassigned"}</span>
                      <span>{node.status}</span>
                    </li>
                  ))
                )}
              </ul>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
