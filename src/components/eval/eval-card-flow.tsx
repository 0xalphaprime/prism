"use client";

import Link from "next/link";
import {
  beforeAfterPairs,
  failureClusters,
  summarizeArchitectures,
  winnerLine,
} from "@/lib/eval/stats";
import { buildDecisionNotes } from "@/lib/eval/decision";
import type {
  EvalArchitectureId,
  EvalItem,
  ExperimentRecord,
} from "@/lib/eval/types";

function fmt(score: number | null | undefined) {
  if (score == null) return "—";
  return score.toFixed(2);
}

export function EvalCardFlow({
  focused,
  item,
  live,
  onOpenArchitecture,
}: {
  focused: ExperimentRecord;
  item?: EvalItem;
  live?: boolean;
  onOpenArchitecture?: (id: EvalArchitectureId) => void;
}) {
  const itemId = focused.cells[0]?.itemId;
  const summaries = summarizeArchitectures(focused);
  const clusters = failureClusters(focused);
  const pairs = beforeAfterPairs(focused);
  const decisions = buildDecisionNotes(focused);

  return (
    <>
      <section className="eval-card">
        <h2>Current card</h2>
        <p className="eval-card-id">{itemId ?? "—"}</p>
        <p className="eval-flow-prompt">{item?.prompt?.trim() || "No prompt on this leftover."}</p>
      </section>

      <section className="eval-card">
        <h2>Through architectures</h2>
        <p>{winnerLine(summaries)}</p>
        {decisions.length ? (
          <ul className="eval-decision">
            {decisions.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        ) : null}
        <div className="eval-flow">
          {focused.architectureIds.map((architectureId) => {
            const cell = focused.cells.find(
              (c) => c.architectureId === architectureId && c.rep === 1,
            );
            const summary = summaries.find((s) => s.architectureId === architectureId);
            return (
              <article key={architectureId} className="eval-flow-col">
                <strong>{summary?.name ?? architectureId}</strong>
                <span>first {fmt(cell?.firstPass.score)}</span>
                <span>revised {fmt(cell?.revised?.score)}</span>
                <span>lift {fmt(cell?.lift)}</span>
                <span className="eval-tags">{cell?.status ?? "idle"}</span>
                {cell?.firstPass.output ? (
                  <pre className="eval-flow-hop">{cell.firstPass.output}</pre>
                ) : (
                  <p className="sheet-help">Waiting on first hop.</p>
                )}
                {cell?.revised?.output ? (
                  <pre className="eval-flow-hop">{cell.revised.output}</pre>
                ) : architectureId !== "eval-baseline" ? (
                  <p className="sheet-help">Revised hop not in yet.</p>
                ) : null}
                {live && onOpenArchitecture ? (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => onOpenArchitecture(architectureId)}
                  >
                    Open architecture
                  </button>
                ) : null}
              </article>
            );
          })}
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

      {pairs.length ? (
        <section className="eval-card">
          <h2>Before / after</h2>
          {pairs.map((pair) => (
            <article key={pair.cellId} className="eval-pair">
              <div className="eval-pair-body">
                <div>
                  <h3>
                    {pair.architectureId} · first · {fmt(pair.firstScore)}
                  </h3>
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
            </article>
          ))}
        </section>
      ) : null}
    </>
  );
}
