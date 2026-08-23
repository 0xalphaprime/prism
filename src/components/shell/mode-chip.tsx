import Link from "next/link";
import type { ReactNode } from "react";

function ChipFace({ label }: { label: string }) {
  return (
    <>
      <span className="mode-chip-cursor" aria-hidden />
      {label}
      <span className="mode-chip-caret" aria-hidden>
        ▾
      </span>
    </>
  );
}

export function ModeChip({
  href,
  label,
  current,
  title,
  inverse,
}: {
  href?: string;
  label: string;
  current?: boolean;
  title?: string;
  inverse?: boolean;
}) {
  const className = `mode-chip${current ? " is-current" : ""}${inverse ? " is-inverse" : ""}`;
  const face: ReactNode = <ChipFace label={label} />;
  if (!href || current) {
    return (
      <span className={className} title={title ?? `${label} mode`}>
        {face}
      </span>
    );
  }
  return (
    <Link href={href} className={className} title={title ?? `Switch to ${label} mode`}>
      {face}
    </Link>
  );
}
