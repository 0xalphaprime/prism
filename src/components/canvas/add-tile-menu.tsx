"use client";

import { useMemo, useState } from "react";
import {
  CONTEXT_SOURCE_OPTIONS,
  type ContextSourceKind,
} from "@/lib/context-sources";
import type { NodeKind } from "@/lib/types";
import { useGraphStore } from "@/store/graph-store";

type PathwayKind = Exclude<NodeKind, "context-source">;

const PATHWAY_OPTIONS: Array<{ kind: PathwayKind; label: string; hint: string }> =
  [
    { kind: "agent", label: "Agent", hint: "Specialist proposer / worker" },
    { kind: "router", label: "Split", hint: "Fan-out router" },
    { kind: "merge", label: "Judge", hint: "Synthesizer / aggregator" },
    { kind: "context", label: "Context Hub", hint: "Extra hub (advanced)" },
  ];

/** Place pathway or context-channel tiles on the graph. */
export function AddTileMenu() {
  const [open, setOpen] = useState(false);
  const contextCatalog = useGraphStore((s) => s.contextCatalog);
  const addNode = useGraphStore((s) => s.addNode);

  const channels = useMemo(
    () =>
      CONTEXT_SOURCE_OPTIONS.filter((o) =>
        contextCatalog.enabledKinds.includes(o.kind),
      ),
    [contextCatalog.enabledKinds],
  );

  function addPathway(kind: PathwayKind) {
    addNode(kind);
    setOpen(false);
  }

  function addChannel(kind: ContextSourceKind) {
    addNode("context-source", { sourceKind: kind });
    setOpen(false);
  }

  return (
    <div className={`add-tile-menu ${open ? "is-open" : ""}`}>
      <button
        type="button"
        className="add-tile-fab"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title="Add a tile to the graph"
      >
        <span className="add-tile-fab-icon" aria-hidden>
          +
        </span>
        <span className="add-tile-fab-label">Add tile</span>
      </button>

      {open ? (
        <div className="add-tile-panel">
          <header className="add-tile-header">
            <h2>Add tile</h2>
            <p>Place a node, then Expand to edit attributes. Drag handles to wire.</p>
          </header>

          <section className="add-tile-section">
            <h3>Pathway</h3>
            <div className="add-tile-grid">
              {PATHWAY_OPTIONS.map((opt) => (
                <button
                  key={opt.kind}
                  type="button"
                  className="add-tile-option"
                  onClick={() => addPathway(opt.kind)}
                >
                  <strong>{opt.label}</strong>
                  <span>{opt.hint}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="add-tile-section">
            <h3>Context channel</h3>
            <p className="add-tile-note">
              Defaults to Context Hub; drag a handle for late inject downstream.
            </p>
            <div className="add-tile-grid">
              {channels.map((opt) => (
                <button
                  key={opt.kind}
                  type="button"
                  className="add-tile-option"
                  onClick={() => addChannel(opt.kind)}
                >
                  <strong>{opt.label}</strong>
                  <span>{opt.hint}</span>
                </button>
              ))}
            </div>
          </section>

          <button
            type="button"
            className="btn"
            onClick={() => setOpen(false)}
          >
            Close
          </button>
        </div>
      ) : null}
    </div>
  );
}
