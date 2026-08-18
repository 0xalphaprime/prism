"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CopyButton } from "@/components/run/copy-button";
import { modelLabel } from "@/lib/providers";
import {
  cellToPlain,
  isLengthClip,
  traceCellDomId,
  type TraceCell,
} from "@/lib/trace";

export type TraceDensity = "scan" | "engineer";

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

function modelLine(cell: TraceCell) {
  const requested = cell.model ? modelLabel(String(cell.model)) : "";
  const served = cell.servedModel?.trim();
  if (served && requested && served !== requested && !requested.includes(served)) {
    return `${requested} → ${served}`;
  }
  return served || requested || "";
}

export function TraceCellView({
  cell,
  index,
  density,
}: {
  cell: TraceCell;
  index: number;
  density: TraceDensity;
}) {
  const [open, setOpen] = useState(density === "engineer");
  useEffect(() => {
    setOpen(density === "engineer");
  }, [density]);

  const waiting = cell.status === "idle" || cell.status === "ready";
  const body =
    cell.status === "running"
      ? "Running…"
      : waiting
        ? "(waiting)"
        : cell.output?.trim() || "(empty)";

  const named = cell.namedIngest ?? cell.ingest?.named;
  const fail = cell.isolation?.ok === false;
  const finishWarn =
    cell.finishReason &&
    (isLengthClip(cell.finishReason) ||
      (cell.finishReason !== "stop" &&
        cell.finishReason !== "end_turn" &&
        cell.finishReason !== "eos"));

  return (
    <article
      id={traceCellDomId(cell.nodeId)}
      className={`trace-cell status-${cell.status}${fail ? " isolation-fail" : ""}`}
    >
      <header className="trace-cell-head">
        <div className="trace-cell-identity">
          <span className="trace-cell-step">{index + 1}</span>
          <div>
            <h3>{cell.label}</h3>
            <p className="trace-cell-meta">
              {cell.kind}
              {modelLine(cell) ? ` · ${modelLine(cell)}` : ""}
            </p>
          </div>
        </div>
        <span className={`trace-cell-status status-${cell.status}`}>
          {cell.status}
        </span>
      </header>

      <div className="trace-cell-chips">
        {cell.isolation?.saw.length ? (
          <span className="trace-chip">
            saw: {cell.isolation.saw.map((s) => s.label).join(", ")}
          </span>
        ) : cell.isolation ? (
          <span className="trace-chip">saw: (none)</span>
        ) : null}
        {fail ? (
          <span className="trace-chip is-fail">isolation fail</span>
        ) : null}
        {cell.truncated ? (
          <span className="trace-chip is-warn">truncated pack</span>
        ) : null}
        {finishWarn ? (
          <span className="trace-chip is-warn">finish: {cell.finishReason}</span>
        ) : null}
        {cell.characteristics?.keep.map((item) => (
          <span key={`keep-${item}`} className="trace-chip is-keep">
            keep: {item}
          </span>
        ))}
        {cell.characteristics?.omit.map((item) => (
          <span key={`omit-${item}`} className="trace-chip">
            omit: {item}
          </span>
        ))}
        {cell.characteristics?.neverSay.map((item) => (
          <span key={`never-${item}`} className="trace-chip is-fail">
            never-say: {item}
          </span>
        ))}
      </div>

      <pre className="trace-cell-output">{body}</pre>

      <p className="trace-cell-metrics">{metricsLine(cell)}</p>

      <div className="trace-cell-actions">
        <button
          type="button"
          className="btn"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Hide exhaust" : "Expand exhaust"}
        </button>
        {cell.output?.trim() ? (
          <CopyButton
            label="Copy output"
            text={cell.output}
            title="Copy this cell’s output"
          />
        ) : null}
        <CopyButton
          label="Copy cell"
          text={cellToPlain(cell, index)}
          title="Copy this hop as attribution text"
        />
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
            <dd>{cell.role?.trim() || named?.role || "—"}</dd>
          </div>
          <div>
            <dt>Steer</dt>
            <dd>{cell.steer?.trim() || named?.steer || "—"}</dd>
          </div>
          <div>
            <dt>Node prompt</dt>
            <dd>{cell.nodePrompt?.trim() || named?.nodePrompt || "—"}</dd>
          </div>
          {named?.runIntent ? (
            <div>
              <dt>Run intent</dt>
              <dd>{named.runIntent}</dd>
            </div>
          ) : null}
          {named?.outputSchema ? (
            <div>
              <dt>Output schema</dt>
              <dd>{named.outputSchema}</dd>
            </div>
          ) : null}
          <div>
            <dt>Requested model</dt>
            <dd>{cell.model ? modelLabel(String(cell.model)) : "—"}</dd>
          </div>
          <div>
            <dt>Served model</dt>
            <dd>{cell.servedModel || "—"}</dd>
          </div>
          {cell.provider ? (
            <div>
              <dt>Provider</dt>
              <dd>{cell.provider}</dd>
            </div>
          ) : null}
          {cell.finishReason ? (
            <div>
              <dt>Finish</dt>
              <dd>{cell.finishReason}</dd>
            </div>
          ) : null}
          <div>
            <dt>Metrics</dt>
            <dd>{metricsLine(cell)}</dd>
          </div>
          {cell.ingestHash ? (
            <div>
              <dt>Ingest hash</dt>
              <dd>{cell.ingestHash}</dd>
            </div>
          ) : null}
          {cell.startedAt ? (
            <div>
              <dt>Call clock</dt>
              <dd>
                {new Date(cell.startedAt).toLocaleString()}
                {cell.finishedAt
                  ? ` → ${new Date(cell.finishedAt).toLocaleString()}`
                  : ""}
              </dd>
            </div>
          ) : null}
          {typeof cell.step === "number" && cell.step !== index ? (
            <div>
              <dt>Completed</dt>
              <dd>finished as step {cell.step + 1}</dd>
            </div>
          ) : null}
          {cell.isolation ? (
            <div>
              <dt>Saw</dt>
              <dd>
                {cell.isolation.saw.length
                  ? cell.isolation.saw.map((s) => s.label).join(", ")
                  : "(none)"}
              </dd>
            </div>
          ) : null}
          {cell.isolation?.notSaw.length ? (
            <div>
              <dt>Not on this cell</dt>
              <dd>{cell.isolation.notSaw.map((s) => s.label).join(", ")}</dd>
            </div>
          ) : null}
          {named?.upstream?.length ? (
            <div>
              <dt>Named upstream</dt>
              <dd>
                {named.upstream.map((u) => `${u.label} (${u.id})`).join(", ")}
              </dd>
            </div>
          ) : null}
          {cell.routePlan?.lanes.length ? (
            <div>
              <dt>Route plan</dt>
              <dd>
                {cell.routePlan.lanes
                  .map(
                    (lane) =>
                      `${lane.nodeId}: ${lane.activate ? "on" : "off"}${
                        lane.brief ? ` — ${lane.brief}` : ""
                      }`,
                  )
                  .join("\n")}
                {cell.routePlan.rationale
                  ? `\n${cell.routePlan.rationale}`
                  : ""}
              </dd>
            </div>
          ) : null}
          {cell.ingest ? (
            <div>
              <dt>
                Ingest messages
                {cell.ingest.temperature != null
                  ? ` · temp ${cell.ingest.temperature}`
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
          {cell.errorDetail ? (
            <div>
              <dt>Error</dt>
              <dd>{cell.errorDetail}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
    </article>
  );
}
