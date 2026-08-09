"use client";

import type { Node, NodeProps } from "@xyflow/react";
import { modelLabel } from "@/lib/providers";
import type { PrismNodeData } from "@/lib/types";
import { NodeShell } from "./node-shell";

type MergeNodeType = Node<PrismNodeData, "merge">;

export function MergeNode({ data, selected }: NodeProps<MergeNodeType>) {
  return (
    <NodeShell
      kind="merge"
      label={data.label}
      subtitle={data.role ?? "Merge / judge"}
      status={data.status}
      selected={selected}
      showSource={false}
    >
      <div className="prism-node-meta">
        <span>{data.model ? modelLabel(data.model) : "unassigned"}</span>
      </div>
    </NodeShell>
  );
}
