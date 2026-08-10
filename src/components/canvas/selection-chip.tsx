"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useGraphStore } from "@/store/graph-store";

/** Floating affordance when a tile is selected — Expand, Delete, clear. */
export function SelectionChip() {
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const selectNode = useGraphStore((s) => s.selectNode);
  const deleteNode = useGraphStore((s) => s.deleteNode);

  const node = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId),
    [nodes, selectedNodeId],
  );

  if (!node) return null;

  const edgeCount = edges.filter(
    (e) => e.source === node.id || e.target === node.id,
  ).length;
  const isSoleHub =
    node.data.kind === "context" &&
    nodes.filter((n) => n.data.kind === "context").length <= 1;

  function onDelete() {
    if (isSoleHub) {
      window.alert("Keep at least one Context Hub on the graph.");
      return;
    }
    const warn =
      edgeCount > 0
        ? `Delete “${node!.data.label}” and its ${edgeCount} edge${edgeCount === 1 ? "" : "s"}?`
        : `Delete “${node!.data.label}”?`;
    if (!window.confirm(warn)) return;
    deleteNode(node!.id);
  }

  return (
    <div className="selection-chip nodrag nopan">
      <div className="selection-chip-copy">
        <span className="selection-chip-kind">{node.data.kind}</span>
        <strong className="selection-chip-label">{node.data.label}</strong>
        <span className="selection-chip-hint">
          Expand to edit attributes · drag handles to rewire
        </span>
      </div>
      <div className="selection-chip-actions">
        <Link href={`/node/${node.id}`} className="btn btn-accent">
          Expand
        </Link>
        <button
          type="button"
          className="btn"
          onClick={onDelete}
          disabled={isSoleHub}
          title={isSoleHub ? "Cannot delete the only Context Hub" : "Delete tile"}
        >
          Delete
        </button>
        <button
          type="button"
          className="btn btn-icon"
          onClick={() => selectNode(null)}
          title="Clear selection"
          aria-label="Clear selection"
        >
          ×
        </button>
      </div>
    </div>
  );
}
