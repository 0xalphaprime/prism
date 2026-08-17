"use client";

import type { TraceSpineLine } from "@/lib/trace";

export function TraceSpineView({ spine }: { spine: TraceSpineLine[] }) {
  if (!spine.length) return null;
  return (
    <div className="trace-spine">
      <p className="sheet-kicker">Graph</p>
      <ol className="trace-spine-list">
        {spine.map((line) => (
          <li
            key={line.nodeId}
            className="trace-spine-line"
            style={{ paddingLeft: `${line.depth * 1.1}rem` }}
          >
            {line.depth > 0 ? <span className="trace-spine-arrow">→</span> : null}
            <span className="trace-spine-label">{line.label}</span>
            <span className="trace-spine-kind">{line.kind}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
