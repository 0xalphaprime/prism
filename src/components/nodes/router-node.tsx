"use client";

import type { Node, NodeProps } from "@xyflow/react";
import type { PrismNodeData } from "@/lib/types";
import { NodeShell } from "./node-shell";

type RouterNodeType = Node<PrismNodeData, "router">;

export function RouterNode({ data, selected }: NodeProps<RouterNodeType>) {
  return (
    <NodeShell
      kind="router"
      label={data.label}
      subtitle={data.role ?? "Fan-out"}
      status={data.status}
      selected={selected}
    />
  );
}
