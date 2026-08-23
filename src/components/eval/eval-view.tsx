"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { CopyButton } from "@/components/run/copy-button";
import { EvalCardFlow } from "@/components/eval/eval-card-flow";
import { activeItemId, experimentItemIds, focusExperiment } from "@/lib/eval/focus";
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
  diskCards?: string[];
  architectures: Array<{
    id: EvalArchitectureId;
    name: string;
    description: string;
  }>;
};

type Progress = { total: number; done: number; errors: number; pending: number };

const LIVE_EXPERIMENT_KEY = "prism.eval.liveExperimentId";

function readLiveExperimentId() {
  try {
    return sessionStorage.getItem(LIVE_EXPERIMENT_KEY);
  } catch {
    return null;
  }
}

function writeLiveExperimentId(id: string | null) {
  try {
    if (id) sessionStorage.setItem(LIVE_EXPERIMENT_KEY, id);
    else sessionStorage.removeItem(LIVE_EXPERIMENT_KEY);
  } catch {
    // private mode
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
  const [creating, setCreating] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importText, setImportText] = useState("");
  const [importNote, setImportNote] = useState<string | null>(null);
  const [pendingItemIds, setPendingItemIds] = useState<string[]>([]);
  const [peekItemId, setPeekItemId] = useState<string | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const pauseRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const boot = async () => {
      try {
        const catalogRes = await fetch("/api/eval/sets");
        const catalogData = (await catalogRes.json()) as Catalog;
        if (!cancelled) setCatalog(catalogData);
        const listRes = await fetch("/api/eval/experiments");
        const listData = (await listRes.json()) as {
          experiments?: Array<{ id: string; status: string }>;
        };
        const live = listData.experiments?.find((row) => row.status === "running");
        const sessionId = readLiveExperimentId();
        const id = live?.id ?? sessionId ?? undefined;
        if (!id || cancelled) return;
        const res = await fetch(`/api/eval/experiments/${id}`);
        if (!res.ok) {
          if (!live) writeLiveExperimentId(null);
          return;
        }
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
  const liveItemId = experiment ? activeItemId(experiment) : undefined;
  const queuedIds = experiment ? experimentItemIds(experiment) : [];
  const itemId =
    peekItemId && queuedIds.includes(peekItemId) ? peekItemId : liveItemId;

  useEffect(() => {
    if (experiment?.status === "running") setPeekItemId(null);
  }, [experiment?.status, liveItemId]);
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

  const rememberItem = (id: string) => {
    setPendingItemIds((curr) => (curr.includes(id) ? curr : [...curr, id]));
  };

  const clearQueue = () => {
    setPendingItemIds([]);
    setImportNote(null);
    setError(null);
  };

  const toggleDiskCard = (id: string) => {
    if (pendingItemIds.includes(id)) {
      setPendingItemIds((curr) => curr.filter((row) => row !== id));
      setImportNote(null);
      return;
    }
    void importFromDisk(id);
  };

  const postItem = async (parsed: unknown) => {
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
    if (data.item?.id) rememberItem(data.item.id);
    return data;
  };

  const importFromDisk = async (diskId: string) => {
    if (!diskId || busy) return;
    setBusy(true);
    setError(null);
    setImportNote(null);
    try {
      const data = await postItem({ diskId });
      await refreshCatalog();
      setImportNote(`Queued ${data.item?.id ?? diskId}. Create experiment to run it.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const takeFiles = (files: FileList | File[] | null) => {
    if (!files?.length || busy) return;
    void importFiles(files);
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
      const data = await postItem(parsed);
      await refreshCatalog();
      setImportText("");
      setImportNote(`Imported ${data.item?.id ?? "item"}. Create experiment to run it.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const importFiles = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (!list.length || busy) return;
    setBusy(true);
    setError(null);
    setImportNote(null);
    const ids: string[] = [];
    try {
      for (const file of list) {
        const raw = (await file.text()).trim();
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw) as unknown;
        } catch {
          throw new Error(`${file.name} is not JSON.`);
        }
        const data = await postItem(parsed);
        if (data.item?.id) ids.push(data.item.id);
      }
      await refreshCatalog();
      setImportNote(
        ids.length === 1
          ? `Imported ${ids[0]}. Create experiment to run it.`
          : `Imported ${ids.length} cards. Create experiment to run them in order.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    if (!pendingItemIds.length) {
      setError("Import a signed JSON first — this run is only the cards you upload.");
      return;
    }
    setBusy(true);
    setCreating(true);
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
          itemIds: pendingItemIds,
        }),
      });
      const data = (await res.json()) as {
        experiment?: ExperimentRecord;
        progress?: Progress;
        error?: string;
      };
      if (!res.ok || !data.experiment) throw new Error(data.error || "Create failed");
      writeLiveExperimentId(data.experiment.id);
      setPendingItemIds([]);
      setPeekItemId(null);
      setExperiment(data.experiment);
      setProgress(data.progress ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setCreating(false);
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

  const newQueue = () => {
    pauseRef.current = true;
    writeLiveExperimentId(null);
    setExperiment(null);
    setProgress(null);
    setPendingItemIds([]);
    setPeekItemId(null);
    setError(null);
    setImportNote(null);
  };

  const followingLive = experiment?.status === "running" || running;

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
          <p className="sheet-kicker">Eval mode</p>
          <h1>One question through three architectures</h1>
          <p className="sheet-help">
            Import signed JSON, create the experiment, then run. This page
            stays empty until you start a queue — finished cards live in
            History, and you can copy each card’s output and exhaust from
            there.
          </p>
        </div>
        <div className="eval-header-actions">
          {experiment ? (
            <button type="button" className="btn" onClick={newQueue} disabled={running}>
              New queue
            </button>
          ) : null}
          <Link href="/eval/history" className="btn">
            History
          </Link>
        </div>
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
                    Eval set · {set.runnable}/{set.total} ready
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
              Only cards you add below go into this run, in that order.
              {pendingItemIds.length
                ? ` ${pendingItemIds.length} queued.`
                : " Nothing queued yet."}{" "}
              One card on the floor at a time.
            </p>
          ) : null}
          <div
            className={`eval-import${dropActive ? " is-drop" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDropActive(true);
            }}
            onDragLeave={() => setDropActive(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDropActive(false);
              takeFiles(e.dataTransfer.files);
            }}
          >
            {(catalog?.diskCards ?? []).length ? (
              <div className="eval-disk-cards">
                <p className="eval-import-kicker">
                  Signed Cards: Already on the machine. Click one or more to add
                  them to the experiment.
                </p>
                <div className="eval-card-picks">
                  {(catalog?.diskCards ?? []).map((id) => (
                    <button
                      key={id}
                      type="button"
                      className={pendingItemIds.includes(id) ? "btn btn-accent" : "btn"}
                      disabled={busy}
                      onClick={() => toggleDiskCard(id)}
                    >
                      {id}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="eval-upload">
              <p className="eval-import-kicker">Upload or paste JSON</p>
              <textarea
                className="eval-import-input"
                rows={4}
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                placeholder="Drop .json files here, or paste a signed EvalItem."
                disabled={busy}
              />
              <div className="eval-import-actions">
                <label className="btn eval-file-btn">
                  Choose JSON files
                  <input
                    type="file"
                    className="eval-file-native"
                    accept=".json,application/json,text/plain"
                    multiple
                    disabled={busy}
                    onChange={(e) => {
                      const files = e.target.files;
                      e.target.value = "";
                      takeFiles(files);
                    }}
                  />
                </label>
                <button
                  type="button"
                  className="btn"
                  disabled={busy || !importText.trim()}
                  onClick={() => void importSigned()}
                >
                  Import pasted JSON
                </button>
              </div>
            </div>
            {pendingItemIds.length ? (
              <div className="eval-queue-row">
                <ol className="eval-pending">
                  {pendingItemIds.map((id) => (
                    <li key={id}>{id}</li>
                  ))}
                </ol>
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={clearQueue}
                >
                  Clear queue
                </button>
              </div>
            ) : null}
            {importNote ? <p className="sheet-help">{importNote}</p> : null}
          </div>
          <div className="eval-actions">
            <button
              type="button"
              className="btn btn-accent"
              onClick={() => void create()}
              disabled={busy || !pendingItemIds.length}
            >
              {creating ? "Creating…" : "Create experiment"}
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
          {queuedIds.length > 1 ? (
            <nav className="eval-card-picks" aria-label="Cards in this run">
              {queuedIds.map((id) => (
                <button
                  key={id}
                  type="button"
                  className={id === itemId ? "btn btn-accent" : "btn"}
                  disabled={followingLive}
                  onClick={() => setPeekItemId(id)}
                >
                  {id}
                </button>
              ))}
            </nav>
          ) : null}
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
              This download is the card on this page, not the whole queue.
            </p>
          </section>
        </>
      ) : null}
    </div>
  );
}
