"use client";

import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { nodeTypes } from "@/components/nodes";
import type { PrismNodeData } from "@/lib/types";
import { useGraphStore } from "@/store/graph-store";

/** Bump when row spacing / node heights change so open sessions re-spread once. */
const LAYOUT_REV = "compact-hub-v1";
const NARROW_MQ = "(max-width: 900px)";

function useNarrowViewport() {
  const [narrow, setNarrow] = useState<boolean | null>(null);

  useEffect(() => {
    const mq = window.matchMedia(NARROW_MQ);
    const sync = () => setNarrow(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  return narrow;
}

/** MiniMap eats phone canvas — collapsed by default under 900px, toggle to peek. */
function CanvasMapChrome() {
  const narrow = useNarrowViewport();
  const [mapOpen, setMapOpen] = useState(false);
  // null = not measured yet — keep map off to avoid a phone flash
  const showMap = narrow === false || mapOpen;
  const showToggle = narrow === true;

  return (
    <>
      {showMap ? (
        <MiniMap
          className="prism-minimap"
          nodeStrokeWidth={2}
          nodeColor="#2a2a2a"
          maskColor="rgba(0,0,0,0.55)"
          pannable
          zoomable
        />
      ) : null}
      {showToggle ? (
        <Panel
          position="bottom-right"
          className={
            mapOpen
              ? "prism-map-toggle-panel prism-map-toggle-panel--open"
              : "prism-map-toggle-panel"
          }
        >
          <button
            type="button"
            className="prism-map-toggle"
            aria-pressed={mapOpen}
            aria-label={mapOpen ? "Hide graph map" : "Show graph map"}
            onClick={() => setMapOpen((open) => !open)}
          >
            {mapOpen ? "Hide map" : "Map"}
          </button>
        </Panel>
      ) : null}
    </>
  );
}

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
  const router = useRouter();
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const onNodesChange = useGraphStore((s) => s.onNodesChange);
  const onEdgesChange = useGraphStore((s) => s.onEdgesChange);
  const onConnect = useGraphStore((s) => s.onConnect);
  const onReconnect = useGraphStore((s) => s.onReconnect);
  const selectNode = useGraphStore((s) => s.selectNode);

  const onNodeDoubleClick = useCallback<NodeMouseHandler>(
    (_event, node) => {
      selectNode(node.id);
      router.push(`/node/${node.id}`);
    },
    [router, selectNode],
  );

  const handleReconnect = useCallback(
    (oldEdge: Edge, newConnection: Connection) => {
      onReconnect(oldEdge, newConnection);
    },
    [onReconnect],
  );

  return (
    <div className="canvas-surface">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onReconnect={handleReconnect}
        edgesReconnectable
        nodesConnectable
        elementsSelectable
        deleteKeyCode={["Backspace", "Delete"]}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.22, maxZoom: 1.05 }}
        proOptions={{ hideAttribution: true }}
        onSelectionChange={({ nodes: selected }) => {
          const first = selected[0] as Node<PrismNodeData> | undefined;
          selectNode(first?.id ?? null);
        }}
        onNodeDoubleClick={onNodeDoubleClick}
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
        <CanvasMapChrome />
      </ReactFlow>
    </div>
  );
}
