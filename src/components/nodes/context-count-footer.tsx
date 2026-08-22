"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";

type ContextCountFooterProps = {
  count: number;
  href: string;
  empty: ReactNode;
  children: ReactNode;
};

const CLOSE_DELAY_MS = 220;

/** Pack (N) control with a hover popover that stays open while moving to scroll. */
export function ContextCountFooter({
  count,
  href,
  empty,
  children,
}: ContextCountFooterProps) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<number | null>(null);

  const clearClose = () => {
    if (closeTimer.current != null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  const show = () => {
    clearClose();
    setOpen(true);
  };

  const scheduleHide = () => {
    clearClose();
    closeTimer.current = window.setTimeout(() => {
      setOpen(false);
      closeTimer.current = null;
    }, CLOSE_DELAY_MS);
  };

  useEffect(() => () => clearClose(), []);

  return (
    <div
      className={`context-source-footer-wrap nodrag nopan nowheel ${open ? "is-open" : ""}`}
      onMouseEnter={show}
      onMouseLeave={scheduleHide}
      onFocus={show}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          scheduleHide();
        }
      }}
    >
      <Link
        href={href}
        className={`context-source-footer ${count > 0 ? "is-active" : ""}`}
        onFocus={show}
      >
        {count === 0 ? "Open pack" : `Pack (${count})`}
      </Link>
      <div
        className="context-source-popover"
        role="tooltip"
        onMouseEnter={show}
        onMouseLeave={scheduleHide}
      >
        {count === 0 ? (
          <p className="context-source-popover-empty">{empty}</p>
        ) : (
          <ul className="context-source-popover-list nowheel">{children}</ul>
        )}
        <Link href={href} className="context-source-popover-link">
          Open pack
        </Link>
      </div>
    </div>
  );
}
