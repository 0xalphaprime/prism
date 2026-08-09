"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  channelUsability,
} from "@/lib/channel-availability";
import {
  normalizeUrl,
  truncateContextText,
  type ContextLibraryItem,
  type ContextSourceKind,
  type ContextSourceMeta,
} from "@/lib/context-sources";
import { useGraphStore } from "@/store/graph-store";

type ChannelIntakeProps = {
  sourceNodeId: string;
  meta: ContextSourceMeta;
  kind: ContextSourceKind;
  onAttach: (item: ContextLibraryItem) => void;
};

export function ChannelIntake({
  sourceNodeId,
  meta,
  kind,
  onAttach,
}: ChannelIntakeProps) {
  const architectures = useGraphStore((s) => s.architectures);
  const activeId = useGraphStore((s) => s.activeId);
  const active = architectures.find((a) => a.id === activeId);
  const usability = channelUsability(kind, active?.connections ?? []);

  if (usability === "needs_connection") {
    return (
      <div className="channel-intake nodrag nopan">
        <p className="channel-intake-hint">
          This channel needs a live connection before intake works.
        </p>
        <Link href="/connections" className="btn btn-accent channel-attach-btn">
          Open Connections
        </Link>
      </div>
    );
  }

  if (usability === "stub") {
    return (
      <div className="channel-intake nodrag nopan">
        <p className="channel-intake-hint">
          {meta.label} intake is stubbed for this weekend — catalog it now, wire later.
        </p>
      </div>
    );
  }

  switch (meta.intake) {
    case "attach":
      return (
        <AttachIntake
          kind={kind}
          label={meta.label}
          accept={kind === "images" ? "image/*" : undefined}
          onAttach={onAttach}
        />
      );
    case "folder":
      return <FolderIntake kind={kind} onAttach={onAttach} />;
    case "urls":
      return <UrlIntake kind={kind} onAttach={onAttach} />;
    case "notes":
      return (
        <NotesIntake
          kind={kind}
          sourceNodeId={sourceNodeId}
          onAttach={onAttach}
        />
      );
    case "slash":
    default:
      return <LiveSlashIntake kind={kind} label={meta.label} onAttach={onAttach} />;
  }
}

function AttachIntake({
  kind,
  label,
  accept,
  onAttach,
}: {
  kind: ContextSourceKind;
  label: string;
  accept?: string;
  onAttach: (item: ContextLibraryItem) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="channel-intake nodrag nopan">
      <input
        ref={inputRef}
        type="file"
        className="channel-file-input"
        multiple
        accept={accept}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          files.forEach((file) => {
            onAttach({
              id: `local-${kind}-${file.name}-${file.size}-${file.lastModified}`,
              kind,
              title: file.name,
              subtitle: `${Math.max(1, Math.round(file.size / 1024))} KB · local`,
              importFrom: "local",
              payload: {
                mime: file.type || undefined,
                meta: { size: String(file.size) },
              },
            });
          });
          e.target.value = "";
        }}
      />
      <button
        type="button"
        className="btn btn-accent channel-attach-btn"
        onClick={() => inputRef.current?.click()}
      >
        Attach {label.toLowerCase()}
      </button>
    </div>
  );
}

function FolderIntake({
  kind,
  onAttach,
}: {
  kind: ContextSourceKind;
  onAttach: (item: ContextLibraryItem) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="channel-intake nodrag nopan">
      <input
        ref={inputRef}
        type="file"
        className="channel-file-input"
        // @ts-expect-error webkitdirectory is supported in Chromium
        webkitdirectory=""
        directory=""
        multiple
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (!files.length) return;
          const root =
            files[0]?.webkitRelativePath?.split("/")[0] || "directory";
          onAttach({
            id: `local-dir-${root}-${files.length}-${Date.now()}`,
            kind,
            title: root,
            subtitle: `${files.length} files · local folder`,
            importFrom: "local",
            payload: {
              meta: { fileCount: String(files.length) },
            },
          });
          e.target.value = "";
        }}
      />
      <button
        type="button"
        className="btn btn-accent channel-attach-btn"
        onClick={() => inputRef.current?.click()}
      >
        Attach folder
      </button>
    </div>
  );
}

function UrlIntake({
  kind,
  onAttach,
}: {
  kind: ContextSourceKind;
  onAttach: (item: ContextLibraryItem) => void;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function addUrl() {
    const normalized = normalizeUrl(value);
    if (!normalized) {
      setError("Enter a valid URL");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/context/fetch-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: normalized }),
      });
      const data = (await res.json()) as {
        url?: string;
        text?: string;
        title?: string;
        source?: string;
        error?: string;
      };
      if (!res.ok) {
        setError(data.error || "Fetch failed");
        return;
      }
      let host = normalized;
      try {
        host = new URL(normalized).hostname;
      } catch {
        /* keep */
      }
      onAttach({
        id: `url-${kind}-${normalized}`,
        kind,
        title: data.title?.trim() || normalized,
        subtitle: `${host} · ${data.source ?? "fetch"}`,
        importFrom: "api",
        payload: {
          url: data.url || normalized,
          text: data.text ? truncateContextText(data.text) : undefined,
          meta: { source: data.source ?? "fetch" },
        },
      });
      setValue("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fetch failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="channel-intake nodrag nopan">
      <div className="channel-url-row">
        <input
          className="context-slash-input"
          value={value}
          placeholder="https://…"
          disabled={busy}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void addUrl();
            }
          }}
        />
        <button
          type="button"
          className="btn btn-accent"
          onClick={() => void addUrl()}
          disabled={busy}
        >
          {busy ? "Fetching…" : "Add"}
        </button>
      </div>
      {error ? <p className="channel-intake-error">{error}</p> : null}
      <p className="channel-intake-hint">
        Fetches page text (Firecrawl when connected) into the attachment payload.
      </p>
    </div>
  );
}

