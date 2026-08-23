"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { CopyButton } from "@/components/run/copy-button";
import { EvalCardFlow } from "@/components/eval/eval-card-flow";
import { activeItemId, focusExperiment } from "@/lib/eval/focus";
import {
  experimentToCausalJsonl,
  experimentToCsv,
  experimentToMarkdown,
  experimentToTrainJsonl,
} from "@/lib/eval/report";
import {
  EVAL_ARCHITECTURE_IDS,
  type EvalArchitectureId,
  type EvalItem,
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

function findItem(catalog: Catalog | null, evalSetId: string, itemId?: string): EvalItem | undefined {
  if (!itemId) return undefined;
  return catalog?.sets.find((s) => s.id === evalSetId)?.items.find((row) => row.id === itemId);
}

export function EvalView() {
  const router = useRouter();
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
  const [importText, setImportText] = useState("");
  const [importNote, setImportNote] = useState<string | null>(null);
  const pauseRef = useRef(false);
  const importFileRef = useRef<HTMLInputElement>(null);

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
  const itemId = experiment ? activeItemId(experiment) : undefined;
  const focused = useMemo(() => {
    if (!experiment || !itemId) return null;
    return focusExperiment(experiment, itemId);
  }, [experiment, itemId]);
  const currentItem = findItem(catalog, experiment?.evalSetId ?? evalSetId, itemId);

  const refreshCatalog = async () => {
    const catalogRes = await fetch("/api/eval/sets");
    const catalogData = (await catalogRes.json()) as Catalog;
    setCatalog(catalogData);
  };

  const importSigned = async () => {
    const raw = importText.trim();
    if (!raw || busy) return;
    setBusy(true);
    setError(null);
    setImportNote(null);
    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw) as unknown;
      } catch {
        throw new Error("Paste a signed EvalItem JSON object.");
      }
      const res = await fetch("/api/eval/sets/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      });
      const data = (await res.json()) as {
        error?: string;
        runnable?: number;
        total?: number;
        item?: { id: string };
      };
      if (!res.ok) throw new Error(data.error || "Import failed");
      await refreshCatalog();
      setImportText("");
      setImportNote(
        `Imported ${data.item?.id ?? "item"} · ${data.runnable}/${data.total} runnable`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

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

  const report = focused ? experimentToMarkdown(focused) : "";
  const slug = focused
    ? `${focused.name.replace(/\s+/g, "-").toLowerCase()}-${itemId ?? "card"}`
    : "experiment";

  const toggleArch = (id: EvalArchitectureId) => {
    setArchs((curr) =>
      curr.includes(id) ? curr.filter((x) => x !== id) : [...curr, id],
    );
  };

  const progressLine = progress ? (
    <p className="sheet-help">
      {itemId ? `${itemId} · ` : ""}
      {progress.done}/{progress.total} cells
      {progress.errors ? ` · ${progress.errors} error` : ""}
      {experiment ? ` · ${experiment.status}` : ""}
    </p>
  ) : null;

  return (
    <div className="page-workspace eval-workspace">
      <header className="page-workspace-header">
        <div>
          <p className="sheet-kicker">Eval Lab</p>
          <h1>One leftover through three architectures</h1>
          <p className="sheet-help">
            The floor shows the card that is running. Earlier leftovers stay in
            History. The queue still walks the whole signed set in the background.
          </p>
        </div>
        <Link href="/eval/history" className="btn">
          History
        </Link>
      </header>

      {running ? (
        <section className="eval-card">
          <h2>Running</h2>
          {progressLine}
          <div className="eval-actions">
            <button
              type="button"
              className="btn"
              onClick={() => {
                pauseRef.current = true;
              }}
            >
              Pause after cell
            </button>
          </div>
          {error ? <p className="eval-error">{error}</p> : null}
        </section>
      ) : (
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
              Phase 1 scores only items with prompt + allowedContext.{" "}
              {selectedSet.runnable} runnable of {selectedSet.total}. The lab
              floor still shows one card at a time.
            </p>
          ) : null}
          <div className="eval-import">
            <label>
              Import signed item
              <textarea
                className="eval-import-input"
                rows={6}
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                placeholder="Paste one signed EvalItem JSON (id must already exist in the set)."
                disabled={busy}
              />
            </label>
            <div className="eval-import-actions">
              <input
                ref={importFileRef}
                type="file"
                accept="application/json,.json"
                hidden
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  setImportText(await file.text());
                }}
              />
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => importFileRef.current?.click()}
              >
                Choose file
              </button>
              <button
                type="button"
                className="btn btn-accent"
                disabled={busy || !importText.trim()}
                onClick={() => void importSigned()}
              >
                Import signed item
              </button>
            </div>
            {importNote ? <p className="sheet-help">{importNote}</p> : null}
          </div>
          <div className="eval-actions">
            <button
              type="button"
              className="btn btn-accent"
              onClick={() => void create()}
              disabled={busy}
            >
              {busy ? "Creating…" : "Create experiment"}
            </button>
            <button
              type="button"
              className="btn btn-accent"
              onClick={() => void runAll()}
              disabled={!experiment || progress?.pending === 0}
            >
              Run experiment
            </button>
          </div>
          {progressLine}
          {error ? <p className="eval-error">{error}</p> : null}
        </section>
      )}

      {focused ? (
        <>
          <EvalCardFlow
            focused={focused}
            item={currentItem}
            live
            onOpenArchitecture={(id) => {
              createFromTemplate(id);
              router.push("/");
            }}
          />
          <section className="eval-card">
            <h2>Export this card</h2>
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
                    experimentToCsv(focused),
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
                    `${JSON.stringify(focused, null, 2)}\n`,
                    "application/json",
                  )
                }
              >
                JSON
              </button>
              <button
                type="button"
                className="btn"
                onClick={() =>
                  downloadText(
                    `${slug}.prism.causal.jsonl`,
                    experimentToCausalJsonl(focused) || "\n",
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
                    experimentToTrainJsonl(focused) || "\n",
                    "application/jsonl",
                  )
                }
              >
                Training candidates
              </button>
            </div>
            <p className="sheet-help">
              This download is the leftover on the floor, not the whole queue.
            </p>
          </section>
        </>
      ) : null}
    </div>
  );
}
