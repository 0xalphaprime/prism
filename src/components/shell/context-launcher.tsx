"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  channelUsability,
  usabilityLabel,
} from "@/lib/channel-availability";
import { CONTEXT_SOURCE_OPTIONS, type ContextSourceKind } from "@/lib/context-sources";
import { useGraphStore } from "@/store/graph-store";

export function ContextLauncher() {
  const architectures = useGraphStore((s) => s.architectures);
  const activeId = useGraphStore((s) => s.activeId);
  const contextCatalog = useGraphStore((s) => s.contextCatalog);
  const contextLauncherOpen = useGraphStore((s) => s.contextLauncherOpen);
  const setContextLauncherOpen = useGraphStore((s) => s.setContextLauncherOpen);
  const beginContextPass = useGraphStore((s) => s.beginContextPass);

  const active = useMemo(
    () => architectures.find((a) => a.id === activeId) ?? architectures[0],
    [architectures, activeId],
  );

  const [draft, setDraft] = useState<ContextSourceKind[]>([]);

  const catalogOptions = useMemo(
    () =>
      CONTEXT_SOURCE_OPTIONS.filter((o) =>
        contextCatalog.enabledKinds.includes(o.kind),
      ),
    [contextCatalog.enabledKinds],
  );

  if (!active) return null;

  const attachedCount = active.attachedContext.length;
  const connections = active.connections;

  function toggle(kind: ContextSourceKind) {
    setDraft((prev) =>
      prev.includes(kind) ? prev.filter((k) => k !== kind) : [...prev, kind],
    );
  }

  function toggleOpen() {
    const next = !contextLauncherOpen;
    if (next) {
      const allowed = new Set(contextCatalog.enabledKinds);
      setDraft(
        (active?.enabledContextKinds ?? []).filter((k) => allowed.has(k)),
      );
    }
    setContextLauncherOpen(next);
  }

  return (
    <div className={`context-launcher ${contextLauncherOpen ? "is-open" : ""}`}>
      <button
        type="button"
        className="context-launcher-fab"
        onClick={toggleOpen}
        aria-expanded={contextLauncherOpen}
        title="Add upstream context channels above Context Hub"
      >
        <span className="context-launcher-icon" aria-hidden>
          +
        </span>
        <span className="context-launcher-label">Add context</span>
        {attachedCount > 0 ? (
          <span className="context-launcher-count">{attachedCount}</span>
        ) : null}
      </button>

      {contextLauncherOpen ? (
        <div className="context-launcher-panel">
          <header className="context-launcher-header">
            <h2>Upstream context</h2>
            <p>
              Choose which channel tiles appear on the graph. Intake happens in the{" "}
              <strong>context workspace</strong> — tiles only show counts.
            </p>
          </header>

          {catalogOptions.length === 0 ? (
            <p className="channel-intake-hint">
              No channels in your catalog.{" "}
              <Link
                href="/context/prefs"
                className="btn btn-accent"
                onClick={() => setContextLauncherOpen(false)}
              >
                Open preferences
              </Link>
            </p>
          ) : (
            <div className="context-kind-grid" role="group" aria-label="Context types">
              {catalogOptions.map((option) => {
                const checked = draft.includes(option.kind);
                const usability = channelUsability(option.kind, connections);
                return (
                  <label
                    key={option.kind}
                    className={`context-kind-chip ${checked ? "is-on" : ""} is-${usability}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(option.kind)}
                    />
                    <span className="context-kind-label">{option.label}</span>
                    <span className="context-kind-hint">{option.hint}</span>
                    <span className={`context-kind-avail is-${usability}`}>
                      {usabilityLabel(usability)}
                    </span>
                    {usability === "needs_connection" ? (
                      <Link
                        href="/connections"
                        className="context-kind-connect"
                        onClick={() => setContextLauncherOpen(false)}
                      >
                        Connect
                      </Link>
                    ) : null}
                  </label>
                );
              })}
            </div>
          )}

          <footer className="context-launcher-footer">
            <Link
              href="/context"
              className="btn btn-accent"
              onClick={() => setContextLauncherOpen(false)}
            >
              Full workspace
            </Link>
            <Link
              href="/context/prefs"
              className="btn"
              onClick={() => setContextLauncherOpen(false)}
            >
              Preferences
            </Link>
            <button
              type="button"
              className="btn"
              onClick={() => setContextLauncherOpen(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={draft.length === 0}
              onClick={() => beginContextPass(draft)}
            >
              Place on graph
            </button>
          </footer>
        </div>
      ) : null}
    </div>
  );
}
