"use client";

import { Handle, Position } from "@xyflow/react";
import type { ReactNode } from "react";
import type { NodeKind, RunStatus } from "@/lib/types";

const KIND_TONE: Record<NodeKind, string> = {
  context: "tone-context",
  "context-source": "tone-context",
  agent: "tone-agent",
  router: "tone-router",
  merge: "tone-merge",
};

type NodeShellProps = {
  kind: NodeKind;
  label: string;
  subtitle?: string;
  status: RunStatus;
  selected?: boolean;
  children?: ReactNode;
  showTarget?: boolean;
  showSource?: boolean;
};

export function NodeShell({
  kind,
  label,
  subtitle,
  status,
  selected,
  children,
  showTarget = true,
  showSource = true,
}: NodeShellProps) {
  return (
    <div
      className={`prism-node ${KIND_TONE[kind]} ${selected ? "is-selected" : ""} status-${status}`}
    >
      {showTarget ? (
        <Handle type="target" position={Position.Top} className="prism-handle" />
      ) : null}
      <div className="prism-node-top">
        <span className="prism-node-kind">{kind}</span>
        <span className={`prism-status status-${status}`}>{status}</span>
      </div>
      <h3 className="prism-node-label">{label}</h3>
      {subtitle ? <p className="prism-node-sub">{subtitle}</p> : null}
      {children}
      {showSource ? (
        <Handle type="source" position={Position.Bottom} className="prism-handle" />
      ) : null}
    </div>
  );
}
