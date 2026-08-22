"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { useMemo } from "react";
import { ContextCountFooter } from "@/components/nodes/context-count-footer";
import { CONTEXT_SOURCE_OPTIONS } from "@/lib/context-sources";
import type { PrismNodeData } from "@/lib/types";
import { useGraphStore } from "@/store/graph-store";

type ContextNodeType = Node<PrismNodeData, "context">;

/** Main context aggregator — fed by upstream context-source tiles */
export function ContextNode({ data, selected }: NodeProps<ContextNodeType>) {
  const architectures = useGraphStore((s) => s.architectures);
  const activeId = useGraphStore((s) => s.activeId);

  const active = useMemo(
    () => architectures.find((a) => a.id === activeId),
    [architectures, activeId],
  );

  const attached = active?.attachedContext ?? [];
  const count = attached.length;
  const enabled = active?.enabledContextKinds ?? [];
  const channels = enabled
    .map((kind) => CONTEXT_SOURCE_OPTIONS.find((o) => o.kind === kind)?.label ?? kind)
    .join(" · ");

  return (
    <div
      className={`prism-node tone-context context-hub context-hub-compact ${selected ? "is-selected" : ""} ${count > 0 ? "has-context" : ""}`}
    >
      <Handle type="target" position={Position.Top} className="prism-handle" />
      <Handle type="source" position={Position.Bottom} className="prism-handle" />
      <div className="prism-node-top">
        <span className="prism-node-kind">context hub</span>
        <span className={`prism-status status-${data.status}`}>{data.status}</span>
      </div>
      <h3 className="prism-node-label">{data.label || "Context Hub"}</h3>
      <p className="prism-node-sub">
        {channels
          ? `Merges ${channels}`
          : data.content?.trim().slice(0, 72) ||
            "Upstream channels feed into the router"}
      </p>

      <ContextCountFooter
        count={count}
        href="/context"
        empty="Nothing attached yet — open the pack to gather context."
      >
        {attached.map((item) => (
          <li key={`${item.id}-${item.attachedAt}`}>
            <span>
              {CONTEXT_SOURCE_OPTIONS.find((o) => o.kind === item.kind)?.label ??
                item.kind}
              : {item.title}
            </span>
            {item.payload?.text ? <em>text</em> : null}
          </li>
        ))}
      </ContextCountFooter>
    </div>
  );
}
