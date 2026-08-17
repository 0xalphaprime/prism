"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo } from "react";
import { nextSteppable } from "@/lib/run-graph";
import { useGraphStore } from "@/store/graph-store";

export function RunBar() {
  const router = useRouter();
  const pathname = usePathname();
  const onTrace = pathname === "/trace";
  const loadStarterIntoActive = useGraphStore((s) => s.loadStarterIntoActive);
  const resetRunState = useGraphStore((s) => s.resetRunState);
  const saveArchitecture = useGraphStore((s) => s.saveArchitecture);
  const relayoutFlow = useGraphStore((s) => s.relayoutFlow);
  const recordRunStub = useGraphStore((s) => s.recordRunStub);
  const stepRun = useGraphStore((s) => s.stepRun);
  const runAll = useGraphStore((s) => s.runAll);
  const runBusy = useGraphStore((s) => s.runBusy);
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);

  const canStep = useMemo(
    () => Boolean(nextSteppable(nodes, edges, selectedNodeId)),
    [nodes, edges, selectedNodeId],
  );

  const jumpToTrace = () => {
    if (!onTrace) router.push("/trace");
  };

  return (
    <div className="run-bar">
      <div className="run-bar-group">
        <button
          type="button"
          className="btn btn-primary"
          disabled={runBusy || !canStep}
          title={
            runBusy
              ? "Run in progress"
              : canStep
                ? "Execute the next ready node"
                : "No ready node — reset or wait for upstream"
          }
          onClick={() => {
            jumpToTrace();
            void stepRun();
          }}
        >
          {runBusy ? "Running…" : "Step"}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={runBusy || !canStep}
          title={
            runBusy
              ? "Run in progress"
              : "Walk the pathway until Judge finishes or an error stops it"
          }
          onClick={() => {
            jumpToTrace();
            void runAll();
          }}
        >
          Run all
        </button>
        <button type="button" className="btn" onClick={resetRunState} disabled={runBusy}>
          Reset run
        </button>
        <button
          type="button"
          className="btn btn-accent"
          onClick={() => {
            recordRunStub();
            jumpToTrace();
          }}
          title="Save a pathway checkpoint without executing"
          disabled={runBusy}
        >
          Log checkpoint
        </button>
        <Link href="/trace" className="btn">
          Trace
        </Link>
      </div>
      <div className="run-bar-group">
        {!onTrace ? (
          <button type="button" className="btn" onClick={() => relayoutFlow()}>
            Clean layout
          </button>
        ) : (
          <Link href="/" className="btn">
            Graph
          </Link>
        )}
        <button type="button" className="btn" onClick={saveArchitecture}>
          Save architecture
        </button>
        {!onTrace ? (
          <button type="button" className="btn" onClick={loadStarterIntoActive}>
            Reset to starter shape
          </button>
        ) : null}
      </div>
    </div>
  );
}
