"use client";

import Link from "next/link";
import { useState } from "react";
import { CopyButton } from "@/components/run/copy-button";
import { modelLabel } from "@/lib/providers";
import type { TraceCell } from "@/lib/trace";

function metricsLine(cell: TraceCell) {
  const m = cell.metrics;
  if (!m) return "—";
  const parts: string[] = [];
  if (m.latencyMs != null) parts.push(`${m.latencyMs} ms`);
  if (m.tokensIn != null || m.tokensOut != null) {
    parts.push(`${m.tokensIn ?? 0}→${m.tokensOut ?? 0} tok`);
  }
  if (m.costUsd != null) parts.push(`$${m.costUsd.toFixed(4)}`);
  const line = parts.join(" · ") || "—";
  if (cell.reasoning?.trim() && (m.tokensOut ?? 0) > 0) {
    return `${line} · tokens may include think`;
  }
  return line;
}

export function TraceCellView({
  cell,
  index,
}: {
  cell: TraceCell;
  index: number;
}) {
  const [open, setOpen] = useState(false);
  const waiting = cell.status === "idle" || cell.status === "ready";
  const body =
    cell.status === "running"
      ? "Running…"
      : waiting
        ? "(waiting)"
        : cell.output?.trim() || "(empty)";

  return (
    <article className={`trace-cell status-${cell.status}`}>
      <header className="trace-cell-head">
        <div className="trace-cell-identity">
          <span className="trace-cell-step">{index + 1}</span>
          <div>
            <h3>{cell.label}</h3>
            <p className="trace-cell-meta">
              {cell.kind}
              {cell.model ? ` · ${modelLabel(String(cell.model))}` : ""}
            </p>
          </div>
        </div>
        <span className={`trace-cell-status status-${cell.status}`}>
          {cell.status}
        </span>
      </header>

      <pre className="trace-cell-output">{body}</pre>

      <div className="trace-cell-actions">
        <button
          type="button"
          className="btn"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Hide exhaust" : "Expand exhaust"}
        </button>
        {cell.output?.trim() ? (
          <CopyButton label="Copy output" text={cell.output} />
        ) : null}
        <Link href={`/node/${cell.nodeId}`} className="btn">
          Expand tile
        </Link>
        {cell.output ? (
          <Link href={`/node/${cell.nodeId}/output`} className="btn">
            Open output
          </Link>
        ) : null}
      </div>

      {open ? (
        <dl className="trace-exhaust">
          <div>
            <dt>Role</dt>
            <dd>{cell.role?.trim() || "—"}</dd>
          </div>
          <div>
            <dt>Steer</dt>
            <dd>{cell.steer?.trim() || "—"}</dd>
          </div>
          <div>
            <dt>Node prompt</dt>
            <dd>{cell.nodePrompt?.trim() || "—"}</dd>
          </div>
          <div>
            <dt>Model</dt>
            <dd>{cell.model ? modelLabel(String(cell.model)) : "—"}</dd>
          </div>
          <div>
            <dt>Metrics</dt>
            <dd>{metricsLine(cell)}</dd>
          </div>
          {typeof cell.step === "number" && cell.step !== index ? (
            <div>
              <dt>Completed</dt>
              <dd>finished as step {cell.step + 1}</dd>
            </div>
          ) : null}
          {cell.ingest ? (
            <div>
              <dt>
                Ingest
                {cell.ingest.temperature != null
                  ? ` · temp ${cell.ingest.temperature}`
                  : ""}
                {cell.ingest.upstreamIds?.length
                  ? ` · up ${cell.ingest.upstreamIds.join(", ")}`
                  : ""}
              </dt>
              <dd>
                {cell.ingest.messages.map((msg, i) => (
                  <pre key={`${msg.role}-${i}`} className="trace-ingest-msg">
                    <span className="trace-ingest-role">{msg.role}</span>
                    {msg.content}
                  </pre>
                ))}
              </dd>
            </div>
          ) : null}
          {cell.reasoning?.trim() ? (
            <div>
              <dt>Reasoning</dt>
              <dd>
                <pre className="trace-ingest-msg">{cell.reasoning}</pre>
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}
    </article>
  );
}
