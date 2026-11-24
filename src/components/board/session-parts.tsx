"use client";

import type { ReactNode } from "react";
import { modelLabel } from "@/lib/providers";
import type { StepState } from "@/lib/board/types";

const STATUS_LABEL: Record<StepState["status"], string> = {
  idle: "Not started",
  running: "Working",
  done: "Done",
  error: "Failed",
  skipped: "Skipped",
};

export function when(ms?: number) {
  return ms ? new Date(ms).toLocaleString() : "";
}

export function seconds(from?: number, to?: number) {
  if (!from || !to || to < from) return "";
  return `${((to - from) / 1000).toFixed(1)}s`;
}

export function plural(n: number, one: string, many = `${one}s`) {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

export function StepChip({ label, state }: { label: string; state: StepState }) {
  return (
    <span className={`board-step is-${state.status}`} title={state.error ?? STATUS_LABEL[state.status]}>
      {label}
      <em>{STATUS_LABEL[state.status]}</em>
    </span>
  );
}

export function SawList({ state }: { state: StepState }) {
  if (!state.saw?.length) return null;
  return (
    <details className="board-saw">
      <summary>
        What was put in front of the model{state.model ? ` (${modelLabel(state.model)})` : ""}
      </summary>
      <ul>
        {state.saw.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </details>
  );
}

export function StepError({
  state,
  onRetry,
  children,
}: {
  state: StepState;
  onRetry: () => void;
  children?: ReactNode;
}) {
  if (state.status !== "error") return null;
  return (
    <div className="board-error" role="alert">
      <p>{state.error || "This step failed."}</p>
      <div className="board-actions">
        <button type="button" className="btn" onClick={onRetry}>
          Try again
        </button>
        {children}
      </div>
    </div>
  );
}
