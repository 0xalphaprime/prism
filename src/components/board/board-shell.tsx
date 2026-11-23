"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { BrandMark } from "@/components/shell/brand-mark";
import { ModeChip } from "@/components/shell/mode-chip";

const TABS = [
  { href: "/board", label: "Board" },
  { href: "/board/decisions", label: "Decisions" },
  { href: "/board/members", label: "Members" },
  { href: "/board/research", label: "Research desk" },
];

function isActive(pathname: string, href: string) {
  if (href === "/board") return pathname === "/board";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function BoardShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="secondary-shell board-shell">
      <header className="brand-bar">
        <BrandMark />
        <div className="brand-copy">
          <p className="brand-name">Prism</p>
          <p className="brand-tag">Board</p>
        </div>
        <nav className="board-tabs" aria-label="Board sections">
          {TABS.map((tab) => (
            <Link
              key={tab.href}
              href={tab.href}
              className={`board-tab${isActive(pathname, tab.href) ? " is-active" : ""}`}
              aria-current={isActive(pathname, tab.href) ? "page" : undefined}
            >
              {tab.label}
            </Link>
          ))}
        </nav>
        <div className="brand-actions">
          <ModeChip href="/" label="Graph" inverse title="Back to graph" />
        </div>
      </header>
      <main className="secondary-shell-main">{children}</main>
    </div>
  );
}
