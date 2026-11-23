"use client";

import { useEffect, useState } from "react";
import { boardApi, errorText } from "@/components/board/board-api";
import type { SearchHit } from "@/lib/board/types";

type Status = { ready: boolean; standIn: boolean; service: string };
type Probe = Status & { ok: boolean; error?: string; hits?: SearchHit[] };

/** Says whether outside search is set up, and lets the owner try one search. */
export function SearchStatus() {
  const [status, setStatus] = useState<Status | null>(null);
  const [probe, setProbe] = useState<Probe | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const boot = async () => {
      try {
        const data = await boardApi<Status>("/api/board/search");
        if (!cancelled) setStatus(data);
      } catch (err) {
        if (!cancelled) setError(errorText(err));
      }
    };
    void boot();
    return () => {
      cancelled = true;
    };
  }, []);

  const test = async () => {
    setBusy(true);
    setError(null);
    try {
      setProbe(
        await boardApi<Probe>("/api/board/search", {
          method: "POST",
          body: { query: "typical customer churn after a price increase" },
        }),
      );
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  if (!status) return error ? <p className="board-error">{error}</p> : null;

  return (
    <div className={`board-search-status${status.ready ? " is-ready" : ""}`}>
      <div>
        <strong>{status.ready ? `Outside search: ${status.service}` : "Outside search is not set up"}</strong>
        <p>
          {status.ready
            ? status.standIn
              ? "Searches go to a stand-in service, not the real web."
              : "A search key is present. Use the test to confirm the service answers."
            : "Add FIRECRAWL_API_KEY to .env.local. Until then members can plan searches but not run them, and can go on without research."}
        </p>
        {probe ? (
          probe.ok ? (
            <p className="board-probe is-ok">
              Search answered with {probe.hits?.length ?? 0} results
              {probe.hits?.[0] ? `. First: ${probe.hits[0].title || probe.hits[0].url}` : ""}.
            </p>
          ) : (
            <p className="board-probe is-bad">Search did not answer: {probe.error}</p>
          )
        ) : null}
        {error ? <p className="board-probe is-bad">{error}</p> : null}
      </div>
      {status.ready ? (
        <button type="button" className="btn" onClick={test} disabled={busy}>
          {busy ? "Testing…" : "Test search"}
        </button>
      ) : null}
    </div>
  );
}
