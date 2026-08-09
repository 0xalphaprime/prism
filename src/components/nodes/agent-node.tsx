"use client";

import type { Node, NodeProps } from "@xyflow/react";
import { modelLabel } from "@/lib/providers";
import type { PrismNodeData } from "@/lib/types";
import { NodeShell } from "./node-shell";

type AgentNodeType = Node<PrismNodeData, "agent">;

export function AgentNode({ data, selected }: NodeProps<AgentNodeType>) {
  return (
    <NodeShell
      kind="agent"
      label={data.label}
      subtitle={data.role}
      status={data.status}
      selected={selected}
    >
      <div className="prism-node-meta">
        <span>{data.model ? modelLabel(data.model) : "unassigned"}</span>
      </div>
    </NodeShell>
  );
}
