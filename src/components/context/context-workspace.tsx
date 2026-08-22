"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AirtableIntake } from "@/components/context/airtable-intake";
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

const PRIMARY_KINDS: ContextSourceKind[] = ["notes", "documents", "urls"];

function isContextKind(value: string | null): value is ContextSourceKind {
  return Boolean(
    value && CONTEXT_SOURCE_OPTIONS.some((o) => o.kind === value),
  );
}

function attachmentSourceLabel(item: {
  kind: string;
  subtitle?: string;
  payload?: { meta?: Record<string, string> };
}) {
  if (item.payload?.meta?.source === "airtable" || item.subtitle?.startsWith("Airtable")) {
    return "Airtable";
  }
  return item.kind;
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
  const applyFeedProbes = useGraphStore((s) => s.applyFeedProbes);
  const nodes = useGraphStore((s) => s.nodes);

  const channelParam = searchParams.get("channel");
  const [focusOverride, setFocusOverride] = useState<ContextSourceKind | "all" | null>(
    null,
  );
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    void fetch("/api/connections/probe")
      .then(async (res) => {
        const data = (await res.json()) as {
          feeds?: Array<{
            id: string;
            label: string;
            ok: boolean;
            status: string;
            detail?: string;
          }>;
        };
        if (!cancelled && data.feeds) applyFeedProbes(data.feeds);
      })
      .catch(() => {
        /* probe is best-effort; picker still offers Verify now */
      });
    return () => {
      cancelled = true;
    };
  }, [hydrated, applyFeedProbes]);

  const focusKind: ContextSourceKind | "all" =
    focusOverride ?? (isContextKind(channelParam) ? channelParam : "all");

  useEffect(() => {
    if (isContextKind(channelParam) && !PRIMARY_KINDS.includes(channelParam)) {
      setMoreOpen(true);
    }
  }, [channelParam]);

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

  const moreKinds = useMemo(
    () => catalogKinds.filter((o) => !PRIMARY_KINDS.includes(o.kind)),
    [catalogKinds],
  );

  const visibleMore = useMemo(() => {
    if (focusKind === "all") return moreKinds;
    return moreKinds.filter((o) => o.kind === focusKind);
  }, [moreKinds, focusKind]);

  if (!hydrated || !active) {
    return (
      <div className="context-workspace">
        <p className="sheet-help">Loading context workspace…</p>
      </div>
    );
  }

  const attached = active.attachedContext;
  const enabledSet = new Set(active.enabledContextKinds);

  function placeAndAttach(
    kind: ContextSourceKind,
    sourceNodeId: string,
    item: Parameters<typeof attachContextItem>[0],
  ) {
    if (!enabledSet.has(kind)) {
      beginContextPass([...active.enabledContextKinds, kind]);
    }
    attachContextItem(item, sourceNodeId);
  }

  return (
    <div className="context-workspace">
      <header className="context-workspace-header">
        <div>
          <p className="sheet-kicker">Context workspace</p>
          <h1>This run’s pack</h1>
          <p className="sheet-help">
            Hub packs notes and attachments on the next Step / Run all. Add
            Airtable records here — do not hunt for a Knowledge card.
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
          <h2>Hub notes</h2>
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
          <p className="sheet-help">
            Nothing attached yet — add a note, file, URL, or Airtable records
            below. Hub packs this on the next Step / Run all.
          </p>
        ) : (
          <ul className="context-workspace-attached">
            {attached.map((item) => (
              <li key={`${item.id}-${item.attachedAt}`}>
                <span className="context-workspace-attached-kind">
                  {attachmentSourceLabel(item)}
                </span>
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

      <section className="context-workspace-add">
        <h2>Add</h2>
        <div className="context-workspace-add-grid">
          {PRIMARY_KINDS.map((kind) => {
            const option = CONTEXT_SOURCE_OPTIONS.find((o) => o.kind === kind);
            if (!option) return null;
            const sourceNodeId = `context-source-${option.kind}`;
            return (
              <article key={option.kind} className="context-workspace-card">
                <header className="context-workspace-card-header">
                  <div>
                    <p className="connection-kind">{option.kind}</p>
                    <h3>{option.label}</h3>
                    <p className="sheet-help">{option.hint}</p>
                  </div>
                </header>
                <ChannelIntake
                  sourceNodeId={sourceNodeId}
                  meta={option}
                  kind={option.kind}
                  onAttach={(item) =>
                    placeAndAttach(option.kind, sourceNodeId, item)
                  }
                />
              </article>
            );
          })}
          <article className="context-workspace-card is-airtable">
            <header className="context-workspace-card-header">
              <div>
                <p className="connection-kind">airtable</p>
                <h3>Airtable</h3>
                <p className="sheet-help">
                  Pick a base and table, then add records to this run.
                </p>
              </div>
            </header>
            <AirtableIntake
              onAttach={(item) =>
                placeAndAttach("knowledge", "context-source-knowledge", item)
              }
            />
          </article>
        </div>
      </section>

      <details
        className="context-workspace-more"
        open={moreOpen}
        onToggle={(e) => setMoreOpen(e.currentTarget.open)}
      >
        <summary>More channels</summary>
        <div className="context-workspace-filters">
          <button
            type="button"
            className={`btn ${focusKind === "all" ? "btn-accent" : ""}`}
            onClick={() => setFocusOverride("all")}
          >
            All
          </button>
          {moreKinds.map((option) => (
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
          {visibleMore.map((option) => {
            const usability = channelUsability(option.kind, active.connections);
            const sourceNodeId = `context-source-${option.kind}`;
            const onGraph = enabledSet.has(option.kind);
            const channelAttached = attached.filter(
              (item) =>
                item.sourceNodeId === sourceNodeId || item.kind === option.kind,
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
                    placeAndAttach(option.kind, sourceNodeId, item);
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
      </details>
    </div>
  );
}
