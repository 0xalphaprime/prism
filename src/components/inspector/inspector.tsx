"use client";

import { MODEL_OPTIONS, modelLabel, normalizeModelRef, type ModelRef } from "@/lib/providers";
import type { PrismNodeData } from "@/lib/types";
import { useGraphStore } from "@/store/graph-store";

export function Inspector() {
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);
  const nodes = useGraphStore((s) => s.nodes);
  const updateSelectedNode = useGraphStore((s) => s.updateSelectedNode);

  const node = nodes.find((n) => n.id === selectedNodeId);
  const data = node?.data;

  if (!data) {
    return (
      <aside className="inspector">
        <p className="inspector-empty">
          Select a node to inspect role, steer, model, and output.
        </p>
      </aside>
    );
  }

  const modelValue = normalizeModelRef(data.model);
  const isDownstream =
    data.kind === "agent" || data.kind === "merge" || data.kind === "router";

  return (
    <aside className="inspector">
      <header className="inspector-header">
        <span className="inspector-kind">{data.kind}</span>
        <h2>{data.label}</h2>
      </header>

      <label className="field">
        <span>Label</span>
        <input
          value={data.label}
          onChange={(e) => updateSelectedNode({ label: e.target.value })}
        />
      </label>

      {data.kind === "context" ? (
        <label className="field">
          <span>Hub notes</span>
          <textarea
            rows={4}
            value={data.content ?? ""}
            onChange={(e) => updateSelectedNode({ content: e.target.value })}
          />
        </label>
      ) : null}

      {isDownstream ? (
        <>
          <label className="field">
            <span>Role</span>
            <input
              value={data.role ?? ""}
              onChange={(e) => updateSelectedNode({ role: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Steer</span>
            <textarea
              rows={2}
              value={data.steer ?? ""}
              onChange={(e) => updateSelectedNode({ steer: e.target.value })}
              placeholder="Proximal guidance for this node’s prompt"
            />
          </label>
          <p className="field-hint">
            Shapes how the prompt runs against upstream context.
          </p>
        </>
      ) : null}

      {data.kind === "agent" || data.kind === "merge" ? (
        <>
          <label className="field">
            <span>Model</span>
            <select
              value={modelValue}
              onChange={(e) =>
                updateSelectedNode({ model: e.target.value as ModelRef })
              }
            >
              {MODEL_OPTIONS.map((model) => (
                <option key={model.ref} value={model.ref}>
                  {model.label} · {model.provider}
                </option>
              ))}
            </select>
          </label>
          <p className="field-hint">{modelLabel(modelValue)}</p>
          <label className="field">
            <span>Prompt</span>
            <textarea
              rows={3}
              value={data.prompt ?? ""}
              onChange={(e) => updateSelectedNode({ prompt: e.target.value })}
            />
          </label>
        </>
      ) : null}

      <section className="inspector-output">
        <h3>Output</h3>
        <p>{data.output?.trim() || "No run yet — Step / Run all arrive in Block 3."}</p>
      </section>

      <MetricsBlock data={data} />
    </aside>
  );
}

function MetricsBlock({ data }: { data: PrismNodeData }) {
  const m = data.metrics;
  return (
    <section className="inspector-metrics">
      <h3>Metrics</h3>
      <dl>
        <div>
          <dt>Latency</dt>
          <dd>{m?.latencyMs != null ? `${m.latencyMs} ms` : "—"}</dd>
        </div>
        <div>
          <dt>Tokens</dt>
          <dd>
            {m?.tokensIn != null || m?.tokensOut != null
              ? `${m?.tokensIn ?? 0} → ${m?.tokensOut ?? 0}`
              : "—"}
          </dd>
        </div>
        <div>
          <dt>Est. cost</dt>
          <dd>{m?.costUsd != null ? `$${m.costUsd.toFixed(4)}` : "—"}</dd>
        </div>
      </dl>
    </section>
  );
}
