"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { MODEL_OPTIONS, modelLabel, normalizeModelRef, type ModelRef } from "@/lib/providers";
import type {
  NodeBudget,
  NodeForward,
  NodePublish,
  NodeSampling,
  PrismNodeData,
} from "@/lib/types";
import { useGraphStore } from "@/store/graph-store";

type NodeWorkspaceProps = {
  nodeId: string;
};

/** Full-screen node editor — Role / Steer / Prompt + Controls. */
export function NodeWorkspace({ nodeId }: NodeWorkspaceProps) {
  const hydrate = useGraphStore((s) => s.hydrate);
  const hydrated = useGraphStore((s) => s.hydrated);
  const nodes = useGraphStore((s) => s.nodes);
  const selectNode = useGraphStore((s) => s.selectNode);
  const updateNode = useGraphStore((s) => s.updateNode);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (hydrated) selectNode(nodeId);
  }, [hydrated, nodeId, selectNode]);

  const patch = (data: Partial<PrismNodeData>) => updateNode(nodeId, data);

  const node = nodes.find((n) => n.id === nodeId);
  const data = node?.data;

  if (!hydrated) {
    return <p className="sheet-help">Loading node workspace…</p>;
  }

  if (!data) {
    return (
      <section className="page-workspace node-workspace">
        <p className="sheet-help">
          Node not found on this architecture.{" "}
          <Link href="/">Back to graph</Link>
        </p>
      </section>
    );
  }

  const modelValue = normalizeModelRef(data.model);
  const isDownstream =
    data.kind === "agent" || data.kind === "merge" || data.kind === "router";
  const showModelPrompt = data.kind === "agent" || data.kind === "merge";
  const showControls = isDownstream;
  const outputPreview = data.output?.trim() ?? "";
  const hasOutput = Boolean(outputPreview);

  return (
    <section className="page-workspace node-workspace">
      <header className="page-workspace-header node-workspace-header">
        <div>
          <span className="inspector-kind">{data.kind}</span>
          <h1>{data.label}</h1>
          <p className="sheet-help">
            Full workspace for this tile — Role, Steer, Prompt, and Controls.
            Outputs open in their own view. Inputs are the graph edges.
          </p>
        </div>
        <Link href="/" className="btn">
          Back to graph
        </Link>
      </header>

      <div className="node-workspace-grid">
        <div className="node-workspace-main">
          <label className="field">
            <span>Label</span>
            <input
              value={data.label}
              onChange={(e) => patch({ label: e.target.value })}
            />
          </label>

          {data.kind === "context" ? (
            <label className="field">
              <span>Hub notes</span>
              <textarea
                rows={10}
                className="node-workspace-textarea"
                value={data.content ?? ""}
                onChange={(e) => patch({ content: e.target.value })}
              />
            </label>
          ) : null}

          {data.kind === "context-source" ? (
            <p className="sheet-help">
              Context for this channel is managed in the{" "}
              <Link href={`/context?channel=${data.sourceKind ?? ""}`}>
                Context workspace
              </Link>
              .
            </p>
          ) : null}

          {isDownstream ? (
            <>
              <label className="field">
                <span>Role</span>
                <input
                  value={data.role ?? ""}
                  onChange={(e) => patch({ role: e.target.value })}
                />
              </label>
              <label className="field">
                <span>Steer</span>
                <textarea
                  rows={5}
                  className="node-workspace-textarea"
                  value={data.steer ?? ""}
                  onChange={(e) => patch({ steer: e.target.value })}
                  placeholder="Proximal guidance for this node’s prompt"
                />
              </label>
              <p className="field-hint">
                Shapes how the prompt runs against upstream context.
              </p>
            </>
          ) : null}

          {showModelPrompt ? (
            <>
              <label className="field">
                <span>Model</span>
                <select
                  value={modelValue}
                  onChange={(e) =>
                    patch({ model: e.target.value as ModelRef })
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
                  rows={8}
                  className="node-workspace-textarea"
                  value={data.prompt ?? ""}
                  onChange={(e) => patch({ prompt: e.target.value })}
                />
              </label>
            </>
          ) : null}

          {showControls ? <ControlsSection data={data} patch={patch} /> : null}
        </div>

        <aside className="node-workspace-side">
          <section className="node-workspace-card">
            <h2>Output</h2>
            {hasOutput ? (
              <>
                <p className="node-workspace-output-preview">{outputPreview}</p>
                <Link
                  href={`/node/${nodeId}/output`}
                  className="btn btn-accent"
                >
                  Open output
                </Link>
              </>
            ) : (
              <p className="sheet-help">
                No run yet — Step / Run all arrive in Block 3. When output lands,
                open it full-page here.
              </p>
            )}
          </section>

          <MetricsBlock data={data} />
        </aside>
      </div>
    </section>
  );
}

