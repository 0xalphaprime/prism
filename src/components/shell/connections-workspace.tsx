"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  connectionStatus,
  connectionStatusLabel,
  type PrismConnection,
} from "@/lib/connections";
import { useGraphStore } from "@/store/graph-store";

type ProbeRow = {
  id: string;
  label: string;
  ok: boolean;
  status: string;
  detail?: string;
  latencyMs?: number;
};

function friendlyError(raw?: string) {
  if (!raw) return null;
  if (/bad credentials|401/i.test(raw)) {
    return "Bad credentials — refresh the token in ~/.env, re-sync .env.local, restart, Verify.";
  }
  if (/not wired yet/i.test(raw)) return raw;
  if (raw.length > 140) return `${raw.slice(0, 140)}…`;
  return raw;
}

function ConnectionMeta({ conn }: { conn: PrismConnection }) {
  const envKey = conn.config.envKey;
  const note = conn.config.note;
  return (
    <div className="connection-meta">
      <p className="connection-feeds">
        Feeds: {conn.feeds.join(", ") || "—"}
        {note ? ` · ${note}` : ""}
      </p>
      {envKey ? (
        <code className="connection-envkey" title={envKey}>
          {envKey}
        </code>
      ) : null}
    </div>
  );
}

export function ConnectionsWorkspace() {
  const architectures = useGraphStore((s) => s.architectures);
  const activeId = useGraphStore((s) => s.activeId);
  const updateConnection = useGraphStore((s) => s.updateConnection);
  const applyProviderProbes = useGraphStore((s) => s.applyProviderProbes);
  const applyFeedProbes = useGraphStore((s) => s.applyFeedProbes);

  const [verifying, setVerifying] = useState(false);
  const [verifyNote, setVerifyNote] = useState<string | null>(null);

  const active = useMemo(
    () => architectures.find((a) => a.id === activeId) ?? architectures[0],
    [architectures, activeId],
  );

  const verifyAll = useCallback(async () => {
    setVerifying(true);
    setVerifyNote(null);
    try {
      const [providersRes, feedsRes] = await Promise.all([
        fetch("/api/providers?probe=1"),
        fetch("/api/connections/probe"),
      ]);
      const providersData = (await providersRes.json()) as {
        providers?: ProbeRow[];
        error?: string;
      };
      const feedsData = (await feedsRes.json()) as {
        feeds?: ProbeRow[];
        error?: string;
      };

      if (providersData.providers) applyProviderProbes(providersData.providers);
      if (feedsData.feeds) applyFeedProbes(feedsData.feeds);

      const all = [
        ...(providersData.providers ?? []),
        ...(feedsData.feeds ?? []),
      ];
      const ok = all.filter((p) => p.ok).map((p) => p.label);
      const bad = all.filter((p) => !p.ok);
      const parts = [
        ok.length ? `Connected: ${ok.join(", ")}` : null,
        bad.length
          ? `Needs attention: ${bad
              .map((p) => `${p.label} (${friendlyError(p.detail) ?? p.status})`)
              .join("; ")}`
          : null,
      ].filter(Boolean);
      setVerifyNote(parts.join(" · ") || "No results");
    } catch (error) {
      setVerifyNote(error instanceof Error ? error.message : "Verify failed");
    } finally {
      setVerifying(false);
    }
  }, [applyFeedProbes, applyProviderProbes]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void verifyAll();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [verifyAll]);

  if (!active) return null;

  const providers = active.connections.filter((c) => c.kind === "provider");
  const others = active.connections.filter((c) => c.kind !== "provider");

  return (
    <section className="page-workspace connections-workspace">
      <header className="page-workspace-header">
        <div>
          <p className="sheet-kicker">Connections</p>
          <h1>Upstream feeds for {active.name}</h1>
          <p className="sheet-help">
            Keys live in <code>.env.local</code>. Verify pings model providers and
            context feeds — Connected means the probe worked.
          </p>
          {verifyNote ? <p className="connection-verify-note">{verifyNote}</p> : null}
        </div>
        <div className="sheet-panel-actions">
          <button
            type="button"
            className="btn btn-accent"
            onClick={() => void verifyAll()}
            disabled={verifying}
          >
            {verifying ? "Verifying…" : "Verify all"}
          </button>
        </div>
      </header>

      <h3 className="connection-section-title">Model providers</h3>
      <ul className="connection-list">
        {providers.map((conn) => {
          const status = connectionStatus(conn);
          return (
            <li key={conn.id} className="connection-card">
              <div className="connection-card-top">
                <div className="connection-card-copy">
                  <p className="connection-kind">provider</p>
                  <h3>{conn.label}</h3>
                  <ConnectionMeta conn={conn} />
                </div>
                <div className="connection-status-col">
                  <span
                    className={`connection-status is-${status}`}
                    title={conn.lastError || connectionStatusLabel(status)}
                  >
                    {verifying ? "Checking…" : connectionStatusLabel(status)}
                  </span>
                  <label className="connection-enable">
                    <input
                      type="checkbox"
                      checked={conn.enabled}
                      onChange={(e) =>
                        updateConnection(conn.id, {
                          enabled: e.target.checked,
                          lastError: e.target.checked ? undefined : conn.lastError,
                        })
                      }
                    />
                    Use on this architecture
                  </label>
                </div>
              </div>
              {conn.lastError ? (
                <p className="connection-error">{friendlyError(conn.lastError)}</p>
              ) : conn.lastCheckedAt ? (
                <p className="connection-ok">
                  Verified {new Date(conn.lastCheckedAt).toLocaleTimeString()}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>

      <h3 className="connection-section-title">Context feeds</h3>
      <ul className="connection-list">
        {others.map((conn) => {
          const status = connectionStatus(conn);
          const key = conn.config.connectionKey;
          const envDriven = Boolean(
            key && key !== "browser-mcp" && key !== "skills-mcp",
          );
          return (
            <li key={conn.id} className="connection-card">
              <div className="connection-card-top">
                <div className="connection-card-copy">
                  <p className="connection-kind">{conn.kind}</p>
                  <h3>{conn.label}</h3>
                  <ConnectionMeta conn={conn} />
                </div>
                <div className="connection-status-col">
                  <span
                    className={`connection-status is-${status}`}
                    title={conn.lastError || connectionStatusLabel(status)}
                  >
                    {verifying && envDriven
                      ? "Checking…"
                      : connectionStatusLabel(status)}
                  </span>
                  <label className="connection-enable">
                    <input
                      type="checkbox"
                      checked={conn.enabled}
                      onChange={(e) =>
                        updateConnection(conn.id, {
                          enabled: e.target.checked,
                          lastError: e.target.checked ? undefined : conn.lastError,
                        })
                      }
                    />
                    Use on this architecture
                  </label>
                </div>
              </div>
              {conn.config.connectionKey === "local-files" ? (
                <p className="connection-ok">Browser file picker — always available</p>
              ) : null}
              {conn.lastError ? (
                <p className="connection-error">{friendlyError(conn.lastError)}</p>
              ) : conn.lastCheckedAt ? (
                <p className="connection-ok">
                  Verified {new Date(conn.lastCheckedAt).toLocaleTimeString()}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
