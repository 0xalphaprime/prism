"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  truncateContextText,
  type ContextLibraryItem,
} from "@/lib/context-sources";
import { connectionStatus } from "@/lib/connections";
import { useGraphStore } from "@/store/graph-store";

type AirtableBase = { id: string; name: string };
type AirtableTable = { id: string; name: string };
type AirtableHit = {
  id: string;
  title: string;
  subtitle?: string;
  excerpt?: string;
  meta?: Record<string, string>;
};

export function AirtableIntake({
  onAttach,
}: {
  onAttach: (item: ContextLibraryItem) => void;
}) {
  const architectures = useGraphStore((s) => s.architectures);
  const activeId = useGraphStore((s) => s.activeId);
  const applyFeedProbes = useGraphStore((s) => s.applyFeedProbes);
  const active = architectures.find((a) => a.id === activeId);
  const airtable = active?.connections.find(
    (c) => c.config.connectionKey === "airtable",
  );
  const connected = airtable
    ? connectionStatus(airtable) === "connected"
    : false;
  const lastError = airtable?.lastError;

  const [verifying, setVerifying] = useState(false);
  const [verifyNote, setVerifyNote] = useState<string | null>(null);
  const [bases, setBases] = useState<AirtableBase[]>([]);
  const [tables, setTables] = useState<AirtableTable[]>([]);
  const [records, setRecords] = useState<AirtableHit[]>([]);
  const [baseId, setBaseId] = useState("");
  const [tableId, setTableId] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tableName = useMemo(
    () => tables.find((t) => t.id === tableId)?.name ?? "",
    [tables, tableId],
  );

  const verify = useCallback(async () => {
    setVerifying(true);
    setVerifyNote(null);
    try {
      const res = await fetch("/api/connections/probe");
      const data = (await res.json()) as {
        feeds?: Array<{
          id: string;
          label: string;
          ok: boolean;
          status: string;
          detail?: string;
        }>;
        error?: string;
      };
      if (data.feeds) applyFeedProbes(data.feeds);
      const hit = data.feeds?.find((f) => f.id === "airtable");
      if (hit?.ok) {
        setVerifyNote(`Connected${hit.detail ? ` · ${hit.detail}` : ""}`);
      } else {
        setVerifyNote(
          hit?.detail || data.error || "Airtable probe failed. Check AIRTABLE_PAT in .env.local.",
        );
      }
    } catch (err) {
      setVerifyNote(err instanceof Error ? err.message : "Verify failed");
    } finally {
      setVerifying(false);
    }
  }, [applyFeedProbes]);

  useEffect(() => {
    if (!connected) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetch("/api/context/airtable")
      .then(async (res) => {
        const data = (await res.json()) as {
          bases?: AirtableBase[];
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok) {
          setError(data.error || "Could not list bases");
          setBases([]);
          return;
        }
        setBases(data.bases ?? []);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not list bases");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [connected]);

  useEffect(() => {
    if (!connected || !baseId) {
      setTables([]);
      setTableId("");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetch(`/api/context/airtable?base=${encodeURIComponent(baseId)}`)
      .then(async (res) => {
        const data = (await res.json()) as {
          tables?: AirtableTable[];
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok) {
          setError(data.error || "Could not list tables");
          setTables([]);
          return;
        }
        setTables(data.tables ?? []);
        setTableId("");
        setRecords([]);
        setSelected(new Set());
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not list tables");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [connected, baseId]);

  useEffect(() => {
    if (!connected || !baseId || !tableId) {
      setRecords([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({
        base: baseId,
        table: tableId,
        tableName,
        q: query.trim(),
      });
      void fetch(`/api/context/airtable?${params}`)
        .then(async (res) => {
          const data = (await res.json()) as {
            items?: AirtableHit[];
            error?: string;
          };
          if (cancelled) return;
          if (!res.ok) {
            setError(data.error || "Could not list records");
            setRecords([]);
            return;
          }
          setRecords(data.items ?? []);
          setSelected(new Set());
        })
        .catch((err) => {
          if (!cancelled) {
            setError(
              err instanceof Error ? err.message : "Could not list records",
            );
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [connected, baseId, tableId, tableName, query]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function addSelected() {
    const hits = records.filter((r) => selected.has(r.id));
    for (const hit of hits) {
      onAttach({
        id: hit.id,
        kind: "knowledge",
        title: hit.title,
        subtitle: hit.subtitle || `Airtable · ${tableName}`,
        importFrom: "api",
        payload: {
          text: hit.excerpt ? truncateContextText(hit.excerpt) : undefined,
          meta: hit.meta,
        },
      });
    }
    setSelected(new Set());
  }

  if (!connected) {
    return (
      <div className="channel-intake nodrag nopan">
        <p className="channel-intake-hint">
          Airtable uses <code>AIRTABLE_PAT</code> in <code>.env.local</code>.
          Verify on this card — you do not need to hunt through Connections.
        </p>
        <button
          type="button"
          className="btn btn-accent channel-attach-btn"
          onClick={() => void verify()}
          disabled={verifying}
        >
          {verifying ? "Verifying…" : "Verify now"}
        </button>
        {verifyNote ? (
          <p
            className={
              verifyNote.startsWith("Connected")
                ? "channel-intake-hint"
                : "channel-intake-error"
            }
          >
            {verifyNote}
          </p>
        ) : lastError ? (
          <p className="channel-intake-error">{lastError}</p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="channel-intake airtable-intake nodrag nopan">
      <label className="field">
        <span>Base</span>
        <select
          value={baseId}
          onChange={(e) => setBaseId(e.target.value)}
          disabled={loading && !bases.length}
        >
          <option value="">Pick a base…</option>
          {bases.map((base) => (
            <option key={base.id} value={base.id}>
              {base.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Table</span>
        <select
          value={tableId}
          onChange={(e) => setTableId(e.target.value)}
          disabled={!baseId}
        >
          <option value="">Pick a table…</option>
          {tables.map((table) => (
            <option key={table.id} value={table.id}>
              {table.name}
            </option>
          ))}
        </select>
      </label>
      {tableId ? (
        <input
          className="context-slash-input"
          value={query}
          placeholder="Filter records…"
          onChange={(e) => setQuery(e.target.value)}
        />
      ) : null}
      {error ? <p className="channel-intake-error">{error}</p> : null}
      {tableId ? (
        <ul className="airtable-record-list">
          {loading ? (
            <li className="channel-intake-hint">Loading records…</li>
          ) : records.length === 0 ? (
            <li className="channel-intake-hint">No records in this slice.</li>
          ) : (
            records.map((hit) => (
              <li key={hit.id}>
                <label className="airtable-record-row">
                  <input
                    type="checkbox"
                    checked={selected.has(hit.id)}
                    onChange={() => toggle(hit.id)}
                  />
                  <span>
                    <strong>{hit.title}</strong>
                    <em>{hit.excerpt?.slice(0, 96) || hit.subtitle}</em>
                  </span>
                </label>
              </li>
            ))
          )}
        </ul>
      ) : (
        <p className="channel-intake-hint">
          Pick a table yourself — Prism will not dump the first table for you.
        </p>
      )}
      <button
        type="button"
        className="btn btn-accent channel-attach-btn"
        disabled={selected.size === 0}
        onClick={addSelected}
      >
        Add to this run{selected.size ? ` (${selected.size})` : ""}
      </button>
    </div>
  );
}
