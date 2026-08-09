"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { useMemo } from "react";
import { ContextCountFooter } from "@/components/nodes/context-count-footer";
import { CONTEXT_SOURCE_OPTIONS } from "@/lib/context-sources";
import type { PrismNodeData } from "@/lib/types";
import { useGraphStore } from "@/store/graph-store";

type ContextSourceNodeType = Node<PrismNodeData, "context-source">;

export function ContextSourceNode({
  id,
  data,
  selected,
}: NodeProps<ContextSourceNodeType>) {
  const architectures = useGraphStore((s) => s.architectures);
  const activeId = useGraphStore((s) => s.activeId);

  const active = useMemo(
    () => architectures.find((a) => a.id === activeId),
    [architectures, activeId],
  );

  const sourceKind = data.sourceKind;
  const meta = CONTEXT_SOURCE_OPTIONS.find((o) => o.kind === sourceKind);
  const attached = (active?.attachedContext ?? []).filter(
    (item) => item.sourceNodeId === id || (sourceKind && item.kind === sourceKind),
  );
  const count = attached.length;
  const href = sourceKind ? `/context?channel=${sourceKind}` : "/context";

  if (!sourceKind || !meta) {
    return (
      <div className={`prism-node tone-context ${selected ? "is-selected" : ""}`}>
        <Handle type="source" position={Position.Bottom} className="prism-handle" />
        <h3 className="prism-node-label">{data.label}</h3>
      </div>
    );
  }

  return (
    <div
      className={`prism-node tone-context context-source-node context-source-compact ${selected ? "is-selected" : ""} ${count > 0 ? "has-context" : ""}`}
    >
      <Handle type="source" position={Position.Bottom} className="prism-handle" />
      <div className="prism-node-top">
        <span className="prism-node-kind">{sourceKind}</span>
        <span className={`prism-status status-${data.status}`}>{data.status}</span>
      </div>
      <h3 className="prism-node-label">{data.label}</h3>
      <p className="prism-node-sub">{meta.hint}</p>

      <ContextCountFooter
        count={count}
        href={href}
        empty={`No attachments yet — open the workspace to add ${meta.label.toLowerCase()}.`}
      >
        {attached.map((item) => (
          <li key={`${item.id}-${item.attachedAt}`}>
            <span>{item.title}</span>
            {item.payload?.text ? <em>text</em> : null}
          </li>
        ))}
      </ContextCountFooter>
    </div>
  );
}
