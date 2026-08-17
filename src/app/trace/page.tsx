"use client";

import { TraceView } from "@/components/run/trace-view";
import { LabShell } from "@/components/shell/lab-shell";

export default function TracePage() {
  return (
    <LabShell>
      <TraceView />
    </LabShell>
  );
}
