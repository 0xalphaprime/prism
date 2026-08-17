"use client";

import { useMemo, useState } from "react";
import {
  CONTEXT_SOURCE_OPTIONS,
  type ContextSourceKind,
} from "@/lib/context-sources";
import type { NodePreset } from "@/lib/node-presets";
import type { NodeKind } from "@/lib/types";
import { useGraphStore } from "@/store/graph-store";

type PathwayKind = Exclude<NodeKind, "context-source">;

const PATHWAY_OPTIONS: Array<{ kind: PathwayKind; label: string; hint: string }> =
  [
    { kind: "agent", label: "Agent", hint: "Blank specialist" },
    { kind: "router", label: "Split", hint: "Blank fan-out router" },
    { kind: "merge", label: "Judge", hint: "Blank synthesizer" },
    { kind: "context", label: "Context Hub", hint: "Extra hub (advanced)" },
  ];

const KIND_HINT: Record<NodePreset["kind"], string> = {
  agent: "Agent",
  router: "Split",
  merge: "Judge",
};

/** Place pathway, presets, or context-channel tiles on the graph. */
export function AddTileMenu() {
  const [open, setOpen] = useState(false);
  const contextCatalog = useGraphStore((s) => s.contextCatalog);
  const nodePresets = useGraphStore((s) => s.nodePresets);
  const addNode = useGraphStore((s) => s.addNode);
  const addNodeFromPreset = useGraphStore((s) => s.addNodeFromPreset);
  const deleteNodePreset = useGraphStore((s) => s.deleteNodePreset);

  const channels = useMemo(
    () =>
      CONTEXT_SOURCE_OPTIONS.filter((o) =>
        contextCatalog.enabledKinds.includes(o.kind),
      ),
    [contextCatalog.enabledKinds],
  );

  const presetsByKind = useMemo(() => {
    const groups: Record<NodePreset["kind"], NodePreset[]> = {
      router: [],
      agent: [],
      merge: [],
    };
    for (const p of nodePresets) {
      groups[p.kind].push(p);
    }
    return groups;
  }, [nodePresets]);

  function addPathway(kind: PathwayKind) {
    addNode(kind);
    setOpen(false);
  }

  function addChannel(kind: ContextSourceKind) {
    addNode("context-source", { sourceKind: kind });
    setOpen(false);
  }

  function placePreset(id: string) {
    addNodeFromPreset(id);
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
            <p>
              Blank kinds, role presets, or context channels. Expand to edit;
              drag handles to wire.
            </p>
          </header>

          <section className="add-tile-section">
            <h3>Pathway (blank)</h3>
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
            <h3>Presets</h3>
            <p className="add-tile-note">
              Role packs (Role / Steer / Prompt / Model / Controls). Save more
              from Expand.
            </p>
            {(["router", "agent", "merge"] as const).map((kind) => {
              const list = presetsByKind[kind];
              if (!list.length) return null;
              return (
                <div key={kind} className="add-tile-preset-group">
                  <h4 className="add-tile-preset-kind">{KIND_HINT[kind]}</h4>
                  <div className="add-tile-grid">
                    {list.map((preset) => (
                      <div key={preset.id} className="add-tile-preset-row">
                        <button
                          type="button"
                          className="add-tile-option"
                          onClick={() => placePreset(preset.id)}
                        >
                          <strong>{preset.name}</strong>
                          <span>
                            {preset.data.role?.slice(0, 72) ||
                              preset.data.steer?.slice(0, 72) ||
                              KIND_HINT[kind]}
                            {preset.builtIn ? " · built-in" : ""}
                          </span>
                        </button>
                        {!preset.builtIn ? (
                          <button
                            type="button"
                            className="add-tile-preset-delete"
                            title="Delete user preset"
                            onClick={() => deleteNodePreset(preset.id)}
                          >
                            ×
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
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
