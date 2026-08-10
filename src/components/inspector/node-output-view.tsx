"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useGraphStore } from "@/store/graph-store";

type NodeOutputViewProps = {
  nodeId: string;
};

/** Full-page blow-up for a node’s output artifact. */
export function NodeOutputView({ nodeId }: NodeOutputViewProps) {
  const hydrate = useGraphStore((s) => s.hydrate);
  const hydrated = useGraphStore((s) => s.hydrated);
  const nodes = useGraphStore((s) => s.nodes);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  const node = nodes.find((n) => n.id === nodeId);
  const data = node?.data;
  const output = data?.output?.trim() ?? "";

  if (!hydrated) {
    return <p className="sheet-help">Loading output…</p>;
  }

  if (!data) {
    return (
      <section className="page-workspace node-output-page">
        <p className="sheet-help">
          Node not found. <Link href="/">Back to graph</Link>
        </p>
      </section>
    );
  }

  return (
    <section className="page-workspace node-output-page">
      <header className="page-workspace-header node-workspace-header">
        <div>
          <span className="inspector-kind">{data.kind}</span>
          <h1>{data.label} — output</h1>
          <p className="sheet-help">
            Full reading surface for this node’s artifact.
          </p>
        </div>
        <div className="node-output-actions">
          <Link href={`/node/${nodeId}`} className="btn">
            Back to node
          </Link>
          <Link href="/" className="btn btn-accent">
            Back to graph
          </Link>
        </div>
      </header>

      {output ? (
        <pre className="node-output-body">{output}</pre>
      ) : (
        <p className="sheet-help node-output-empty">
          No output yet. Run Step / Run all (Block 3) to fill this view.
        </p>
      )}
    </section>
  );
}
