"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { PrismDocument } from "@/lib/document";
import { useGraphStore } from "@/store/graph-store";

const EXAMPLES = [
  "Starter MoA for a product brief",
  "Parallel debate: advocate vs skeptic, then Judge",
  "Student vs teachers with Nemo, then a second Nemo after Judge",
  "SMoA: Split into three specialists, Judge keeps top 3",
];

export function BuilderWorkspace() {
  const router = useRouter();
  const createFromBuilderDocument = useGraphStore(
    (s) => s.createFromBuilderDocument,
  );
  const defaultProvider = useGraphStore(
    (s) => s.providerPrefs.defaultProvider,
  );
  const [archetype, setArchetype] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function buildGraph() {
    const text = archetype.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/architectures/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          archetype: text,
          defaultProvider,
        }),
      });
      const payload = (await res.json().catch(() => null)) as {
        document?: PrismDocument;
        error?: string;
      } | null;
      if (!res.ok || !payload?.document) {
        setError(
          payload?.error ||
            "Builder could not author this graph. Check Connections, then try again.",
        );
        return;
      }
      createFromBuilderDocument(payload.document);
      router.push("/");
    } catch {
      setError("Builder could not reach the lab. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="page-workspace builder-workspace">
      <header className="page-workspace-header">
        <div>
          <p className="sheet-kicker">Builder</p>
          <h1>New architecture</h1>
          <p className="sheet-help">
            Type the archetype you want. The Builder agent is steered to emit a
            Prism graph — Hub, specialists, Judge — and drop it on the canvas.
          </p>
        </div>
      </header>

      <textarea
        className="prompt-panel-input builder-workspace-input"
        rows={8}
        value={archetype}
        onChange={(e) => setArchetype(e.target.value)}
        placeholder="e.g. Parallel debate on whether to ship Trace as the product surface…"
        autoFocus
        disabled={busy}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            void buildGraph();
          }
        }}
      />

      <div className="builder-examples">
        {EXAMPLES.map((example) => (
          <button
            key={example}
            type="button"
            className="builder-example"
            disabled={busy}
            onClick={() => setArchetype(example)}
          >
            {example}
          </button>
        ))}
      </div>

      {error ? <p className="builder-error">{error}</p> : null}

      <div className="prompt-panel-actions">
        <button
          type="button"
          className="btn btn-accent"
          onClick={() => void buildGraph()}
          disabled={busy || !archetype.trim()}
        >
          {busy ? "Building…" : "Build graph"}
        </button>
      </div>
    </section>
  );
}
