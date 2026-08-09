"use client";

import { FlowCanvas } from "@/components/canvas/flow-canvas";
import { Inspector } from "@/components/inspector/inspector";
import { RunBar } from "@/components/run/run-bar";
import { ArchitectureBar } from "@/components/shell/architecture-bar";
import { BrandMark } from "@/components/shell/brand-mark";
import { ContextLauncher } from "@/components/shell/context-launcher";
import { IdentityChip } from "@/components/shell/identity-chip";
import { RunsPanel } from "@/components/shell/runs-panel";
import { TalkBar } from "@/components/talk/talk-bar";

export function AppShell() {
  return (
    <div className="app-shell">
      <header className="brand-bar">
        <BrandMark />
        <div className="brand-copy">
          <p className="brand-name">Prism</p>
          <p className="brand-tag" title="W. Ross Ashby — Law of Requisite Variety">
            Only variety can absorb variety.
          </p>
        </div>
        <IdentityChip />
      </header>

      <ArchitectureBar />
      <RunsPanel />

      <div className="workspace">
        <main className="canvas-pane">
          <ContextLauncher />
          <FlowCanvas />
        </main>
        <Inspector />
      </div>

      <footer className="bottom-chrome">
        <RunBar />
        <TalkBar />
      </footer>
    </div>
  );
}
