"use client";

import { useGraphStore } from "@/store/graph-store";

export function RunBar() {
  const loadStarterIntoActive = useGraphStore((s) => s.loadStarterIntoActive);
  const resetRunState = useGraphStore((s) => s.resetRunState);
  const saveArchitecture = useGraphStore((s) => s.saveArchitecture);
  const relayoutFlow = useGraphStore((s) => s.relayoutFlow);
  const recordRunStub = useGraphStore((s) => s.recordRunStub);
  const setRunsOpen = useGraphStore((s) => s.setRunsOpen);

  return (
    <div className="run-bar">
      <div className="run-bar-group">
        <button type="button" className="btn btn-primary" disabled title="Block 3">
          Step
        </button>
        <button type="button" className="btn btn-primary" disabled title="Block 3">
          Run all
        </button>
        <button type="button" className="btn" onClick={resetRunState}>
          Reset run
        </button>
        <button
          type="button"
          className="btn btn-accent"
          onClick={() => recordRunStub()}
          title="Save a pathway checkpoint without executing"
        >
          Log checkpoint
        </button>
        <button type="button" className="btn" onClick={() => setRunsOpen(true)}>
          View runs
        </button>
      </div>
      <div className="run-bar-group">
        <button type="button" className="btn" onClick={relayoutFlow}>
          Clean layout
        </button>
        <button type="button" className="btn" onClick={saveArchitecture}>
          Save architecture
        </button>
        <button type="button" className="btn" onClick={loadStarterIntoActive}>
          Reset to starter shape
        </button>
      </div>
    </div>
  );
}
