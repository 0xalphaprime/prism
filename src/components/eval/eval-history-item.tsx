"use client";

import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";
import { EvalCardFlow } from "@/components/eval/eval-card-flow";
import { experimentItemIds, focusExperiment } from "@/lib/eval/focus";
import type { EvalItem, EvalSet, ExperimentRecord } from "@/lib/eval/types";

export function EvalHistoryItem({
  experimentId,
  searchParams,
}: {
  experimentId: string;
  searchParams: Promise<{ item?: string }>;
}) {
  const params = use(searchParams);
  const [experiment, setExperiment] = useState<ExperimentRecord | null>(null);
  const [items, setItems] = useState<EvalItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const boot = async () => {
      try {
        const [expRes, setRes] = await Promise.all([
          fetch(`/api/eval/experiments/${experimentId}`),
          fetch("/api/eval/sets"),
        ]);
        const expBody = (await expRes.json()) as {
          experiment?: ExperimentRecord;
          error?: string;
        };
        const setBody = (await setRes.json()) as {
          sets?: Array<EvalSet & { runnable: number; total: number }>;
        };
        if (!expRes.ok || !expBody.experiment) {
          throw new Error(expBody.error || "Experiment not found");
        }
        if (!cancelled) {
          setExperiment(expBody.experiment);
          const set = setBody.sets?.find((s) => s.id === expBody.experiment?.evalSetId);
          setItems(set?.items ?? []);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    };
    void boot();
    return () => {
      cancelled = true;
    };
  }, [experimentId]);

  const itemId = params.item || experiment?.cells[0]?.itemId;
  const queuedIds = experiment ? experimentItemIds(experiment) : [];
  const focused = useMemo(() => {
    if (!experiment || !itemId) return null;
    return focusExperiment(experiment, itemId);
  }, [experiment, itemId]);
  const item = items.find((row) => row.id === itemId);
  const itemIndex = itemId ? queuedIds.indexOf(itemId) : -1;
  const prevId = itemIndex > 0 ? queuedIds[itemIndex - 1] : undefined;
  const nextId =
    itemIndex >= 0 && itemIndex < queuedIds.length - 1
      ? queuedIds[itemIndex + 1]
      : undefined;

  return (
    <div className="page-workspace eval-workspace">
      <header className="page-workspace-header">
        <div>
          <p className="sheet-kicker">Eval history</p>
          <h1>{itemId ?? "Eval card"}</h1>
          <p className="sheet-help">
            Read-only. Copy all output includes hops and exhaust. The live
            run stays on Eval.
          </p>
        </div>
        <div className="eval-header-actions">
          {prevId ? (
            <Link
              href={`/eval/history/${experimentId}?item=${encodeURIComponent(prevId)}`}
              className="btn"
            >
              Previous card
            </Link>
          ) : null}
          {nextId ? (
            <Link
              href={`/eval/history/${experimentId}?item=${encodeURIComponent(nextId)}`}
              className="btn"
            >
              Next card
            </Link>
          ) : null}
          <Link href="/eval/history" className="btn">
            All history
          </Link>
        </div>
      </header>
      {error ? <p className="eval-error">{error}</p> : null}
      {focused ? <EvalCardFlow focused={focused} item={item} /> : null}
    </div>
  );
}
