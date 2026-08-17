"use client";

import { AddTileMenu } from "@/components/canvas/add-tile-menu";
import { FlowCanvas } from "@/components/canvas/flow-canvas";
import { SelectionChip } from "@/components/canvas/selection-chip";
import { LabShell } from "@/components/shell/lab-shell";

export function AppShell() {
  return (
    <LabShell>
      <main className="canvas-pane">
        <div className="canvas-tools">
          <AddTileMenu />
        </div>
        <SelectionChip />
        <FlowCanvas />
      </main>
    </LabShell>
  );
}
