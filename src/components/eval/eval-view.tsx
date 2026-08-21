"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { CopyButton } from "@/components/run/copy-button";
import {
  experimentToCausalJsonl,
  experimentToCsv,
  experimentToMarkdown,
  experimentToTrainJsonl,
} from "@/lib/eval/report";
import {
  beforeAfterPairs,
  failureClusters,
  questionMatrix,
  summarizeArchitectures,
  winnerLine,
} from "@/lib/eval/stats";
import { buildDecisionNotes } from "@/lib/eval/decision";
import {
  EVAL_ARCHITECTURE_IDS,
  type EvalArchitectureId,
  type EvalSet,
  type ExperimentRecord,
} from "@/lib/eval/types";
import { useGraphStore } from "@/store/graph-store";

type Catalog = {
  sets: Array<EvalSet & { runnable: number; total: number }>;
  architectures: Array<{
    id: EvalArchitectureId;
    name: string;
    description: string;
  }>;
};

type Progress = { total: number; done: number; errors: number; pending: number };

function downloadText(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function fmt(score: number | null | undefined) {
  if (score == null) return "—";
  return score.toFixed(2);
}

export function EvalView() {
  const createFromTemplate = useGraphStore((s) => s.createFromTemplate);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [experiment, setExperiment] = useState<ExperimentRecord | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [evalSetId, setEvalSetId] = useState("prime-leftovers.v1");
  const [archs, setArchs] = useState<EvalArchitectureId[]>([...EVAL_ARCHITECTURE_IDS]);
  const [reps, setReps] = useState(1);
  const [temperature, setTemperature] = useState("0.4");
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openPair, setOpenPair] = useState<string | null>(null);
  const pauseRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const boot = async () => {
      try {
        const catalogRes = await fetch("/api/eval/sets");
        const catalogData = (await catalogRes.json()) as Catalog;
        if (!cancelled) setCatalog(catalogData);
        const listRes = await fetch("/api/eval/experiments");
        const listData = (await listRes.json()) as { experiments?: Array<{ id: string }> };
        const id = listData.experiments?.[0]?.id;
        if (!id || cancelled) return;
        const res = await fetch(`/api/eval/experiments/${id}`);
        const body = (await res.json()) as {
          experiment?: ExperimentRecord;
          progress?: Progress;
        };
        if (!cancelled && body.experiment) {
          setExperiment(body.experiment);
          setProgress(body.progress ?? null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    };
    void boot();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedSet = catalog?.sets.find((s) => s.id === evalSetId);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/eval/experiments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          evalSetId,
          architectureIds: archs,
          reps,
          profile: {
            temperature: Number(temperature) || undefined,
          },
        }),
      });
      const data = (await res.json()) as {
        experiment?: ExperimentRecord;
        progress?: Progress;
        error?: string;
      };
      if (!res.ok || !data.experiment) throw new Error(data.error || "Create failed");
      setExperiment(data.experiment);
      setProgress(data.progress ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const stepOnce = async (id: string) => {
    const res = await fetch(`/api/eval/experiments/${id}/step`, { method: "POST" });
    const data = (await res.json()) as {
      record?: ExperimentRecord;
      stepped?: boolean;
      progress?: Progress;
      error?: string;
    };
    if (!res.ok || !data.record) throw new Error(data.error || "Step failed");
    setExperiment(data.record);
    setProgress(data.progress ?? null);
    return data.stepped !== false && (data.progress?.pending ?? 0) > 0;
  };

  const runAll = async () => {
    if (!experiment) return;
    pauseRef.current = false;
    setRunning(true);
    setError(null);
    try {
      let more = true;
      while (more && !pauseRef.current) {
        more = await stepOnce(experiment.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  const summaries = useMemo(
    () => (experiment ? summarizeArchitectures(experiment) : []),
    [experiment],
  );
  const matrix = useMemo(
    () => (experiment ? questionMatrix(experiment) : []),
    [experiment],
  );
  const clusters = useMemo(
    () => (experiment ? failureClusters(experiment) : []),
    [experiment],
  );
  const pairs = useMemo(
    () => (experiment ? beforeAfterPairs(experiment) : []),
    [experiment],
  );
  const decisions = useMemo(
    () => (experiment ? buildDecisionNotes(experiment) : []),
    [experiment],
  );
  const report = experiment ? experimentToMarkdown(experiment) : "";
  const slug = experiment
    ? experiment.name.replace(/\s+/g, "-").toLowerCase()
    : "experiment";

  const toggleArch = (id: EvalArchitectureId) => {
    setArchs((curr) =>
      curr.includes(id) ? curr.filter((x) => x !== id) : [...curr, id],
    );
  };

  return (
    <div className="page-workspace eval-workspace">
      <header className="page-workspace-header">
        <div>
          <p className="sheet-kicker">Eval Lab</p>
          <h1>Frozen questions × isolated architectures</h1>
          <p className="sheet-help">
            Foundry is the local student. Prism queues the same leftover across
            baseline, teacher refine, and teacher + critic — then scores first
            vs revised. Trace stays the single-run report.
          </p>
        </div>
      </header>

      <section className="eval-card">
        <h2>Queue</h2>
        <div className="eval-form">
          <label>
            Eval set
            <select
              className="architecture-select"
              value={evalSetId}
              onChange={(e) => setEvalSetId(e.target.value)}
            >
              {(catalog?.sets ?? []).map((set) => (
                <option key={set.id} value={set.id}>
                  {set.name} ({set.runnable}/{set.total} runnable)
                </option>
              ))}
            </select>
          </label>
          <label>
            Reps
            <input
              type="number"
              min={1}
              max={8}
              value={reps}
              onChange={(e) => setReps(Number(e.target.value) || 1)}
            />
          </label>
          <label>
            Student temperature
            <input
              value={temperature}
              onChange={(e) => setTemperature(e.target.value)}
            />
          </label>
        </div>
        <fieldset className="eval-arch-picks">
          <legend>Architectures</legend>
          {(catalog?.architectures ?? []).map((arch) => (
            <label key={arch.id} className="eval-check">
              <input
                type="checkbox"
                checked={archs.includes(arch.id)}
                onChange={() => toggleArch(arch.id)}
              />
              <span>
                <strong>{arch.name}</strong>
                <em>{arch.description}</em>
              </span>
            </label>
          ))}
        </fieldset>
        {selectedSet ? (
          <p className="sheet-help">
            Phase 1 scores only items with prompt + gold/bits.{" "}
            {selectedSet.runnable} runnable of {selectedSet.total}. Scaffolds
            stay in the set so the matrix shape is real.
          </p>
        ) : null}
        <div className="eval-actions">
          <button type="button" className="btn btn-accent" onClick={() => void create()} disabled={busy || running}>
            {busy ? "Creating…" : "Create experiment"}
          </button>
          <button
            type="button"
            className="btn btn-accent"
            onClick={() => void runAll()}
            disabled={!experiment || running || progress?.pending === 0}
          >
            {running ? "Running…" : "Run experiment"}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              pauseRef.current = true;
            }}
            disabled={!running}
          >
            Pause after cell
          </button>
        </div>
        {progress ? (
          <p className="sheet-help">
            {progress.done}/{progress.total} cells
            {progress.errors ? ` · ${progress.errors} error` : ""}
            {experiment ? ` · ${experiment.status}` : ""}
          </p>
        ) : null}
        {error ? <p className="eval-error">{error}</p> : null}
      </section>

      {experiment ? (
        <>
          <section className="eval-card">
            <h2>Executive</h2>
            <p>{winnerLine(summaries)}</p>
            <ul className="eval-decision">
              {decisions.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
            <div className="eval-means">
              {summaries.map((s) => (
                <div key={s.architectureId} className="eval-mean">
                  <strong>{s.name}</strong>
                  <span>first {fmt(s.meanFirst)}</span>
                  <span>revised {fmt(s.meanRevised)}</span>
                  <span>lift {fmt(s.meanLift)}</span>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => createFromTemplate(s.architectureId)}
                  >
                    Open architecture
                  </button>
                </div>
              ))}
            </div>
          </section>

          <section className="eval-card">
            <h2>Question matrix</h2>
            <div className="eval-table-wrap">
              <table className="eval-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Split</th>
                    {experiment.architectureIds.map((id) => (
                      <th key={id}>{id.replace("eval-", "")}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {matrix.map((row) => (
                    <tr key={row.itemId}>
                      <td>
                        {row.itemId}
                        <div className="eval-tags">{row.tags.join(" · ")}</div>
                      </td>
                      <td>{row.split}</td>
                      {experiment.architectureIds.map((id) => {
                        const cell = row.byArch[id];
                        return (
                          <td key={id}>
                            {fmt(cell.first)} / {fmt(cell.revised)} / {fmt(cell.lift)}
                            <div className="eval-tags">{cell.status}</div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="eval-card">
            <h2>Failure clusters</h2>
            {clusters.length ? (
              <ul>
                {clusters.map((cluster) => (
                  <li key={cluster.tag}>
                    <strong>{cluster.tag}</strong>{" "}
                    {Object.entries(cluster.byArch)
                      .map(([arch, n]) => `${arch} ${n}`)
                      .join(" · ")}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="sheet-help">No failure tags yet.</p>
            )}
          </section>

          <section className="eval-card">
            <h2>Before / after</h2>
            {pairs.length ? (
              pairs.map((pair) => (
                <article key={pair.cellId} className="eval-pair">
                  <button
                    type="button"
                    className="eval-pair-toggle"
                    onClick={() =>
                      setOpenPair((curr) => (curr === pair.cellId ? null : pair.cellId))
                    }
                  >
                    {pair.itemId} · {pair.architectureId} · lift {fmt(pair.lift)}
                  </button>
                  {openPair === pair.cellId ? (
                    <div className="eval-pair-body">
                      <div>
                        <h3>First · {fmt(pair.firstScore)}</h3>
                        <pre>{pair.first || "(empty)"}</pre>
                      </div>
                      <div>
                        <h3>Revised · {fmt(pair.revisedScore)}</h3>
                        <pre>{pair.revised || "(empty)"}</pre>
                      </div>
                      <Link href="/trace" className="btn">
                        Open Trace
                      </Link>
                    </div>
                  ) : null}
                </article>
              ))
            ) : (
              <p className="sheet-help">
                Revised hops appear after teacher-refine or teacher+critic cells finish.
              </p>
            )}
          </section>

          <section className="eval-card">
            <h2>Export</h2>
            <div className="eval-actions">
              <CopyButton label="Copy report" text={report} />
              <button
                type="button"
                className="btn"
                onClick={() =>
                  downloadText(`${slug}.prism.experiment.md`, report, "text/markdown")
                }
              >
                Download report
              </button>
              <button
                type="button"
                className="btn"
                onClick={() =>
                  downloadText(
                    `${slug}.prism.scores.csv`,
                    experimentToCsv(experiment),
                    "text/csv",
                  )
                }
              >
                CSV matrix
              </button>
              <button
                type="button"
                className="btn"
                onClick={() =>
                  downloadText(
                    `${slug}.prism.experiment.json`,
                    `${JSON.stringify(experiment, null, 2)}\n`,
                    "application/json",
                  )
                }
              >
                Full JSON
              </button>
              <button
                type="button"
                className="btn"
                onClick={() =>
                  downloadText(
                    `${slug}.prism.causal.jsonl`,
                    experimentToCausalJsonl(experiment) || "\n",
                    "application/jsonl",
                  )
                }
              >
                Causal JSONL
              </button>
              <button
                type="button"
                className="btn"
                onClick={() =>
                  downloadText(
                    `${slug}.prism.train.jsonl`,
                    experimentToTrainJsonl(experiment) || "\n",
                    "application/jsonl",
                  )
                }
              >
                Training candidates
              </button>
            </div>
            <p className="sheet-help">
              Held-out never enters the train file. Second-pass Nemo stays out
              of causal. First-pass Hub → Nemo is the SFT row when isolation holds.
            </p>
          </section>
        </>
      ) : null}
    </div>
  );
}
