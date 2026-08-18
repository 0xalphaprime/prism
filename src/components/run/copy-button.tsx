"use client";

import { useState } from "react";
import { writeClipboard } from "@/lib/clipboard";

export function CopyButton({
  label,
  text,
  className = "btn",
  title,
}: {
  label: string;
  text: string;
  className?: string;
  title?: string;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      className={className}
      title={title ?? "Copy the full notebook as readable text"}
      onClick={async () => {
        const ok = await writeClipboard(text);
        if (!ok) {
          window.prompt("Copy all — select and Ctrl+C / Cmd+C:", text);
          return;
        }
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      }}
    >
      {copied ? "Copied" : label}
    </button>
  );
}