function NotesIntake({
  kind,
  sourceNodeId,
  onAttach,
}: {
  kind: ContextSourceKind;
  sourceNodeId: string;
  onAttach: (item: ContextLibraryItem) => void;
}) {
  const [value, setValue] = useState("");

  return (
    <div className="channel-intake nodrag nopan">
      <textarea
        className="channel-notes-input"
        rows={3}
        value={value}
        placeholder="Paste notes, goals, constraints…"
        onChange={(e) => setValue(e.target.value)}
      />
      <button
        type="button"
        className="btn btn-accent channel-attach-btn"
        disabled={!value.trim()}
        onClick={() => {
          const text = value.trim();
          if (!text) return;
          onAttach({
            id: `notes-${sourceNodeId}-${Date.now()}`,
            kind,
            title: text.length > 48 ? `${text.slice(0, 48)}…` : text,
            subtitle: "Notes",
            importFrom: "local",
            payload: { text: truncateContextText(text) },
          });
          setValue("");
        }}
      >
        Add note
      </button>
    </div>
  );
}

type ListedItem = {
  id: string;
  title: string;
  subtitle?: string;
  excerpt?: string;
  url?: string;
  meta?: Record<string, string>;
};

function apiForKind(kind: ContextSourceKind): string | null {
  switch (kind) {
    case "knowledge":
      return "/api/context/knowledge";
    case "skills":
      return "/api/context/skills";
    case "repository":
      return "/api/context/repos";
    default:
      return null;
  }
}

function LiveSlashIntake({
  kind,
  label,
  onAttach,
}: {
  kind: ContextSourceKind;
  label: string;
  onAttach: (item: ContextLibraryItem) => void;
}) {
  const [slash, setSlash] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [items, setItems] = useState<ListedItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endpoint = apiForKind(kind);
  const slashQuery = slash.startsWith("/") ? slash.slice(1) : slash;

  useEffect(() => {
    if (!endpoint || !slash.length) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `${endpoint}?q=${encodeURIComponent(slashQuery.trim())}`,
        );
        const data = (await res.json()) as {
          items?: ListedItem[];
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok) {
          setError(data.error || "Lookup failed");
          setItems([]);
          return;
        }
        setItems(data.items ?? []);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Lookup failed");
        setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [endpoint, slash, slashQuery]);

  const suggestions = useMemo(() => items, [items]);

  function pick(item: ListedItem) {
    onAttach({
      id: item.id,
      kind,
      title: item.title,
      subtitle: item.subtitle,
      importFrom: kind === "skills" ? "local" : "api",
      payload: {
        text: item.excerpt ? truncateContextText(item.excerpt) : undefined,
        url: item.url,
        meta: item.meta,
      },
    });
    setSlash("");
    setHighlight(0);
    setItems([]);
  }

  if (!endpoint) {
    return (
      <div className="channel-intake nodrag nopan">
        <p className="channel-intake-hint">No live library for {label} yet.</p>
      </div>
    );
  }

  return (
    <div className="channel-intake context-intake-slash nodrag nopan">
      <input
        className="context-slash-input"
        value={slash}
        placeholder={`/ search ${label.toLowerCase()}…`}
        onChange={(e) => {
          const value = e.target.value;
          const next =
            value.startsWith("/") || value === "" ? value : `/${value}`;
          setSlash(next);
          setHighlight(0);
          if (!next.length) {
            setItems([]);
            setError(null);
            setLoading(false);
          }
        }}
        onKeyDown={(e) => {
          if (!suggestions.length) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlight((h) => (h + 1) % suggestions.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlight((h) => (h - 1 + suggestions.length) % suggestions.length);
          } else if (e.key === "Enter") {
            e.preventDefault();
            pick(suggestions[highlight] ?? suggestions[0]);
          } else if (e.key === "Escape") {
            setSlash("");
          }
        }}
      />
      {slash.length > 0 ? (
        <ul className="context-slash-results" role="listbox">
          {loading ? (
            <li className="context-slash-empty">Searching…</li>
          ) : error ? (
            <li className="context-slash-empty">{error}</li>
          ) : suggestions.length === 0 ? (
            <li className="context-slash-empty">No {label.toLowerCase()} matches.</li>
          ) : (
            suggestions.map((item, index) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={`context-slash-item ${index === highlight ? "is-active" : ""}`}
                  onMouseEnter={() => setHighlight(index)}
                  onClick={() => pick(item)}
                >
                  <span className="context-slash-kind">{kind}</span>
                  <span className="context-slash-title">{item.title}</span>
                  <span className="context-slash-meta">
                    {item.subtitle || item.excerpt?.slice(0, 80) || ""}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : (
        <p className="channel-intake-hint">
          Type / to search live {label.toLowerCase()} sources.
        </p>
      )}
    </div>
  );
}
