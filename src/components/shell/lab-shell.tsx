"use client";

import type { ReactNode } from "react";
import { RunBar } from "@/components/run/run-bar";
import { ArchitectureBar } from "@/components/shell/architecture-bar";
import { BrandMark } from "@/components/shell/brand-mark";
import { IdentityChip } from "@/components/shell/identity-chip";
import { TalkBar } from "@/components/talk/talk-bar";

export function LabShell({ children }: { children: ReactNode }) {
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

      <div className="workspace">{children}</div>

      <footer className="bottom-chrome">
        <RunBar />
        <TalkBar />
      </footer>
    </div>
  );
}
