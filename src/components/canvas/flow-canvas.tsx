"use client";

import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  useReactFlow,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useEffect } from "react";
import { nodeTypes } from "@/components/nodes";
import type { PrismNodeData } from "@/lib/types";
import { useGraphStore } from "@/store/graph-store";

/** Bump when row spacing / node heights change so open sessions re-spread once. */
const LAYOUT_REV = "compact-hub-v1";

function FitViewOnLayout() {
  const { fitView } = useReactFlow();
  const layoutEpoch = useGraphStore((s) => s.layoutEpoch);

  useEffect(() => {
    if (layoutEpoch < 1) return;
    const id = window.requestAnimationFrame(() => {
      fitView({ padding: 0.22, duration: 280, maxZoom: 1.05 });
    });
    return () => window.cancelAnimationFrame(id);
  }, [layoutEpoch, fitView]);

  return null;
}

function ApplyLayoutRevision() {
  const hydrated = useGraphStore((s) => s.hydrated);
  const relayoutFlow = useGraphStore((s) => s.relayoutFlow);

  useEffect(() => {
    if (!hydrated) return;
    try {
      if (sessionStorage.getItem("prism-layout-rev") === LAYOUT_REV) return;
      sessionStorage.setItem("prism-layout-rev", LAYOUT_REV);
    } catch {
      // ignore storage failures; still relayout once this mount
    }
    relayoutFlow({ quiet: true });
  }, [hydrated, relayoutFlow]);

  return null;
}

export function FlowCanvas() {
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const onNodesChange = useGraphStore((s) => s.onNodesChange);
  const onEdgesChange = useGraphStore((s) => s.onEdgesChange);
  const onConnect = useGraphStore((s) => s.onConnect);
  const selectNode = useGraphStore((s) => s.selectNode);

  return (
    <div className="canvas-surface">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.22, maxZoom: 1.05 }}
        proOptions={{ hideAttribution: true }}
        onSelectionChange={({ nodes: selected }) => {
          const first = selected[0] as Node<PrismNodeData> | undefined;
          selectNode(first?.id ?? null);
        }}
        onPaneClick={() => selectNode(null)}
        defaultEdgeOptions={{
          type: "smoothstep",
          animated: false,
          style: { stroke: "var(--edge)", strokeWidth: 1.5 },
        }}
        colorMode="dark"
        minZoom={0.25}
        maxZoom={1.75}
      >
        <FitViewOnLayout />
        <ApplyLayoutRevision />
        <Background
          variant={BackgroundVariant.Dots}
          gap={22}
          size={1.15}
          color="var(--grid-dot)"
        />
        <Controls className="prism-controls" showInteractive={false} />
        <MiniMap
          className="prism-minimap"
          nodeStrokeWidth={2}
          nodeColor="#2a2a2a"
          maskColor="rgba(0,0,0,0.55)"
          pannable
          zoomable
        />
      </ReactFlow>
    </div>
  );
}
