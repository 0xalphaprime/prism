"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ChannelIntake } from "@/components/nodes/channel-intake";
import {
  channelUsability,
  usabilityLabel,
} from "@/lib/channel-availability";
import {
  CONTEXT_SOURCE_OPTIONS,
  type ContextSourceKind,
} from "@/lib/context-sources";
import { useGraphStore } from "@/store/graph-store";

function isContextKind(value: string | null): value is ContextSourceKind {
  return Boolean(
    value && CONTEXT_SOURCE_OPTIONS.some((o) => o.kind === value),
  );
}

export function ContextWorkspace() {
  const searchParams = useSearchParams();
  const hydrate = useGraphStore((s) => s.hydrate);
  const hydrated = useGraphStore((s) => s.hydrated);
  const architectures = useGraphStore((s) => s.architectures);
  const activeId = useGraphStore((s) => s.activeId);
  const contextCatalog = useGraphStore((s) => s.contextCatalog);
  const attachContextItem = useGraphStore((s) => s.attachContextItem);
  const removeAttachedContext = useGraphStore((s) => s.removeAttachedContext);
  const beginContextPass = useGraphStore((s) => s.beginContextPass);
  const updateSelectedNode = useGraphStore((s) => s.updateSelectedNode);
  const selectNode = useGraphStore((s) => s.selectNode);
  const nodes = useGraphStore((s) => s.nodes);

  const channelParam = searchParams.get("channel");
  const [focusOverride, setFocusOverride] = useState<ContextSourceKind | "all" | null>(
    null,
  );

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  const focusKind: ContextSourceKind | "all" =
    focusOverride ?? (isContextKind(channelParam) ? channelParam : "all");

  const active = useMemo(
    () => architectures.find((a) => a.id === activeId) ?? architectures[0],
    [architectures, activeId],
  );

  const hub = nodes.find((n) => n.data.kind === "context");

  const catalogKinds = useMemo(
    () =>
      CONTEXT_SOURCE_OPTIONS.filter((o) =>
        contextCatalog.enabledKinds.includes(o.kind),
      ),
    [contextCatalog.enabledKinds],
  );

  const visibleKinds = useMemo(() => {
    if (focusKind === "all") return catalogKinds;
    return catalogKinds.filter((o) => o.kind === focusKind);
  }, [catalogKinds, focusKind]);

  if (!hydrated || !active) {
    return (
      <div className="context-workspace">
        <p className="sheet-help">Loading context workspace…</p>
      </div>
    );
  }

  const attached = active.attachedContext;
  const enabledSet = new Set(active.enabledContextKinds);

  return (
    <div className="context-workspace">
      <header className="context-workspace-header">
        <div>
          <p className="sheet-kicker">Context workspace</p>
          <h1>All context for {active.name}</h1>
          <p className="sheet-help">
            Gather upstream material here with room to work — then return to the
            graph. Attachments feed Context Hub on the next run.
          </p>
        </div>
        <div className="sheet-panel-actions">
          <Link href="/context/prefs" className="btn">
            Catalog prefs
          </Link>
          <Link href="/connections" className="btn">
            Connections
          </Link>
        </div>
      </header>

      <section className="context-workspace-hub">
        <div className="context-workspace-hub-copy">
          <h2>Context Hub notes</h2>
          <p className="sheet-help">
            Seed goals / constraints that always ride with the graph.
          </p>
        </div>
        <textarea
          className="context-workspace-hub-input"
          rows={5}
          value={hub?.data.content ?? ""}
          onChange={(e) => {
            if (hub) {
              selectNode(hub.id);
              updateSelectedNode({ content: e.target.value });
            }
          }}
          placeholder="Goal, constraints, seed notes…"
        />
      </section>

      <section className="context-workspace-summary">
        <div className="context-workspace-summary-top">
          <h2>Attached ({attached.length})</h2>
          {attached.length > 0 ? (
            <button
              type="button"
              className="btn"
              onClick={() => {
                attached.forEach((item) => removeAttachedContext(item.id));
              }}
            >
              Clear all
            </button>
          ) : null}
        </div>
        {attached.length === 0 ? (
          <p className="sheet-help">Nothing attached yet — use the channels below.</p>
        ) : (
          <ul className="context-workspace-attached">
            {attached.map((item) => (
              <li key={`${item.id}-${item.attachedAt}`}>
                <span className="context-workspace-attached-kind">{item.kind}</span>
                <div>
                  <strong>{item.title}</strong>
                  <em>
                    {item.subtitle}
                    {item.payload?.text ? " · has text" : ""}
                  </em>
                </div>
                <button
                  type="button"
                  className="btn btn-icon"
                  onClick={() => removeAttachedContext(item.id)}
                  title="Remove"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="context-workspace-filters">
        <button
          type="button"
          className={`btn ${focusKind === "all" ? "btn-accent" : ""}`}
          onClick={() => setFocusOverride("all")}
        >
          All channels
        </button>
        {catalogKinds.map((option) => (
          <button
            key={option.kind}
            type="button"
            className={`btn ${focusKind === option.kind ? "btn-accent" : ""}`}
            onClick={() => setFocusOverride(option.kind)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="context-workspace-grid">
        {visibleKinds.map((option) => {
          const usability = channelUsability(option.kind, active.connections);
          const sourceNodeId = `context-source-${option.kind}`;
          const onGraph = enabledSet.has(option.kind);
          const channelAttached = attached.filter(
            (item) => item.sourceNodeId === sourceNodeId || item.kind === option.kind,
          );

          return (
            <article
              key={option.kind}
              className={`context-workspace-card is-${usability}`}
            >
              <header className="context-workspace-card-header">
                <div>
                  <p className="connection-kind">{option.kind}</p>
                  <h3>{option.label}</h3>
                  <p className="sheet-help">{option.hint}</p>
                </div>
                <div className="context-workspace-card-badges">
                  <span className={`context-kind-avail is-${usability}`}>
                    {usabilityLabel(usability)}
                  </span>
                  {onGraph ? (
                    <span className="context-workspace-on-graph">On graph</span>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-accent"
                      onClick={() =>
                        beginContextPass([
                          ...active.enabledContextKinds,
                          option.kind,
                        ])
                      }
                    >
                      Place on graph
                    </button>
                  )}
                </div>
              </header>

              <ChannelIntake
                sourceNodeId={sourceNodeId}
                meta={option}
                kind={option.kind}
                onAttach={(item) => {
                  if (!onGraph) {
                    beginContextPass([
                      ...active.enabledContextKinds,
                      option.kind,
                    ]);
                  }
                  attachContextItem(item, sourceNodeId);
                }}
              />

              {channelAttached.length > 0 ? (
                <div className="context-attached">
                  <span className="context-attached-label">Attached</span>
                  <div className="context-attached-list">
                    {channelAttached.map((item) => (
                      <button
                        key={`${item.id}-${item.attachedAt}`}
                        type="button"
                        className="context-attached-chip"
                        onClick={() => removeAttachedContext(item.id)}
                        title="Remove"
                      >
                        <span>
                          {item.title}
                          {item.payload?.text ? " · text" : ""}
                        </span>
                        <span aria-hidden>×</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </div>
  );
}
