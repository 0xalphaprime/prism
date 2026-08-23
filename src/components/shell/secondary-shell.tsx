"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ArchitectureBar } from "@/components/shell/architecture-bar";
import { BrandMark } from "@/components/shell/brand-mark";
import { IdentityChip } from "@/components/shell/identity-chip";
import { ModeChip } from "@/components/shell/mode-chip";

type SecondaryShellProps = {
  title: string;
  children: ReactNode;
};

export function SecondaryShell({ title, children }: SecondaryShellProps) {
  const pathname = usePathname();
  const evalMode = pathname === "/eval" || pathname.startsWith("/eval/");

  return (
    <div className={`secondary-shell${evalMode ? " is-eval-mode" : ""}`}>
      <header className="brand-bar">
        <BrandMark />
        <div className="brand-copy">
          <p className="brand-name">Prism</p>
          {evalMode ? (
            <ModeChip current label="Eval" title="Eval mode" />
          ) : (
            <p className="brand-tag">{title}</p>
          )}
        </div>
        <div className="brand-actions">
          {evalMode ? null : (
            <ModeChip href="/eval" label="Eval" title="Switch to Eval mode" />
          )}
          <ModeChip href="/" label="Graph" inverse title="Back to graph" />
          <IdentityChip />
        </div>
      </header>
      {evalMode ? null : <ArchitectureBar />}
      <main className="secondary-shell-main">{children}</main>
    </div>
  );
}