function ControlsSection({
  data,
  patch,
}: {
  data: PrismNodeData;
  patch: (data: Partial<PrismNodeData>) => void;
}) {
  const showLlmControls =
    data.kind === "agent" || data.kind === "merge";
  const showForward =
    data.kind === "router" || data.kind === "merge";

  const patchBudget = (partial: Partial<NodeBudget>) =>
    patch({ budget: { ...data.budget, ...partial } });
  const patchSampling = (partial: Partial<NodeSampling>) =>
    patch({ sampling: { ...data.sampling, ...partial } });
  const patchForward = (partial: Partial<NodeForward>) =>
    patch({ forward: { ...data.forward, ...partial } });
  const patchPublish = (partial: Partial<NodePublish>) =>
    patch({ publish: { ...data.publish, ...partial } });

  return (
    <section className="node-workspace-controls">
      <h2 className="node-workspace-controls-title">Controls</h2>
      <p className="field-hint">
        Stored on the node now; Block 3 enforces them at run time. Inputs come
        from graph edges — no separate input map.
      </p>

      {showLlmControls ? (
        <>
          <fieldset className="node-controls-group">
            <legend>Budget</legend>
            <div className="node-controls-row">
              <label className="field">
                <span>Max tokens out</span>
                <input
                  type="number"
                  min={0}
                  placeholder="—"
                  value={data.budget?.maxTokensOut ?? ""}
                  onChange={(e) =>
                    patchBudget({
                      maxTokensOut: optionalInt(e.target.value),
                    })
                  }
                />
              </label>
              <label className="field">
                <span>Max latency (ms)</span>
                <input
                  type="number"
                  min={0}
                  placeholder="—"
                  value={data.budget?.maxLatencyMs ?? ""}
                  onChange={(e) =>
                    patchBudget({
                      maxLatencyMs: optionalInt(e.target.value),
                    })
                  }
                />
              </label>
              <label className="field">
                <span>Max cost ($)</span>
                <input
                  type="number"
                  min={0}
                  step="0.001"
                  placeholder="—"
                  value={data.budget?.maxCostUsd ?? ""}
                  onChange={(e) =>
                    patchBudget({
                      maxCostUsd: optionalFloat(e.target.value),
                    })
                  }
                />
              </label>
            </div>
          </fieldset>

          <fieldset className="node-controls-group">
            <legend>Sampling</legend>
            <div className="node-controls-row">
              <label className="field">
                <span>Temperature</span>
                <input
                  type="number"
                  min={0}
                  max={2}
                  step={0.1}
                  placeholder="0.7"
                  value={data.sampling?.temperature ?? ""}
                  onChange={(e) =>
                    patchSampling({
                      temperature: optionalFloat(e.target.value),
                    })
                  }
                />
              </label>
              <label className="field">
                <span>Seed</span>
                <input
                  type="number"
                  placeholder="—"
                  value={data.sampling?.seed ?? ""}
                  onChange={(e) =>
                    patchSampling({
                      seed: optionalInt(e.target.value),
                    })
                  }
                />
              </label>
            </div>
          </fieldset>

          <ToolsAllowlistField
            value={data.toolsAllowlist ?? []}
            onChange={(toolsAllowlist) => patch({ toolsAllowlist })}
          />

          <label className="field">
            <span>Output schema</span>
            <textarea
              rows={4}
              className="node-workspace-textarea"
              value={data.outputSchema ?? ""}
              onChange={(e) => patch({ outputSchema: e.target.value })}
              placeholder='e.g. JSON: { "decision": string, "rationale": string }'
            />
          </label>
          <p className="field-hint">
            Shape the model should aim for — free text or JSON sketch.
          </p>

          <label className="field">
            <span>Eval rubric</span>
            <textarea
              rows={4}
              className="node-workspace-textarea"
              value={data.evalRubric ?? ""}
              onChange={(e) => patch({ evalRubric: e.target.value })}
              placeholder="Checklist for later compare / Judge scoring"
            />
          </label>
        </>
      ) : null}

      {showForward ? (
        <fieldset className="node-controls-group">
          <legend>Forward (keep-k / stop)</legend>
          <p className="field-hint">
            Graph edges say who can talk; this caps how much talk survives and
            when rounds end early.
          </p>
          <div className="node-controls-row">
            <label className="field">
              <span>Keep top-k</span>
              <input
                type="number"
                min={1}
                placeholder="3"
                value={data.forward?.keepK ?? ""}
                onChange={(e) =>
                  patchForward({ keepK: optionalInt(e.target.value) })
                }
              />
            </label>
            <label className="field">
              <span>Max rounds</span>
              <input
                type="number"
                min={1}
                placeholder="1"
                value={data.forward?.maxRounds ?? ""}
                onChange={(e) =>
                  patchForward({ maxRounds: optionalInt(e.target.value) })
                }
              />
            </label>
            <label className="field field-checkbox">
              <span>Stop on consensus</span>
              <input
                type="checkbox"
                checked={Boolean(data.forward?.stopOnConsensus)}
                onChange={(e) =>
                  patchForward({ stopOnConsensus: e.target.checked })
                }
              />
            </label>
          </div>
        </fieldset>
      ) : null}

      <fieldset className="node-controls-group">
        <legend>Publish</legend>
        <div className="node-controls-row">
          <label className="field field-checkbox">
            <span>Include in samples</span>
            <input
              type="checkbox"
              checked={data.publish?.includeInSamples !== false}
              onChange={(e) =>
                patchPublish({ includeInSamples: e.target.checked })
              }
            />
          </label>
          <label className="field field-checkbox">
            <span>Redact output</span>
            <input
              type="checkbox"
              checked={Boolean(data.publish?.redactOutput)}
              onChange={(e) =>
                patchPublish({ redactOutput: e.target.checked })
              }
            />
          </label>
        </div>
      </fieldset>
    </section>
  );
}

function ToolsAllowlistField({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const joined = useMemo(() => value.join(", "), [value]);
  const [draft, setDraft] = useState(joined);

  useEffect(() => {
    setDraft(joined);
  }, [joined]);

  return (
    <>
      <label className="field">
        <span>Tools allowlist</span>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            const next = draft
              .split(/[,;\n]+/)
              .map((s) => s.trim())
              .filter(Boolean)
              .slice(0, 5);
            onChange(next);
            setDraft(next.join(", "));
          }}
          placeholder="tool_a, tool_b (max 5)"
        />
      </label>
      <p className="field-hint">Comma-separated; keep ≤5 for variety with teeth.</p>
    </>
  );
}

function MetricsBlock({ data }: { data: PrismNodeData }) {
  const m = data.metrics;
  return (
    <section className="node-workspace-card">
      <h2>Metrics</h2>
      <dl className="node-workspace-metrics">
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

function optionalInt(raw: string): number | undefined {
  if (raw.trim() === "") return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : undefined;
}

function optionalFloat(raw: string): number | undefined {
  if (raw.trim() === "") return undefined;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : undefined;
}
