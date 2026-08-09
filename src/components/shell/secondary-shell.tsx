"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ArchitectureBar } from "@/components/shell/architecture-bar";
import { BrandMark } from "@/components/shell/brand-mark";
import { IdentityChip } from "@/components/shell/identity-chip";

type SecondaryShellProps = {
  title: string;
  children: ReactNode;
};

export function SecondaryShell({ title, children }: SecondaryShellProps) {
  return (
    <div className="secondary-shell">
      <header className="brand-bar">
        <BrandMark />
        <div className="brand-copy">
          <p className="brand-name">Prism</p>
          <p className="brand-tag">{title}</p>
        </div>
        <div className="secondary-actions">
          <Link href="/" className="btn btn-accent">
            Back to graph
          </Link>
          <IdentityChip />
        </div>
      </header>
      <ArchitectureBar />
      <main className="secondary-shell-main">{children}</main>
    </div>
  );
}
