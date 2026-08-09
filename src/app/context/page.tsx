import { Suspense } from "react";
import { ContextWorkspace } from "@/components/context/context-workspace";
import { SecondaryShell } from "@/components/shell/secondary-shell";

export default function ContextPage() {
  return (
    <SecondaryShell title="Context workspace">
      <Suspense fallback={<p className="sheet-help">Loading context workspace…</p>}>
        <ContextWorkspace />
      </Suspense>
    </SecondaryShell>
  );
}
